use serde::{Deserialize, Serialize};
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

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const COMPOSE_SERVICES: [&str; 3] = ["postgres", "forensic-worker", "backend-java"];
const COMPOSE_PROJECT: &str = "omega";
const WORKER_CONTAINER: &str = "omega_forensic_worker";
const BACKEND_CONTAINER: &str = "omega_backend_java";
const WORKER_IMAGE: &str = "omega-forensic-worker:latest";
const BACKEND_IMAGE: &str = "omega-backend-java:latest";
/// La primera ejecución construye las imágenes (Maven + pip); damos margen amplio.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// Secretos por instalación. El compose exige `INTERNAL_SERVICE_TOKEN` y, sin
/// `OMEGA_JWT_SECRET`, usaría una clave de desarrollo pública: aquí se generan
/// una vez con el RNG del sistema y se persisten en el directorio de datos.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DesktopSecrets {
    internal_service_token: String,
    jwt_secret: String,
}

/// Registro de las imágenes construidas para detectar imágenes previas cacheadas
/// (por ejemplo de otra versión o compilaciones manuales desactualizadas).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct BuiltImageMarker {
    version: String,
    forensic_image_id: String,
    backend_image_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ContainerProbe {
    version_label: Option<String>,
    health_status: Option<String>,
    image_id: Option<String>,
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

fn load_built_marker(app_data_dir: &Path) -> Option<BuiltImageMarker> {
    let raw = std::fs::read_to_string(app_data_dir.join("built-images.json")).ok()?;
    serde_json::from_str::<BuiltImageMarker>(&raw).ok()
}

fn save_built_marker(app_data_dir: &Path, marker: &BuiltImageMarker) {
    let Ok(body) = serde_json::to_string(marker) else {
        return;
    };
    let _ = std::fs::create_dir_all(app_data_dir);
    let _ = std::fs::write(app_data_dir.join("built-images.json"), body);
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

fn clean_inspect_field(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "<no value>" {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn inspect_container(name: &str) -> Option<ContainerProbe> {
    let fmt = "{{index .Config.Labels \"io.omega.version\"}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.Image}}";
    let (code, stdout, _) = run_hidden("docker", &["container", "inspect", "-f", fmt, name], None, &[]).ok()?;
    if code != 0 {
        return None;
    }
    let mut parts = stdout.splitn(3, '|');
    Some(ContainerProbe {
        version_label: clean_inspect_field(parts.next().unwrap_or("")),
        health_status: clean_inspect_field(parts.next().unwrap_or("")),
        image_id: clean_inspect_field(parts.next().unwrap_or("")),
    })
}

fn inspect_image_id(image: &str) -> Option<String> {
    let (code, stdout, _) = run_hidden("docker", &["image", "inspect", "-f", "{{.Id}}", image], None, &[]).ok()?;
    if code != 0 {
        return None;
    }
    clean_inspect_field(&stdout)
}

fn should_rebuild_images(
    app_version: &str,
    marker: Option<&BuiltImageMarker>,
    worker_image_id: Option<&str>,
    backend_image_id: Option<&str>,
    worker_container: Option<&ContainerProbe>,
    backend_container: Option<&ContainerProbe>,
) -> bool {
    let (Some(w_img), Some(b_img)) = (worker_image_id, backend_image_id) else {
        return true;
    };
    let Some(m) = marker else {
        return true;
    };
    if m.version != app_version || m.forensic_image_id != w_img || m.backend_image_id != b_img {
        return true;
    }
    let container_stale = |probe: Option<&ContainerProbe>, expected_img: &str| -> bool {
        match probe {
            Some(c) => {
                c.version_label.as_deref() != Some(app_version)
                    || c.image_id.as_deref() != Some(expected_img)
            }
            None => false,
        }
    };
    container_stale(worker_container, w_img) || container_stale(backend_container, b_img)
}

fn should_reuse_running_backend(
    app_version: &str,
    marker: Option<&BuiltImageMarker>,
    worker_image_id: Option<&str>,
    backend_image_id: Option<&str>,
    worker_container: Option<&ContainerProbe>,
    backend_container: Option<&ContainerProbe>,
) -> bool {
    // Si no existen los contenedores Docker de OMEGA pero :8080 ya responde UP,
    // respetamos un backend externo levantado manualmente (ej. desarrollo local).
    if worker_container.is_none() && backend_container.is_none() {
        return true;
    }
    let (Some(w), Some(b)) = (worker_container, backend_container) else {
        return false;
    };
    if w.health_status.as_deref() != Some("healthy") {
        return false;
    }
    !should_rebuild_images(
        app_version,
        marker,
        worker_image_id,
        backend_image_id,
        Some(w),
        Some(b),
    )
}

fn build_compose_up_args<'a>(compose_file: &'a str, rebuild: bool) -> Vec<&'a str> {
    let mut args = vec!["compose", "-p", COMPOSE_PROJECT, "-f", compose_file, "up", "-d"];
    if rebuild {
        args.push("--build");
    }
    args.extend_from_slice(&COMPOSE_SERVICES);
    args
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

/// Flujo autónomo Self-Hosted: verifica Docker, detecta si las imágenes/contenedores
/// corresponden a la versión instalada del ejecutable, reconstruye cuando están
/// desactualizados y espera a que `/actuator/health` esté UP.
pub fn run_self_hosted_bootstrap(
    shared: SharedBootstrapState,
    resource_dir: Option<PathBuf>,
    app_data_dir: Option<PathBuf>,
) {
    update_status(&shared, |s| {
        s.state = "checking".to_string();
        s.message = "Verificando servicios locales de OMEGA...".to_string();
    });

    let Some(data_dir) = app_data_dir else {
        update_status(&shared, |s| {
            s.state = "error".to_string();
            s.message = "No se pudo resolver el directorio de datos de la app.".to_string();
        });
        return;
    };

    let docker_ok = run_hidden("docker", &["info", "--format", "{{.ServerVersion}}"], None, &[]);
    let backend_up = is_local_backend_healthy(8080);

    // 1. Verificar estado de Docker Engine (salvo que haya un backend manual externo sin Docker).
    match docker_ok {
        Ok((0, _, _)) => {}
        Ok((_, _, stderr)) => {
            if backend_up {
                update_status(&shared, |s| {
                    s.state = "ready".to_string();
                    s.action = "reused".to_string();
                    s.message = "Backend OMEGA activo en http://127.0.0.1:8080.".to_string();
                });
                return;
            }
            update_status(&shared, |s| {
                s.state = "error".to_string();
                s.message = format!(
                    "Docker Desktop no está activo. Ábrelo y pulsa Reintentar ({stderr})."
                );
            });
            return;
        }
        Err(err) => {
            if backend_up {
                update_status(&shared, |s| {
                    s.state = "ready".to_string();
                    s.action = "reused".to_string();
                    s.message = "Backend OMEGA activo en http://127.0.0.1:8080.".to_string();
                });
                return;
            }
            update_status(&shared, |s| {
                s.state = "error".to_string();
                s.message = format!("Docker CLI no encontrado en el equipo ({err}).");
            });
            return;
        }
    }

    // 2. Comprobar si las imágenes y contenedores actuales coinciden con esta versión del ejecutable.
    let marker = load_built_marker(&data_dir);
    let worker_img = inspect_image_id(WORKER_IMAGE);
    let backend_img = inspect_image_id(BACKEND_IMAGE);
    let worker_cnt = inspect_container(WORKER_CONTAINER);
    let backend_cnt = inspect_container(BACKEND_CONTAINER);

    if backend_up
        && should_reuse_running_backend(
            APP_VERSION,
            marker.as_ref(),
            worker_img.as_deref(),
            backend_img.as_deref(),
            worker_cnt.as_ref(),
            backend_cnt.as_ref(),
        )
    {
        update_status(&shared, |s| {
            s.state = "ready".to_string();
            s.action = "reused".to_string();
            s.message = format!(
                "Infraestructura OMEGA v{APP_VERSION} ya estaba activa y validada; reutilizada."
            );
        });
        return;
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

    // 4. Secretos por instalación + etiquetas de versión para las imágenes/contenedores.
    let mut envs: Vec<(&str, String)> = match load_or_create_secrets(&data_dir) {
        Ok(secrets) => vec![
            ("INTERNAL_SERVICE_TOKEN", secrets.internal_service_token),
            ("OMEGA_JWT_SECRET", secrets.jwt_secret),
        ],
        Err(err) => {
            update_status(&shared, |s| {
                s.state = "error".to_string();
                s.message = format!("No se pudieron preparar los secretos locales: {err}");
            });
            return;
        }
    };
    envs.push(("OMEGA_DESKTOP_VERSION", APP_VERSION.to_string()));
    envs.push(("OMEGA_DESKTOP_RELEASE_ID", format!("v{APP_VERSION}")));

    let rebuild = should_rebuild_images(
        APP_VERSION,
        marker.as_ref(),
        worker_img.as_deref(),
        backend_img.as_deref(),
        worker_cnt.as_ref(),
        backend_cnt.as_ref(),
    );

    update_status(&shared, |s| {
        s.state = "starting".to_string();
        s.compose_file = Some(compose_str.clone());
        s.message = if rebuild {
            format!(
                "Construyendo e iniciando contenedores OMEGA v{APP_VERSION} (PostgreSQL, Worker Forense y Backend Java). Esto puede tardar varios minutos..."
            )
        } else {
            "Levantando contenedores OMEGA (PostgreSQL, Worker Forense y Backend Java)...".to_string()
        };
    });

    // 5. Levantar solo el gateway y sus dependencias (el servicio `frontend` del compose
    //    no se necesita: la UI ya vive dentro de la app de escritorio).
    let compose_args = build_compose_up_args(&compose_str, rebuild);
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

    // 6. Esperar a que /actuator/health responda UP
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    while Instant::now() < deadline {
        if is_local_backend_healthy(8080) {
            if let (Some(w_id), Some(b_id)) =
                (inspect_image_id(WORKER_IMAGE), inspect_image_id(BACKEND_IMAGE))
            {
                save_built_marker(
                    &data_dir,
                    &BuiltImageMarker {
                        version: APP_VERSION.to_string(),
                        forensic_image_id: w_id,
                        backend_image_id: b_id,
                    },
                );
            }
            update_status(&shared, |s| {
                s.state = "ready".to_string();
                s.action = "started".to_string();
                s.message = format!(
                    "Contenedores OMEGA v{APP_VERSION} verificados y listos en http://127.0.0.1:8080."
                );
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
        std::fs::write(
            dir.join("desktop-secrets.json"),
            "{\"internal_service_token\":\"short\",\"jwt_secret\":\"x\"}",
        )
        .unwrap();
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
        let with_build = build_compose_up_args("omega/docker-compose.yml", true);
        assert!(with_build.contains(&"--build"));
        let without_build = build_compose_up_args("omega/docker-compose.yml", false);
        assert!(!without_build.contains(&"--build"));
    }

    #[test]
    fn stale_cached_images_force_rebuild_and_block_blind_reuse() {
        let old_marker = BuiltImageMarker {
            version: "2.0.2".to_string(),
            forensic_image_id: "sha256:old_worker".to_string(),
            backend_image_id: "sha256:old_java".to_string(),
        };
        let matching_marker = BuiltImageMarker {
            version: "2.0.3".to_string(),
            forensic_image_id: "sha256:new_worker".to_string(),
            backend_image_id: "sha256:new_java".to_string(),
        };
        let healthy_worker = ContainerProbe {
            version_label: Some("2.0.3".to_string()),
            health_status: Some("healthy".to_string()),
            image_id: Some("sha256:new_worker".to_string()),
        };
        let matching_backend = ContainerProbe {
            version_label: Some("2.0.3".to_string()),
            health_status: Some("healthy".to_string()),
            image_id: Some("sha256:new_java".to_string()),
        };

        // Sin marcador previo (caso imágenes antiguas 2026-11-17) => reconstruye y no reutiliza
        assert!(should_rebuild_images(
            "2.0.3",
            None,
            Some("sha256:old_worker"),
            Some("sha256:old_java"),
            None,
            None,
        ));
        assert!(!should_reuse_running_backend(
            "2.0.3",
            None,
            Some("sha256:old_worker"),
            Some("sha256:old_java"),
            Some(&healthy_worker),
            Some(&matching_backend),
        ));

        // Versión distinta en marcador => reconstruye
        assert!(should_rebuild_images(
            "2.0.3",
            Some(&old_marker),
            Some("sha256:old_worker"),
            Some("sha256:old_java"),
            Some(&healthy_worker),
            Some(&matching_backend),
        ));

        // Misma versión + mismas imágenes + worker sano => reutiliza sin reconstruir
        assert!(!should_rebuild_images(
            "2.0.3",
            Some(&matching_marker),
            Some("sha256:new_worker"),
            Some("sha256:new_java"),
            Some(&healthy_worker),
            Some(&matching_backend),
        ));
        assert!(should_reuse_running_backend(
            "2.0.3",
            Some(&matching_marker),
            Some("sha256:new_worker"),
            Some("sha256:new_java"),
            Some(&healthy_worker),
            Some(&matching_backend),
        ));

        // Worker unhealthy bloquea reutilización aunque la versión coincida
        let unhealthy_worker = ContainerProbe {
            health_status: Some("unhealthy".to_string()),
            ..healthy_worker.clone()
        };
        assert!(!should_reuse_running_backend(
            "2.0.3",
            Some(&matching_marker),
            Some("sha256:new_worker"),
            Some("sha256:new_java"),
            Some(&unhealthy_worker),
            Some(&matching_backend),
        ));

        // Sin contenedores Docker pero con puerto 8080 vivo => backend externo manual
        assert!(should_reuse_running_backend("2.0.3", None, None, None, None, None));
    }
}
