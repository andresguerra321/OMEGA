mod docker_bootstrap;

use docker_bootstrap::{
    run_self_hosted_bootstrap, BootstrapStatus, SharedBootstrapState,
};
use serde::Serialize;
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{Manager, State};
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeInfo {
    pub runtime: &'static str,
    pub version: &'static str,
    pub platform: &'static str,
    pub arch: &'static str,
    pub deployment_mode: String,
    pub requires_docker: bool,
}

fn resolve_deployment_mode() -> String {
    let backend_url = std::env::var("OMEGA_BACKEND_URL").unwrap_or_default();
    let has_https_cloud = backend_url.trim().to_ascii_lowercase().starts_with("https://");
    std::env::var("OMEGA_DEPLOYMENT_MODE")
        .ok()
        .map(|v| v.trim().to_ascii_uppercase())
        .filter(|v| v == "CLOUD_MANAGED" || v == "SELF_HOSTED")
        .unwrap_or_else(|| {
            if has_https_cloud {
                "CLOUD_MANAGED".to_string()
            } else {
                "SELF_HOSTED".to_string()
            }
        })
}

#[tauri::command]
fn get_desktop_runtime_info() -> DesktopRuntimeInfo {
    let mode = resolve_deployment_mode();
    let requires_docker = mode == "SELF_HOSTED";

    DesktopRuntimeInfo {
        runtime: "tauri-v2",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        deployment_mode: mode,
        requires_docker,
    }
}

#[tauri::command]
fn get_bootstrap_status(state: State<'_, SharedBootstrapState>) -> BootstrapStatus {
    state
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default()
}

#[tauri::command]
fn retry_self_hosted_bootstrap(
    app: tauri::AppHandle,
    state: State<'_, SharedBootstrapState>,
) -> BootstrapStatus {
    let shared = state.inner().clone();
    let resource_dir = app.path().resource_dir().ok();
    thread::spawn(move || {
        run_self_hosted_bootstrap(shared, resource_dir);
    });
    state.lock().map(|g| g.clone()).unwrap_or_default()
}

#[tauri::command]
async fn collect_host_telemetry_snapshot(app: tauri::AppHandle) -> Result<Value, String> {
    let sidecar = app
        .shell()
        .sidecar("omega-sensor")
        .map_err(|e| format!("No se pudo inicializar el sidecar omega-sensor: {e}"))?
        .args(["--once"]);

    let output = sidecar
        .output()
        .await
        .map_err(|e| format!("Fallo ejecutando omega-sensor: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("omega-sensor devolvió error: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<Value>(stdout.trim())
        .map_err(|e| format!("Telemetría JSON inválida de omega-sensor: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bootstrap_state: SharedBootstrapState = Arc::new(Mutex::new(BootstrapStatus::default()));

    tauri::Builder::default()
        .manage(bootstrap_state.clone())
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            let mode = resolve_deployment_mode();
            if mode == "CLOUD_MANAGED" {
                let backend_url = std::env::var("OMEGA_BACKEND_URL").unwrap_or_default();
                if let Ok(mut s) = bootstrap_state.lock() {
                    s.state = "ready".to_string();
                    s.action = "cloud_managed".to_string();
                    s.backend_url = backend_url;
                    s.message = "Modo Cloud Managed activo (sin Docker local).".to_string();
                }
            } else {
                // Auto-orquestación Docker en segundo plano al abrir la app
                let shared = bootstrap_state.clone();
                let resource_dir = app.path().resource_dir().ok();
                thread::spawn(move || {
                    run_self_hosted_bootstrap(shared, resource_dir);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_runtime_info,
            get_bootstrap_status,
            retry_self_hosted_bootstrap,
            collect_host_telemetry_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running OMEGA Tauri v2 application");
}
