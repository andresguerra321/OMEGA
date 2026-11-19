use serde::Serialize;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStatus {
    pub state: String, // "idle" | "checking" | "starting" | "ready" | "error"
    pub action: String, // "none" | "cloud_managed" | "reused" | "started"
    pub backend_url: String,
    pub message: String,
    pub compose_file: Option<String>,
}

impl Default for BootstrapStatus {
    fn default() -> Self {
        Self {
            state: "idle".to_string(),
            action: "none".to_string(),
            backend_url: "http://127.0.0.1:8080".to_string(),
            message: "Inicializando OMEGA...".to_string(),
            compose_file: None,
        }
    }
}

pub type SharedBootstrapState = Arc<Mutex<BootstrapStatus>>;

fn run_hidden(program: &str, args: &[&str], cwd: Option<&Path>) -> Result<(i32, String, String), String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("No se pudo ejecutar '{program}': {e}"))?;
    let code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok((code, stdout, stderr))
}

/// Comprueba si el backend Java local responde UP en /actuator/health sin dependencias externas.
pub fn is_local_backend_healthy(port: u16) -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(800)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1200)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1200)));

    let req = format!(
        "GET /actuator/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut resp = String::new();
    if stream.read_to_string(&mut resp).is_err() {
        return false;
    }
    (resp.contains("200 OK") || resp.contains("200 "))
        && (resp.contains("\"status\":\"UP\"") || resp.contains("\"status\": \"UP\""))
}

/// Localiza `docker-compose.yml` desde variable de entorno, directorio de recursos o árbol del workspace.
pub fn find_compose_file(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(env_dir) = std::env::var("OMEGA_COMPOSE_DIR") {
        let trimmed = env_dir.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed).join("docker-compose.yml"));
        }
    }

    if let Some(res) = resource_dir {
        candidates.push(res.join("omega").join("docker-compose.yml"));
        candidates.push(res.join("docker-compose.yml"));
    }

    if let Ok(cwd) = std::env::current_dir() {
        let mut cur = Some(cwd.as_path());
        for _ in 0..5 {
            if let Some(dir) = cur {
                candidates.push(dir.join("docker-compose.yml"));
                candidates.push(dir.join("omega").join("docker-compose.yml"));
                cur = dir.parent();
            }
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent();
        for _ in 0..6 {
            if let Some(dir) = cur {
                candidates.push(dir.join("omega").join("docker-compose.yml"));
                candidates.push(dir.join("docker-compose.yml"));
                cur = dir.parent();
            }
        }
    }

    candidates.into_iter().find(|p| p.is_file())
}

fn update_status(shared: &SharedBootstrapState, f: impl FnOnce(&mut BootstrapStatus)) {
    if let Ok(mut guard) = shared.lock() {
        f(&mut guard);
    }
}

/// Flujo autónomo Self-Hosted: verifica si el stack ya está sano; si no, valida Docker,
/// levanta únicamente lo necesario (`docker compose up -d`) y espera a que `/actuator/health` esté UP.
pub fn run_self_hosted_bootstrap(shared: SharedBootstrapState, resource_dir: Option<PathBuf>) {
    update_status(&shared, |s| {
        s.state = "checking".to_string();
        s.message = "Verificando servicios locales de OMEGA...".to_string();
    });

    // 1. Si el backend local ya está sano, reutilizarlo sin tocar contenedores
    if is_local_backend_healthy(8080) {
        update_status(&shared, |s| {
            s.state = "ready".to_string();
            s.action = "reused".to_string();
            s.message = "Infraestructura OMEGA ya estaba activa y saludable; reutilizada.".to_string();
        });
        return;
    }

    // 2. Verificar que Docker Engine esté corriendo
    match run_hidden("docker", &["info", "--format", "{{.ServerVersion}}"], None) {
        Ok((0, _, _)) => {}
        Ok((_, _, stderr)) => {
            update_status(&shared, |s| {
                s.state = "error".to_string();
                s.message = format!(
                    "Docker Desktop no está activo. Ábrelo para iniciar los servicios locales ({stderr})."
                );
            });
            return;
        }
        Err(err) => {
            update_status(&shared, |s| {
                s.state = "error".to_string();
                s.message = format!("Docker CLI no encontrado en el equipo ({err}).");
            });
            return;
        }
    }

    // 3. Localizar docker-compose.yml
    let Some(compose_file) = find_compose_file(resource_dir.as_deref()) else {
        update_status(&shared, |s| {
            s.state = "error".to_string();
            s.message = "No se encontró omega/docker-compose.yml. Define OMEGA_COMPOSE_DIR o ejecuta desde el repositorio.".to_string();
        });
        return;
    };

    let compose_dir = compose_file.parent().unwrap_or_else(|| Path::new("."));
    let compose_str = compose_file.to_string_lossy().into_owned();

    update_status(&shared, |s| {
        s.state = "starting".to_string();
        s.compose_file = Some(compose_str.clone());
        s.message = "Levantando contenedores OMEGA (PostgreSQL, Worker Forense y Backend Java)...".to_string();
    });

    // 4. Levantar solo lo que falte (docker compose up -d preserva volúmenes y contenedores sanos)
    match run_hidden(
        "docker",
        &["compose", "-f", &compose_str, "up", "-d"],
        Some(compose_dir),
    ) {
        Ok((0, _, _)) => {}
        Ok((code, _, stderr)) => {
            update_status(&shared, |s| {
                s.state = "error".to_string();
                s.message = format!("docker compose up -d falló (código {code}): {stderr}");
            });
            return;
        }
        Err(err) => {
            update_status(&shared, |s| {
                s.state = "error".to_string();
                s.message = format!("Error lanzando docker compose: {err}");
            });
            return;
        }
    }

    // 5. Esperar a que /actuator/health responda UP (máx 90 s)
    let deadline = Instant::now() + Duration::from_secs(90);
    while Instant::now() < deadline {
        if is_local_backend_healthy(8080) {
            update_status(&shared, |s| {
                s.state = "ready".to_string();
                s.action = "started".to_string();
                s.message = "Contenedores iniciados y backend OMEGA listo en http://127.0.0.1:8080.".to_string();
            });
            return;
        }
        thread::sleep(Duration::from_secs(2));
    }

    update_status(&shared, |s| {
        s.state = "error".to_string();
        s.message = "Los contenedores iniciaron pero el backend Java tardó más de 90s en responder /actuator/health.".to_string();
    });
}
