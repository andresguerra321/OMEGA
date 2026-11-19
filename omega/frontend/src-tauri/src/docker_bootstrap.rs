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

const COMPOSE_SERVICES: [&str; 3] = ["postgres", "forensic-worker", "backend-java"];
const COMPOSE_PROJECT: &str = "omega";
/// La primera ejecución construye las imágenes (Maven + pip); damos margen amplio.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// Secretos por instalación. El compose exige `INTERNAL_SERVICE_TOKEN` y, sin
/// `OMEGA_JWT_SECRET`, usaría una clave de desarrollo pública: aquí se generan
/// una vez con el RNG del sistema y se persisten en el directorio de datos.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
struct DesktopSecrets {
    internal_service_token: String,
    jwt_secret: String,
}

fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| format!("RNG del sistema no disponible: {e}"))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

fn load_or_create_secrets(app_data_dir: &Path) -> Result<DesktopSecrets, String> {
    let path = app_data_dir.join("desktop-secrets.json");
    if let Ok(raw) = std::fs::read_to_string(&path) {
        if let Ok(parsed) = serde_json::from_str::<DesktopSecrets>(&raw) {
            if parsed.internal_service_token.len() >= 32 && parsed.jwt_secret.len() >= 64 {
                return Ok(parsed);
            }
        }
    }
    let secrets = DesktopSecrets {
        internal_service_token: random_hex(32)?,
        jwt_secret: random_hex(48)?,
    };
    std::fs::create_dir_all(app_data_dir)
        .map_err(|e| format!("No se pudo crear {}: {e}", app_data_dir.display()))?;
    let body = serde_json::to_string(&secrets).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| format!("No se pudo guardar secretos: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(secrets)
}

/// `resource_dir()` en Windows devuelve rutas `\\?\C:\...` que `docker compose` no acepta.
fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path,
    }
}

fn run_hidden(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
    envs: &[(&str, String)],
) -> Result<(i32, String, String), String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    for (key, value) in envs {
        cmd.env(key, value);
    }
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

    candidates
        .into_iter()
        .find(|p| p.is_file())
        .map(strip_verbatim_prefix)
}

fn update_status(shared: &SharedBootstrapState, f: impl FnOnce(&mut BootstrapStatus)) {
    if let Ok(mut guard) = shared.lock() {
        f(&mut guard);
    }
}

/// Flujo autónomo Self-Hosted: verifica si el stack ya está sano; si no, valida Docker,
/// levanta únicamente lo necesario (`docker compose up -d`) y espera a que `/actuator/health` esté UP.
pub fn run_self_hosted_bootstrap(
    shared: SharedBootstrapState,
    resource_dir: Option<PathBuf>,
    app_data_dir: Option<PathBuf>,
) {
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
    match run_hidden("docker", &["info", "--format", "{{.ServerVersion}}"], None, &[]) {
        Ok((0, _, _)) => {}
        Ok((_, _, stderr)) => {
            update_status(&shared, |s| {
                s.state = "error".to_string();
                s.message = format!(
                    "Docker Desktop no está activo. Ábrelo y pulsa Reintentar ({stderr})."
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

    // Secretos por instalación: el compose aborta sin INTERNAL_SERVICE_TOKEN.
    let envs: Vec<(&str, String)> = match app_data_dir.as_deref().map(load_or_create_secrets) {
        Some(Ok(secrets)) => vec![
            ("INTERNAL_SERVICE_TOKEN", secrets.internal_service_token),
            ("OMEGA_JWT_SECRET", secrets.jwt_secret),
        ],
        Some(Err(err)) => {
            update_status(&shared, |s| {
                s.state = "error".to_string();
                s.message = format!("No se pudieron preparar los secretos locales: {err}");
            });
            return;
        }
        None => {
            update_status(&shared, |s| {
                s.state = "error".to_string();
                s.message = "No se pudo resolver el directorio de datos de la app.".to_string();
            });
            return;
        }
    };

    update_status(&shared, |s| {
        s.state = "starting".to_string();
        s.compose_file = Some(compose_str.clone());
        s.message = "Levantando contenedores OMEGA (PostgreSQL, Worker Forense y Backend Java). La primera vez construye las imágenes y puede tardar varios minutos...".to_string();
    });

    // 4. Levantar solo el gateway y sus dependencias (el servicio `frontend` del compose
    //    no se necesita: la UI ya vive dentro de la app de escritorio).
    let mut compose_args: Vec<&str> = vec!["compose", "-p", COMPOSE_PROJECT, "-f", &compose_str, "up", "-d"];
    compose_args.extend_from_slice(&COMPOSE_SERVICES);
    match run_hidden("docker", &compose_args, Some(compose_dir), &envs) {
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

    // 5. Esperar a que /actuator/health responda UP
    let deadline = Instant::now() + STARTUP_TIMEOUT;
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
        s.message = "Los contenedores iniciaron pero el backend Java no respondió /actuator/health a tiempo. Revisa `docker compose -p omega logs backend-java` y pulsa Reintentar.".to_string();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_are_generated_once_and_reused() {
        let dir = std::env::temp_dir().join(format!("omega-secrets-test-{}", random_hex(8).unwrap()));
        let first = load_or_create_secrets(&dir).unwrap();
        assert_eq!(first.internal_service_token.len(), 64);
        assert_eq!(first.jwt_secret.len(), 96);
        let second = load_or_create_secrets(&dir).unwrap();
        assert_eq!(first.internal_service_token, second.internal_service_token);
        assert_eq!(first.jwt_secret, second.jwt_secret);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupted_secret_file_is_regenerated() {
        let dir = std::env::temp_dir().join(format!("omega-secrets-bad-{}", random_hex(8).unwrap()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("desktop-secrets.json"), "{\"internal_service_token\":\"short\",\"jwt_secret\":\"x\"}").unwrap();
        let regenerated = load_or_create_secrets(&dir).unwrap();
        assert_eq!(regenerated.internal_service_token.len(), 64);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn verbatim_windows_prefix_is_removed_for_docker() {
        assert_eq!(
            strip_verbatim_prefix(PathBuf::from(r"\\?\C:\Users\a\omega\docker-compose.yml")),
            PathBuf::from(r"C:\Users\a\omega\docker-compose.yml")
        );
        assert_eq!(
            strip_verbatim_prefix(PathBuf::from("/opt/omega/docker-compose.yml")),
            PathBuf::from("/opt/omega/docker-compose.yml")
        );
    }

    #[test]
    fn compose_starts_only_gateway_services_not_the_frontend_build() {
        assert!(!COMPOSE_SERVICES.contains(&"frontend"));
        assert!(COMPOSE_SERVICES.contains(&"backend-java"));
    }
}
