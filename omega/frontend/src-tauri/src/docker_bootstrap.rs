use crate::desktop_config::{load_desktop_config, persist_env_file_path};
use crate::env_loader::{compute_env_fingerprint, find_env_file, merge_bootstrap_envs};
use crate::env_loader::{load_dotenv_file, save_dotenv_file};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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
    pub state: String,  // "idle" | "checking" | "starting" | "ready" | "error"
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
pub(crate) struct DesktopSecrets {
    pub(crate) internal_service_token: String,
    pub(crate) jwt_secret: String,
    #[serde(default)]
    pub(crate) postgres_password: String,
}

/// Registro de las imágenes construidas para detectar imágenes previas cacheadas
/// (por ejemplo de otra versión o compilaciones manuales desactualizadas).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct BuiltImageMarker {
    version: String,
    forensic_image_id: String,
    backend_image_id: String,
    #[serde(default)]
    env_fingerprint: Option<String>,
    #[serde(default)]
    release_id: Option<String>,
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

pub(crate) fn load_or_create_secrets(app_data_dir: &Path) -> Result<DesktopSecrets, String> {
    let path = app_data_dir.join("desktop-secrets.json");
    if let Ok(raw) = std::fs::read_to_string(&path) {
        if let Ok(parsed) = serde_json::from_str::<DesktopSecrets>(&raw) {
            if parsed.internal_service_token.len() >= 32 && parsed.jwt_secret.len() >= 64 {
                return Ok(parsed);
            }
        }
    }
    if path.exists() {
        return Err("El archivo de secretos locales no es válido. Se conservó para evitar cambiar la identidad de la instalación.".into());
    }
    let secrets = DesktopSecrets {
        internal_service_token: random_hex(32)?,
        jwt_secret: random_hex(48)?,
        postgres_password: random_hex(32)?,
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
    envs: &[(String, String)],
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
    let fmt = "{{index .Config.Labels \"io.omega.version\"}}|{{if .State.Running}}{{if .State.Health}}{{.State.Health.Status}}{{end}}{{end}}|{{.Image}}";
    let (code, stdout, _) = run_hidden(
        "docker",
        &["container", "inspect", "-f", fmt, name],
        None,
        &[],
    )
    .ok()?;
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

fn inspect_compose_working_dir(name: &str) -> Option<PathBuf> {
    let fmt = "{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}";
    let (code, stdout, _) = run_hidden(
        "docker",
        &["container", "inspect", "-f", fmt, name],
        None,
        &[],
    )
    .ok()?;
    if code != 0 {
        return None;
    }
    clean_inspect_field(&stdout).map(PathBuf::from)
}

fn prepare_bootstrap_envs(
    compose_file: Option<&Path>,
    data_dir: &Path,
) -> Result<(Vec<(String, String)>, String), String> {
    for name in ["omega_postgres", WORKER_CONTAINER, BACKEND_CONTAINER] {
        inspect_owned_env(name)?;
    }
    let secrets = load_or_create_secrets(data_dir)?;
    let user_cfg = load_desktop_config(data_dir);
    let saved_env =
        (!user_cfg.env_file_path.is_empty()).then(|| Path::new(user_cfg.env_file_path.as_str()));
    let docker_work_dir = inspect_compose_working_dir(BACKEND_CONTAINER)
        .or_else(|| inspect_compose_working_dir(WORKER_CONTAINER))
        .or_else(|| inspect_compose_working_dir("omega_postgres"));
    let env_file = find_env_file(
        compose_file,
        data_dir,
        docker_work_dir.as_deref(),
        saved_env,
    );
    // Import legacy configuration once; packaged launches subsequently use AppData only.
    let installation_env = data_dir.join("bootstrap.env");
    if !installation_env.exists() {
        let mut imported = BTreeMap::new();
        for name in ["omega_postgres", WORKER_CONTAINER, BACKEND_CONTAINER] {
            imported.extend(inspect_owned_env(name)?);
        }
        if let Some(ref source) = env_file {
            imported.extend(load_dotenv_file(source));
        }
        // A database volume keeps its original password even when the executable moves.
        for (key, value) in inspect_owned_env("omega_postgres")? {
            if key.starts_with("POSTGRES_") || key == "OMEGA_PG_VOLUME_NAME" {
                imported.insert(key, value);
            }
        }
        if !imported.contains_key("POSTGRES_PASSWORD") {
            imported.insert(
                "POSTGRES_PASSWORD".into(),
                if secrets.postgres_password.is_empty() {
                    random_hex(32)?
                } else {
                    secrets.postgres_password.clone()
                },
            );
        }
        save_dotenv_file(&installation_env, &imported)?;
    }
    if let Some(source) = saved_env.filter(|path| *path != installation_env && path.is_file()) {
        let mut values = load_dotenv_file(&installation_env);
        values.extend(load_dotenv_file(source));
        for (key, value) in inspect_owned_env("omega_postgres")? {
            if key.starts_with("POSTGRES_") || key == "OMEGA_PG_VOLUME_NAME" {
                values.insert(key, value);
            }
        }
        save_dotenv_file(&installation_env, &values)?;
    }
    persist_env_file_path(data_dir, &installation_env);
    std::fs::read_to_string(&installation_env)
        .map_err(|e| format!("No se pudo leer la configuración de esta instalación: {e}"))?;
    // An explicit override remains available for developers; no ambient directory search after import.
    let explicit_env = std::env::var_os("OMEGA_ENV_FILE").map(PathBuf::from);
    let mut envs = merge_bootstrap_envs(
        explicit_env.as_deref().or(Some(&installation_env)),
        &secrets.internal_service_token,
        &secrets.jwt_secret,
        APP_VERSION,
        &user_cfg,
    );
    let release = read_release_id(compose_file)?;
    envs.retain(|(key, _)| key != "OMEGA_DESKTOP_RELEASE_ID");
    envs.push(("OMEGA_DESKTOP_RELEASE_ID".into(), release));
    envs.sort();
    let fingerprint = compute_env_fingerprint(&envs);
    Ok((envs, fingerprint))
}

fn inspect_image_id(image: &str) -> Option<String> {
    let (code, stdout, _) = run_hidden(
        "docker",
        &["image", "inspect", "-f", "{{.Id}}", image],
        None,
        &[],
    )
    .ok()?;
    if code != 0 {
        return None;
    }
    clean_inspect_field(&stdout)
}

fn inspect_owned_env(name: &str) -> Result<BTreeMap<String, String>, String> {
    let (code, stdout, _) = run_hidden("docker", &["inspect", name], None, &[])?;
    if code != 0 {
        return Ok(BTreeMap::new());
    }
    parse_owned_env(name, &stdout)
}

fn parse_owned_env(name: &str, stdout: &str) -> Result<BTreeMap<String, String>, String> {
    let containers: Vec<serde_json::Value> =
        serde_json::from_str(stdout).map_err(|e| e.to_string())?;
    let container = containers.first().ok_or("Respuesta Docker vacía")?;
    let labels = &container["Config"]["Labels"];
    let service = match name {
        "omega_postgres" => "postgres",
        WORKER_CONTAINER => "forensic-worker",
        BACKEND_CONTAINER => "backend-java",
        _ => return Err("Contenedor no reconocido".into()),
    };
    if labels["com.docker.compose.project"].as_str() != Some(COMPOSE_PROJECT)
        || labels["com.docker.compose.service"].as_str() != Some(service)
    {
        return Err(format!(
            "Ya existe {name}, pero no pertenece a esta instalación de OMEGA. No se modificó."
        ));
    }
    let mut values = BTreeMap::new();
    if let Some(envs) = container["Config"]["Env"].as_array() {
        for entry in envs.iter().filter_map(|v| v.as_str()) {
            if let Some((key, value)) = entry.split_once('=') {
                if [
                    "OMEGA_",
                    "POSTGRES_",
                    "INTERNAL_SERVICE_TOKEN",
                    "GROQ_",
                    "OPENAI_",
                    "OMNIROUTE_",
                    "CUSTOM_LLM_",
                    "HIBP_",
                    "ABUSECH_",
                    "VIRUSTOTAL_",
                    "ABUSEIPDB_",
                ]
                .iter()
                .any(|prefix| key.starts_with(prefix))
                {
                    // Container-internal addresses must come from the current Compose file.
                    if ![
                        "OMEGA_FORENSIC_WORKER_URL",
                        "OMEGA_STIX_CORPUS_DIR",
                        "OMEGA_INGEST_TMP_DIR",
                        "OMEGA_STIX_MANIFEST_PATH",
                        "OMEGA_CONTAINMENT_DIR",
                    ]
                    .contains(&key)
                    {
                        values.insert(key.to_string(), value.to_string());
                    }
                }
            }
        }
    }
    if name == "omega_postgres" {
        if container["Mounts"]
            .as_array()
            .map(|mounts| {
                mounts.iter().any(|mount| {
                    mount["Destination"].as_str() == Some("/var/lib/postgresql/data")
                        && mount["Type"].as_str() == Some("bind")
                })
            })
            .unwrap_or(false)
        {
            return Err("La base existente usa una carpeta de datos personalizada. Se conservó sin reemplazarla; necesita una migración explícita antes de usar este paquete.".into());
        }
        if let Some(mounts) = container["Mounts"].as_array() {
            if let Some(volume) = mounts
                .iter()
                .find(|mount| {
                    mount["Destination"].as_str() == Some("/var/lib/postgresql/data")
                        && mount["Type"].as_str() == Some("volume")
                })
                .and_then(|mount| mount["Name"].as_str())
            {
                values.insert("OMEGA_PG_VOLUME_NAME".into(), volume.into());
            }
        }
    }
    Ok(values)
}

fn read_release_id(compose_file: Option<&Path>) -> Result<String, String> {
    let manifest = compose_file
        .and_then(Path::parent)
        .map(|dir| dir.join("desktop-release.json"));
    if let Some(path) = manifest.filter(|path| path.exists()) {
        let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        return json["release_id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .map(str::to_string)
            .ok_or("El paquete no tiene un identificador de versión válido".into());
    }
    Ok(format!("v{APP_VERSION}"))
}

fn is_downgrade(existing: &str, bundled: &str) -> bool {
    fn parts(version: &str) -> Option<Vec<u64>> {
        let parts: Vec<u64> = version
            .split('-')
            .next()?
            .split('.')
            .map(str::parse)
            .collect::<Result<_, _>>()
            .ok()?;
        (parts.len() == 3).then_some(parts)
    }
    match (parts(existing), parts(bundled)) {
        (Some(old), Some(new)) => old > new,
        _ => false,
    }
}

fn backup_database(data_dir: &Path) -> Result<(), String> {
    let env = inspect_owned_env("omega_postgres")?;
    if env.is_empty() {
        return Ok(());
    }
    let (code, _, _) = run_hidden("docker", &["start", "omega_postgres"], None, &[])?;
    if code != 0 {
        return Err("No se pudo iniciar la base existente para respaldarla.".into());
    }
    let user = env
        .get("POSTGRES_USER")
        .map(String::as_str)
        .unwrap_or("omega_admin");
    let db = env
        .get("POSTGRES_DB")
        .map(String::as_str)
        .unwrap_or("omega_cti");
    let deadline = Instant::now() + Duration::from_secs(60);
    while run_hidden(
        "docker",
        &["exec", "omega_postgres", "pg_isready", "-U", user, "-d", db],
        None,
        &[],
    )?
    .0 != 0
    {
        if Instant::now() >= deadline {
            return Err("La base existente no está lista para crear el respaldo.".into());
        }
        thread::sleep(Duration::from_secs(1));
    }
    let dir = data_dir.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("before-update-{}.dump", random_hex(8)?));
    let file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    let mut cmd = Command::new("docker");
    cmd.args([
        "exec",
        "omega_postgres",
        "pg_dump",
        "-U",
        user,
        "-d",
        db,
        "-Fc",
    ])
    .stdout(file)
    .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let result = cmd.output().map_err(|e| e.to_string())?;
    if !result.status.success() {
        let _ = std::fs::remove_file(path);
        return Err("No se pudo respaldar la base existente. La actualización se detuvo para conservar tus datos.".into());
    }
    Ok(())
}

fn local_services_ready() -> bool {
    ["omega_postgres", WORKER_CONTAINER, BACKEND_CONTAINER]
        .iter()
        .all(|name| {
            inspect_container(name)
                .map(|c| c.health_status.as_deref() == Some("healthy"))
                .unwrap_or(false)
        })
        && is_local_backend_healthy(8080)
}

fn ensure_docker_running() -> Result<(i32, String, String), String> {
    let initial = run_hidden(
        "docker",
        &["info", "--format", "{{.ServerVersion}}"],
        None,
        &[],
    );
    if matches!(&initial, Ok((0, _, _))) {
        return initial;
    }
    #[cfg(target_os = "windows")]
    {
        let executable = std::env::var_os("ProgramFiles")
            .map(PathBuf::from)
            .map(|dir| dir.join("Docker/Docker/Docker Desktop.exe"));
        if let Some(path) = executable.filter(|path| path.is_file()) {
            Command::new(path)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| e.to_string())?;
            let deadline = Instant::now() + Duration::from_secs(120);
            while Instant::now() < deadline {
                thread::sleep(Duration::from_secs(2));
                let result = run_hidden(
                    "docker",
                    &["info", "--format", "{{.ServerVersion}}"],
                    None,
                    &[],
                );
                if matches!(&result, Ok((0, _, _))) {
                    return result;
                }
            }
        }
    }
    initial
}

fn lock_installation(data_dir: &Path) -> Result<std::fs::File, String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(data_dir.join("bootstrap.lock"))
        .map_err(|e| e.to_string())?;
    file.lock()
        .map_err(|e| format!("No se pudo bloquear el arranque local: {e}"))?;
    Ok(file)
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
    current_env_fingerprint: Option<&str>,
) -> bool {
    // Health alone cannot establish ownership of an unrelated listener.
    if worker_container.is_none() && backend_container.is_none() {
        return false;
    }
    let (Some(w), Some(b)) = (worker_container, backend_container) else {
        return false;
    };
    if w.health_status.as_deref() != Some("healthy")
        || b.health_status.as_deref() != Some("healthy")
    {
        return false;
    }
    if let (Some(expected_fp), Some(m)) = (current_env_fingerprint, marker) {
        if m.env_fingerprint.as_deref() != Some(expected_fp) {
            return false;
        }
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
    let mut args = vec![
        "compose",
        "-p",
        COMPOSE_PROJECT,
        "-f",
        compose_file,
        "up",
        "-d",
    ];
    if rebuild {
        args.push("--build");
    } else {
        args.push("--no-build");
    }
    if Path::new(compose_file)
        .parent()
        .map(|p| p.join("desktop-images.tar").exists())
        .unwrap_or(false)
    {
        args.extend(["--pull", "never"]);
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

    // The OS releases this lock even if another executable exits unexpectedly.
    let _installation_lock = match lock_installation(&data_dir) {
        Ok(lock) => lock,
        Err(err) => {
            update_status(&shared, |s| {
                s.state = "error".into();
                s.message = err;
            });
            return;
        }
    };
    let docker_ok = ensure_docker_running();
    let backend_up = is_local_backend_healthy(8080);

    // 1. Verificar estado de Docker Engine (salvo que haya un backend manual externo sin Docker).
    match docker_ok {
        Ok((0, _, _)) => {}
        Ok((_, _, stderr)) => {
            if backend_up && std::env::var("OMEGA_ALLOW_EXTERNAL_BACKEND").as_deref() == Ok("true")
            {
                update_status(&shared, |s| {
                    s.state = "ready".to_string();
                    s.action = "reused".to_string();
                    s.message = "Backend OMEGA activo en http://127.0.0.1:8080.".to_string();
                });
                return;
            }
            update_status(&shared, |s| {
                s.state = "error".to_string();
                s.message =
                    format!("Docker Desktop no está activo. Ábrelo y pulsa Reintentar ({stderr}).");
            });
            return;
        }
        Err(err) => {
            if backend_up && std::env::var("OMEGA_ALLOW_EXTERNAL_BACKEND").as_deref() == Ok("true")
            {
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
    let compose_file_opt = find_compose_file(resource_dir.as_deref());
    let prepared_env = prepare_bootstrap_envs(compose_file_opt.as_deref(), &data_dir);
    let current_fp = prepared_env.as_ref().ok().map(|(_, fp)| fp.as_str());

    if let Err(err) = &prepared_env {
        update_status(&shared, |s| {
            s.state = "error".into();
            s.message = err.clone();
        });
        return;
    }
    let release_id = match read_release_id(compose_file_opt.as_deref()) {
        Ok(id) => id,
        Err(err) => {
            update_status(&shared, |s| {
                s.state = "error".into();
                s.message = err;
            });
            return;
        }
    };
    let marker = load_built_marker(&data_dir);
    let release_changed =
        marker.as_ref().and_then(|m| m.release_id.as_deref()) != Some(release_id.as_str());
    let worker_img = inspect_image_id(WORKER_IMAGE);
    let backend_img = inspect_image_id(BACKEND_IMAGE);
    let worker_cnt = inspect_container(WORKER_CONTAINER);
    let backend_cnt = inspect_container(BACKEND_CONTAINER);

    if backend_cnt
        .as_ref()
        .and_then(|c| c.version_label.as_deref())
        .map(|version| is_downgrade(version, APP_VERSION))
        .unwrap_or(false)
    {
        update_status(&shared, |s| {
            s.state = "error".into();
            s.message = "Esta instalación ya usa una versión más reciente. Abre el ejecutable actualizado para conservar la compatibilidad de tus datos.".into();
        });
        return;
    }

    if backend_up
        && !release_changed
        && local_services_ready()
        && should_reuse_running_backend(
            APP_VERSION,
            marker.as_ref(),
            worker_img.as_deref(),
            backend_img.as_deref(),
            worker_cnt.as_ref(),
            backend_cnt.as_ref(),
            current_fp,
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

    if backend_cnt.is_none()
        && TcpStream::connect_timeout(&([127, 0, 0, 1], 8080).into(), Duration::from_millis(500))
            .is_ok()
    {
        update_status(&shared, |s| {
            s.state = "error".into();
            s.message = "El puerto local 8080 está ocupado por otro servicio. Ciérralo y pulsa Reintentar; tus datos no se modificaron.".into();
        });
        return;
    }
    // 3. Localizar docker-compose.yml y variables (.env + configuración UI + secretos)
    let Some(compose_file) = compose_file_opt else {
        update_status(&shared, |s| {
            s.state = "error".to_string();
            s.message = "No se encontró omega/docker-compose.yml. Define OMEGA_COMPOSE_DIR o ejecuta desde el repositorio.".to_string();
        });
        return;
    };

    let compose_dir = compose_file.parent().unwrap_or_else(|| Path::new("."));
    let compose_str = compose_file.to_string_lossy().into_owned();

    let (envs, env_fingerprint) = match prepared_env {
        Ok(pair) => pair,
        Err(err) => {
            update_status(&shared, |s| {
                s.state = "error".to_string();
                s.message = format!("No se pudieron preparar los secretos locales: {err}");
            });
            return;
        }
    };

    let rebuild = release_changed
        || should_rebuild_images(
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
            "Levantando contenedores OMEGA (PostgreSQL, Worker Forense y Backend Java)..."
                .to_string()
        };
    });

    if rebuild {
        if let Err(err) = backup_database(&data_dir) {
            update_status(&shared, |s| {
                s.state = "error".into();
                s.message = err;
            });
            return;
        }
        let archive = compose_dir.join("desktop-images.tar");
        if archive.exists() {
            update_status(&shared, |s| {
                s.message = "Preparando los servicios incluidos en OMEGA...".into()
            });
            let archive_str = archive.to_string_lossy();
            if !matches!(
                run_hidden("docker", &["load", "--input", &archive_str], None, &[]),
                Ok((0, _, _))
            ) {
                update_status(&shared, |s| {
                    s.state = "error".into();
                    s.message = "No se pudieron cargar los servicios incluidos. Reinstala OMEGA y vuelve a intentarlo; tus datos se conservan.".into();
                });
                return;
            }
        } else if compose_dir.join("desktop-release.json").exists() {
            update_status(&shared, |s| {
                s.state = "error".into();
                s.message = "El paquete de OMEGA está incompleto: faltan los servicios locales. Reinstala la aplicación.".into();
            });
            return;
        }
    }
    // 5. Levantar solo el gateway y sus dependencias (el servicio `frontend` del compose
    //    no se necesita: la UI ya vive dentro de la app de escritorio).
    let compose_args = build_compose_up_args(
        &compose_str,
        rebuild && !compose_dir.join("desktop-images.tar").exists(),
    );
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
        if local_services_ready() {
            if let (Some(w_id), Some(b_id)) = (
                inspect_image_id(WORKER_IMAGE),
                inspect_image_id(BACKEND_IMAGE),
            ) {
                save_built_marker(
                    &data_dir,
                    &BuiltImageMarker {
                        version: APP_VERSION.to_string(),
                        forensic_image_id: w_id,
                        backend_image_id: b_id,
                        env_fingerprint: Some(env_fingerprint),
                        release_id: Some(read_release_id(Some(&compose_file)).unwrap_or_default()),
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

/// Recrea únicamente `forensic-worker` y `backend-java` preservando PostgreSQL y secretos
/// tras actualizar la configuración de IA / SMTP desde la app de escritorio.
pub fn reapply_gateway_services(
    shared: SharedBootstrapState,
    resource_dir: Option<PathBuf>,
    data_dir: &Path,
) -> Result<(), String> {
    let _installation_lock = lock_installation(data_dir)?;
    let _installation_lock = lock_installation(data_dir)?;
    let Some(compose_file) = find_compose_file(resource_dir.as_deref()) else {
        return Err("No se encontró docker-compose.yml para aplicar los cambios.".to_string());
    };
    let compose_dir = compose_file.parent().unwrap_or_else(|| Path::new("."));
    let compose_str = compose_file.to_string_lossy().into_owned();

    let (envs, env_fingerprint) = prepare_bootstrap_envs(Some(&compose_file), data_dir)?;

    update_status(&shared, |s| {
        s.state = "starting".to_string();
        s.compose_file = Some(compose_str.clone());
        s.message = "Aplicando configuración local y recargando el backend OMEGA...".to_string();
    });

    let args = [
        "compose",
        "-p",
        COMPOSE_PROJECT,
        "-f",
        &compose_str,
        "up",
        "-d",
        "forensic-worker",
        "backend-java",
    ];
    match run_hidden("docker", &args, Some(compose_dir), &envs) {
        Ok((0, _, _)) => {}
        Ok((code, _, stderr)) => {
            let msg = format!("docker compose up -d falló (código {code}): {stderr}");
            update_status(&shared, |s| {
                s.state = "error".to_string();
                s.message = msg.clone();
            });
            return Err(msg);
        }
        Err(err) => {
            update_status(&shared, |s| {
                s.state = "error".to_string();
                s.message = err.clone();
            });
            return Err(err);
        }
    }

    let deadline = Instant::now() + Duration::from_secs(90);
    while Instant::now() < deadline {
        if local_services_ready() {
            if let (Some(w_id), Some(b_id)) = (
                inspect_image_id(WORKER_IMAGE),
                inspect_image_id(BACKEND_IMAGE),
            ) {
                save_built_marker(
                    data_dir,
                    &BuiltImageMarker {
                        version: APP_VERSION.to_string(),
                        forensic_image_id: w_id,
                        backend_image_id: b_id,
                        env_fingerprint: Some(env_fingerprint),
                        release_id: Some(read_release_id(Some(&compose_file)).unwrap_or_default()),
                    },
                );
            }
            update_status(&shared, |s| {
                s.state = "ready".to_string();
                s.action = "started".to_string();
                s.message = "Configuración aplicada y backend OMEGA listo.".to_string();
            });
            return Ok(());
        }
        thread::sleep(Duration::from_secs(2));
    }

    let timeout_msg =
        "El backend tardó más de 90s en responder tras aplicar la configuración.".to_string();
    update_status(&shared, |s| {
        s.state = "error".to_string();
        s.message = timeout_msg.clone();
    });
    Err(timeout_msg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upgrades_are_allowed_but_older_executables_cannot_downgrade_data() {
        assert!(is_downgrade("2.0.7", "2.0.6"));
        assert!(is_downgrade("2.10.0", "2.9.0"));
        assert!(!is_downgrade("2.0.5", "2.0.6"));
        assert!(!is_downgrade("2.0.6", "2.0.6"));
        assert!(!is_downgrade("development", "2.0.6"));
    }

    #[test]
    fn existing_database_volume_is_adopted_and_custom_bind_paths_are_not_replaced() {
        let container = serde_json::json!([{
            "Config": { "Labels": { "com.docker.compose.project": "omega", "com.docker.compose.service": "postgres" }, "Env": [] },
            "Mounts": [{ "Destination": "/var/lib/postgresql/data", "Type": "volume", "Name": "legacy-pgdata" }]
        }]);
        let values = parse_owned_env("omega_postgres", &container.to_string()).unwrap();
        assert_eq!(values.get("OMEGA_PG_VOLUME_NAME").unwrap(), "legacy-pgdata");
        assert!(parse_owned_env(
            "omega_postgres",
            &container.to_string().replace("\"volume\"", "\"bind\"")
        )
        .is_err());
    }

    #[test]
    fn legacy_compose_is_adopted_but_foreign_names_are_rejected() {
        let owned = r#"[{"Config":{"Labels":{"com.docker.compose.project":"omega","com.docker.compose.service":"postgres"},"Env":["POSTGRES_PASSWORD=existing-password","POSTGRES_USER=owner","PATH=ignored"]}}]"#;
        let values = parse_owned_env("omega_postgres", owned).unwrap();
        assert_eq!(
            values.get("POSTGRES_PASSWORD").unwrap(),
            "existing-password"
        );
        assert!(!values.contains_key("PATH"));
        assert!(parse_owned_env(
            "omega_postgres",
            &owned.replace("\"omega\"", "\"other-project\"")
        )
        .is_err());
    }

    #[test]
    fn a_second_executable_cannot_update_while_the_first_holds_the_lock() {
        let dir = std::env::temp_dir().join(format!("omega-lock-{}", random_hex(8).unwrap()));
        let first = lock_installation(&dir).unwrap();
        let other = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(dir.join("bootstrap.lock"))
            .unwrap();
        assert!(other.try_lock().is_err());
        drop(first);
        assert!(other.try_lock().is_ok());
        drop(other);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn package_release_is_read_from_its_own_resources() {
        let dir = std::env::temp_dir().join(format!("omega-release-{}", random_hex(8).unwrap()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("desktop-release.json"),
            r#"{"release_id":"source-sha256"}"#,
        )
        .unwrap();
        assert_eq!(
            read_release_id(Some(&dir.join("docker-compose.yml"))).unwrap(),
            "source-sha256"
        );
        std::fs::write(dir.join("desktop-release.json"), "{}").unwrap();
        assert!(read_release_id(Some(&dir.join("docker-compose.yml"))).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn secrets_are_generated_once_and_reused() {
        let dir =
            std::env::temp_dir().join(format!("omega-secrets-test-{}", random_hex(8).unwrap()));
        let first = load_or_create_secrets(&dir).unwrap();
        assert_eq!(first.internal_service_token.len(), 64);
        assert_eq!(first.jwt_secret.len(), 96);
        let second = load_or_create_secrets(&dir).unwrap();
        assert_eq!(first.internal_service_token, second.internal_service_token);
        assert_eq!(first.jwt_secret, second.jwt_secret);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupted_secret_file_is_preserved() {
        let dir =
            std::env::temp_dir().join(format!("omega-secrets-bad-{}", random_hex(8).unwrap()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("desktop-secrets.json"),
            "{\"internal_service_token\":\"short\",\"jwt_secret\":\"x\"}",
        )
        .unwrap();
        assert!(load_or_create_secrets(&dir).is_err());
        assert!(dir.join("desktop-secrets.json").exists());
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
            env_fingerprint: Some("fp_old".to_string()),
            release_id: None,
        };
        let matching_marker = BuiltImageMarker {
            version: "2.0.3".to_string(),
            forensic_image_id: "sha256:new_worker".to_string(),
            backend_image_id: "sha256:new_java".to_string(),
            env_fingerprint: Some("fp_env_1".to_string()),
            release_id: None,
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
            Some("fp_env_1"),
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

        // Misma versión + mismas imágenes + mismo env + worker sano => reutiliza sin reconstruir
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
            Some("fp_env_1"),
        ));

        // Cambio en .env => no reconstruye imágenes, pero sí recrea contenedores
        assert!(!should_rebuild_images(
            "2.0.3",
            Some(&matching_marker),
            Some("sha256:new_worker"),
            Some("sha256:new_java"),
            Some(&healthy_worker),
            Some(&matching_backend),
        ));
        assert!(!should_reuse_running_backend(
            "2.0.3",
            Some(&matching_marker),
            Some("sha256:new_worker"),
            Some("sha256:new_java"),
            Some(&healthy_worker),
            Some(&matching_backend),
            Some("fp_env_changed"),
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
            Some("fp_env_1"),
        ));

        // Sin contenedores Docker pero con puerto 8080 vivo => backend externo manual
        assert!(!should_reuse_running_backend(
            "2.0.3",
            None,
            None,
            None,
            None,
            None,
            Some("fp_env_1"),
        ));
    }
}
