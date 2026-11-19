mod docker_bootstrap;
mod pdf_vault_index;
mod usb_bridge;

use docker_bootstrap::{
    run_self_hosted_bootstrap, BootstrapStatus, SharedBootstrapState,
};
use pdf_vault_index::{
    load_index, register_pdf_source, resolve_pdf_source, LocalPdfSourceRecord, ResolvedPdfSource,
};
use usb_bridge::{
    check_adb_status, check_ios_status, collect_device_snapshot, collect_ios_snapshot,
    harden_private_dns, install_portable_adb, pick_adb_binary, pick_ios_backup_dir,
    read_ios_backup_artifacts, read_ios_backup_manifest,
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
    // Evita lanzar dos `docker compose up` simultáneos si el usuario pulsa Reintentar varias veces.
    let busy = shared
        .lock()
        .map(|g| g.state == "checking" || g.state == "starting")
        .unwrap_or(false);
    if !busy {
        let resource_dir = app.path().resource_dir().ok();
        let app_data_dir = app.path().app_data_dir().ok();
        thread::spawn(move || {
            run_self_hosted_bootstrap(shared, resource_dir, app_data_dir);
        });
    }
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

#[tauri::command]
fn register_local_pdf_source(
    app: tauri::AppHandle,
    document_id: String,
    sha256: String,
    local_path: String,
) -> Result<LocalPdfSourceRecord, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo resolver app_data_dir: {e}"))?;
    register_pdf_source(&dir, document_id, sha256, local_path)
}

#[tauri::command]
fn resolve_local_pdf_source(
    app: tauri::AppHandle,
    document_id: String,
    sha256: String,
    page: Option<u32>,
) -> Result<ResolvedPdfSource, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo resolver app_data_dir: {e}"))?;
    Ok(resolve_pdf_source(&dir, &document_id, &sha256, page))
}

#[tauri::command]
fn list_local_pdf_sources(app: tauri::AppHandle) -> Result<Vec<LocalPdfSourceRecord>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo resolver app_data_dir: {e}"))?;
    Ok(load_index(&dir).into_values().collect())
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
                let app_data_dir = app.path().app_data_dir().ok();
                thread::spawn(move || {
                    run_self_hosted_bootstrap(shared, resource_dir, app_data_dir);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_runtime_info,
            get_bootstrap_status,
            retry_self_hosted_bootstrap,
            collect_host_telemetry_snapshot,
            register_local_pdf_source,
            resolve_local_pdf_source,
            list_local_pdf_sources,
            check_adb_status,
            pick_adb_binary,
            install_portable_adb,
            collect_device_snapshot,
            harden_private_dns,
            check_ios_status,
            collect_ios_snapshot,
            pick_ios_backup_dir,
            read_ios_backup_manifest,
            read_ios_backup_artifacts
        ])
        .run(tauri::generate_context!())
        .expect("error while running OMEGA Tauri v2 application");
}
