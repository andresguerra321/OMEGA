use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";

static APPROVED_ADB_PATHS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

fn approved_adb_paths() -> &'static Mutex<HashSet<PathBuf>> {
    APPROVED_ADB_PATHS.get_or_init(|| Mutex::new(HashSet::new()))
}

pub fn encode_base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn run_cmd(program: &str, args: &[&str]) -> Result<(bool, String, String), String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("No se pudo ejecutar '{program}': {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok((output.status.success(), stdout, stderr))
}

fn is_runnable_binary(bin: &str, args: &[&str]) -> bool {
    run_cmd(bin, args).map(|(ok, _, _)| ok).unwrap_or(false)
}

pub fn normalize_adb_candidate(raw_path: &str) -> Option<PathBuf> {
    let trimmed = raw_path.trim().trim_matches('"').trim_matches('\'');
    if trimmed.is_empty() {
        return None;
    }
    let p = PathBuf::from(trimmed);
    let resolved = fs::canonicalize(&p).unwrap_or(p);
    if resolved.is_file() {
        return Some(resolved);
    }
    if resolved.is_dir() {
        let exe_name = if cfg!(target_os = "windows") {
            "adb.exe"
        } else {
            "adb"
        };
        let nested = resolved.join(exe_name);
        if nested.is_file() {
            return Some(fs::canonicalize(&nested).unwrap_or(nested));
        }
    }
    None
}

fn resolve_adb_binary(custom_path: &str, app_data_dir: Option<&Path>) -> Result<Option<String>, String> {
    if !custom_path.trim().is_empty() {
        let Some(candidate) = normalize_adb_candidate(custom_path) else {
            return Err("La ruta personalizada de ADB no existe o no es válida.".to_string());
        };
        let approved = approved_adb_paths()
            .lock()
            .map(|set| set.contains(&candidate))
            .unwrap_or(false);
        if !approved {
            return Err(
                "Selecciona el ejecutable ADB mediante el diálogo nativo antes de utilizarlo."
                    .to_string(),
            );
        }
        let s = candidate.to_string_lossy().to_string();
        if is_runnable_binary(&s, &["version"]) {
            return Ok(Some(s));
        }
    }

    if is_runnable_binary("adb", &["version"]) {
        return Ok(Some("adb".to_string()));
    }

    let exe = if cfg!(target_os = "windows") {
        "adb.exe"
    } else {
        "adb"
    };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "windows") {
        if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
            candidates.push(
                PathBuf::from(local_app)
                    .join("Android")
                    .join("Sdk")
                    .join("platform-tools")
                    .join(exe),
            );
        }
        if let Ok(user_prof) = std::env::var("USERPROFILE") {
            candidates.push(PathBuf::from(user_prof).join("platform-tools").join(exe));
        }
        candidates.push(PathBuf::from(r"C:\platform-tools").join(exe));
        candidates.push(PathBuf::from(r"C:\Android\platform-tools").join(exe));
    } else {
        if let Ok(home) = std::env::var("HOME") {
            let h = PathBuf::from(home);
            candidates.push(
                h.join("Library")
                    .join("Android")
                    .join("sdk")
                    .join("platform-tools")
                    .join(exe),
            );
            candidates.push(
                h.join("Android")
                    .join("Sdk")
                    .join("platform-tools")
                    .join(exe),
            );
        }
        candidates.push(PathBuf::from("/opt/homebrew/bin/adb"));
        candidates.push(PathBuf::from("/usr/local/bin/adb"));
        candidates.push(PathBuf::from("/usr/bin/adb"));
    }

    if let Some(dir) = app_data_dir {
        candidates.push(dir.join("tools").join("platform-tools").join(exe));
    }

    for cand in candidates {
        if cand.is_file() {
            let s = cand.to_string_lossy().to_string();
            if is_runnable_binary(&s, &["version"]) {
                return Ok(Some(s));
            }
        }
    }

    Ok(None)
}

fn run_adb(
    args: &[&str],
    custom_path: &str,
    app_data_dir: Option<&Path>,
) -> Result<String, String> {
    let Some(adb_bin) = resolve_adb_binary(custom_path, app_data_dir)? else {
        return Err("ADB_NOT_FOUND".to_string());
    };
    let (ok, stdout, stderr) = run_cmd(&adb_bin, args)?;
    if !ok && stdout.is_empty() {
        return Err(if stderr.is_empty() {
            "Fallo ejecutando comando ADB".to_string()
        } else {
            stderr
        });
    }
    Ok(stdout)
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AdbDeviceEntry {
    pub line: String,
    pub serial: String,
    pub state: String,
    pub model: String,
}

pub fn parse_adb_devices(raw: &str) -> Vec<AdbDeviceEntry> {
    raw.lines()
        .skip(1)
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            let serial = parts.first().copied().unwrap_or("").to_string();
            let state = parts.get(1).copied().unwrap_or("").to_string();
            let model = parts
                .iter()
                .find_map(|p| p.strip_prefix("model:"))
                .map(|m| m.replace('_', " "))
                .or_else(|| {
                    parts
                        .iter()
                        .find_map(|p| p.strip_prefix("product:"))
                        .map(str::to_string)
                })
                .unwrap_or_else(|| "Android".to_string());
            AdbDeviceEntry {
                line: line.to_string(),
                serial,
                state,
                model,
            }
        })
        .collect()
}

fn windows_file_transfer_devices() -> Vec<String> {
    let script = r#"
        $ErrorActionPreference = 'Stop'
        [Console]::OutputEncoding = [Text.Encoding]::UTF8
        $devices = @(Get-PnpDevice -PresentOnly -Class WPD | Where-Object {
            $_.Status -eq 'OK' -and $_.InstanceId -like 'USB\*'
        } | Select-Object -ExpandProperty FriendlyName)
        ConvertTo-Json -InputObject $devices -Compress
    "#;
    let Ok((true, stdout, _)) = run_cmd(
        "powershell.exe",
        &["-NoProfile", "-NonInteractive", "-Command", script],
    ) else {
        return Vec::new();
    };
    serde_json::from_str(&stdout).unwrap_or_default()
}

#[tauri::command]
pub async fn check_adb_status(
    app: tauri::AppHandle,
    custom_path: Option<String>,
    wait_for_usb: Option<bool>,
) -> Result<Value, String> {
    let custom = custom_path.unwrap_or_default();
    let app_dir = app.path().app_data_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        adb_status(&custom, app_dir.as_deref(), wait_for_usb.unwrap_or(false))
    })
    .await
    .map_err(|_| "No se pudo consultar la conexión USB de Android.".to_string())
}

fn adb_status(custom: &str, app_dir: Option<&Path>, wait_for_usb: bool) -> Value {
    let adb_bin = match resolve_adb_binary(custom, app_dir) {
        Ok(Some(bin)) => bin,
        Ok(None) => {
            return json!({
                "available": false,
                "connected": false,
                "status_code": "ADB_NOT_FOUND",
                "adb_path": Value::Null,
                "devices": [],
                "reason": "Tu computadora aún no tiene instalado el conector gratuito de Google para leer teléfonos Android."
            });
        }
        Err(err) => {
            return json!({
                "available": false,
                "connected": false,
                "status_code": "ADB_NOT_FOUND",
                "adb_path": Value::Null,
                "devices": [],
                "reason": err
            });
        }
    };

    let read_devices = || run_cmd(&adb_bin, &["devices", "-l"]);
    let mut response = read_devices();
    if wait_for_usb {
        for _ in 0..3 {
            let Ok((true, stdout, _)) = &response else { break; };
            if !parse_adb_devices(stdout).is_empty() {
                break;
            }
            thread::sleep(Duration::from_secs(1));
            response = read_devices();
        }
    }
    match response {
        Ok((true, stdout, _)) => {
            let devices = parse_adb_devices(&stdout);
            if let Some(auth) = devices.iter().find(|d| d.state == "device") {
                json!({
                    "available": true,
                    "connected": true,
                    "status_code": "READY",
                    "adb_path": adb_bin,
                    "serial": auth.serial,
                    "model": auth.model,
                    "devices": devices
                })
            } else {
                let unauthorized = devices.iter().any(|d| d.state == "unauthorized");
                let offline = devices.iter().any(|d| d.state == "offline");
                let (status_code, reason) = if unauthorized {
                    (
                        "UNAUTHORIZED",
                        "¡Teléfono detectado! Desbloquéalo y toca \"Permitir\" en el aviso que acaba de salir en su pantalla.",
                    )
                } else if offline {
                    (
                        "OFFLINE",
                        "El teléfono apareció sin conexión. Desconecta y vuelve a conectar el cable con el teléfono desbloqueado.",
                    )
                } else {
                    (
                        "NO_DEVICE",
                        "No se detectó un Android. Conecta un cable de datos y comprueba que la depuración USB esté activada.",
                    )
                };
                let mut status = json!({
                    "available": true,
                    "connected": false,
                    "status_code": status_code,
                    "adb_path": adb_bin,
                    "devices": devices,
                    "reason": reason
                });
                if cfg!(target_os = "windows") && wait_for_usb && status_code == "NO_DEVICE" {
                    let devices = windows_file_transfer_devices();
                    if !devices.is_empty() {
                        status["windows_file_transfer"] = json!(true);
                        if devices.len() == 1 {
                            status["windows_device_name"] = json!(devices[0]);
                        }
                    }
                }
                status
            }
        }
        Ok((false, _, _)) => json!({
            "available": true,
            "connected": false,
            "status_code": "ADB_ERROR",
            "adb_path": adb_bin,
            "devices": [],
            "reason": "El conector Android no pudo comprobar los dispositivos USB."
        }),
        Err(err) => json!({
            "available": false,
            "connected": false,
            "status_code": "ADB_NOT_FOUND",
            "adb_path": Value::Null,
            "devices": [],
            "reason": err
        }),
    }
}

fn pick_file_native_dialog( select_directory: bool, title: &str) -> Option<String> {
    if cfg!(target_os = "windows") {
        let script = if select_directory {
            format!(
                "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '{}'; if ($d.ShowDialog() -eq 'OK') {{ Write-Output $d.SelectedPath }}",
                title.replace('\'', "''")
            )
        } else {
            format!(
                "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = '{}'; $d.Filter = 'Android Debug Bridge (adb.exe)|adb.exe| Ejecutables (*.exe)|*.exe'; if ($d.ShowDialog() -eq 'OK') {{ Write-Output $d.FileName }}",
                title.replace('\'', "''")
            )
        };
        if let Ok((ok, stdout, _)) = run_cmd(
            "powershell.exe",
            &["-NoProfile", "-STA", "-Command", &script],
        ) {
            if ok && !stdout.trim().is_empty() {
                return Some(stdout.trim().to_string());
            }
        }
        return None;
    }

    if cfg!(target_os = "macos") {
        let kind = if select_directory { "folder" } else { "file" };
        let script = format!(
            "POSIX path of (choose {} with prompt \"{}\")",
            kind,
            title.replace('"', "\\\"")
        );
        if let Ok((ok, stdout, _)) = run_cmd("osascript", &["-e", &script]) {
            if ok && !stdout.trim().is_empty() {
                return Some(stdout.trim().to_string());
            }
        }
        return None;
    }

    let mut args = vec!["--file-selection", "--title", title];
    if select_directory {
        args.push("--directory");
    }
    if let Ok((ok, stdout, _)) = run_cmd("zenity", &args) {
        if ok && !stdout.trim().is_empty() {
            return Some(stdout.trim().to_string());
        }
    }
    None
}

#[tauri::command]
pub fn pick_adb_binary(custom_path: Option<String>) -> Value {
    let raw = custom_path
        .filter(|s| !s.trim().is_empty())
        .or_else(|| pick_file_native_dialog(false, "Seleccionar ejecutable adb (Android Platform Tools)"));

    let Some(chosen_raw) = raw else {
        return json!({ "canceled": true, "valid": false });
    };

    let Some(chosen) = normalize_adb_candidate(&chosen_raw) else {
        return json!({
            "canceled": false,
            "valid": false,
            "error": "El archivo seleccionado no es válido."
        });
    };

    let chosen_str = chosen.to_string_lossy().to_string();
    match run_cmd(&chosen_str, &["version"]) {
        Ok((true, stdout, _)) => {
            if let Ok(mut guard) = approved_adb_paths().lock() {
                guard.insert(chosen);
            }
            let version = stdout
                .lines()
                .next()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("ADB verificado");
            json!({
                "canceled": false,
                "valid": true,
                "adb_path": chosen_str,
                "version": version
            })
        }
        Ok((false, _, stderr)) => json!({
            "canceled": false,
            "valid": false,
            "error": if stderr.is_empty() { "El ejecutable seleccionado no respondió a \"adb version\".".to_string() } else { stderr }
        }),
        Err(err) => json!({
            "canceled": false,
            "valid": false,
            "error": err
        }),
    }
}

#[tauri::command]
pub fn install_portable_adb(app: tauri::AppHandle) -> Value {
    let app_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("No se pudo resolver app_data_dir: {e}")
            })
        }
    };

    if let Ok(Some(existing)) = resolve_adb_binary("", Some(&app_dir)) {
        if let Some(norm) = normalize_adb_candidate(&existing) {
            if let Ok(mut guard) = approved_adb_paths().lock() {
                guard.insert(norm);
            }
        }
        return json!({
            "ok": true,
            "adbPath": existing,
            "alreadyInstalled": true
        });
    }

    let tools_dir = app_dir.join("tools");
    let extract_target = tools_dir.join("platform-tools");
    let exe_name = if cfg!(target_os = "windows") {
        "adb.exe"
    } else {
        "adb"
    };
    let zip_url = if cfg!(target_os = "windows") {
        "https://dl.google.com/android/repository/platform-tools-latest-windows.zip"
    } else if cfg!(target_os = "macos") {
        "https://dl.google.com/android/repository/platform-tools-latest-darwin.zip"
    } else {
        "https://dl.google.com/android/repository/platform-tools-latest-linux.zip"
    };

    if let Err(e) = fs::create_dir_all(&tools_dir) {
        return json!({
            "ok": false,
            "error": format!("No se pudo crear directorio de herramientas: {e}")
        });
    }

    let tmp_zip = tools_dir.join("platform-tools-tmp.zip");
    let tmp_zip_str = tmp_zip.to_string_lossy().to_string();
    let tools_dir_str = tools_dir.to_string_lossy().to_string();

    let download_res = if cfg!(target_os = "windows") {
        let script = format!(
            "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '{}' -OutFile '{}' -UseBasicParsing; Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
            zip_url,
            tmp_zip_str.replace('\'', "''"),
            tmp_zip_str.replace('\'', "''"),
            tools_dir_str.replace('\'', "''")
        );
        run_cmd(
            "powershell.exe",
            &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script],
        )
    } else {
        run_cmd("curl", &["-fsSL", zip_url, "-o", &tmp_zip_str])
            .and_then(|(ok, _, err)| {
                if !ok {
                    return Err(format!("Fallo descargando platform-tools: {err}"));
                }
                run_cmd("unzip", &["-oq", &tmp_zip_str, "-d", &tools_dir_str])
            })
    };

    let _ = fs::remove_file(&tmp_zip);

    if let Err(e) = download_res {
        return json!({
            "ok": false,
            "error": format!("No se pudo instalar ADB automáticamente: {e}")
        });
    }

    let adb_bin = extract_target.join(exe_name);
    if !adb_bin.is_file() {
        return json!({
            "ok": false,
            "error": "No se encontró el binario adb dentro del paquete extraído."
        });
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&adb_bin, fs::Permissions::from_mode(0o755));
    }

    let adb_bin_str = adb_bin.to_string_lossy().to_string();
    if !is_runnable_binary(&adb_bin_str, &["version"]) {
        return json!({
            "ok": false,
            "error": "El binario ADB descargado no pudo ejecutarse en este equipo."
        });
    }

    if let Some(norm) = normalize_adb_candidate(&adb_bin_str) {
        if let Ok(mut guard) = approved_adb_paths().lock() {
            guard.insert(norm);
        }
    }

    json!({
        "ok": true,
        "adbPath": adb_bin_str,
        "alreadyInstalled": false
    })
}

#[tauri::command]
pub fn collect_device_snapshot(
    app: tauri::AppHandle,
    custom_path: Option<String>,
    serial: Option<String>,
) -> Result<Value, String> {
    let custom = custom_path.unwrap_or_default();
    let serial_clean = serial.unwrap_or_default().trim().to_string();
    let app_dir = app.path().app_data_dir().ok();
    let Some(adb_bin) = resolve_adb_binary(&custom, app_dir.as_deref())? else {
        return Err("ADB_NOT_FOUND".to_string());
    };

    let connection_args = if serial_clean.is_empty() {
        vec!["get-state"]
    } else {
        vec!["-s", serial_clean.as_str(), "get-state"]
    };
    let check_connection = || {
        let (ok, state, _) = run_cmd(&adb_bin, &connection_args)?;
        if ok && state.trim() == "device" {
            Ok(())
        } else {
            Err("El Android dejó de responder por USB. Reconecta el cable con el teléfono desbloqueado y vuelve a autorizarlo si te lo pide.".to_string())
        }
    };
    check_connection()?;

    let queries: &[(&str, &[&str], &str)] = &[
        ("model", &["shell", "getprop", "ro.product.model"], "Desconocido"),
        ("manufacturer", &["shell", "getprop", "ro.product.manufacturer"], ""),
        ("android_version", &["shell", "getprop", "ro.build.version.release"], "N/D"),
        ("security_patch", &["shell", "getprop", "ro.build.version.security_patch"], "N/D"),
        ("private_dns_mode", &["shell", "settings", "get", "global", "private_dns_mode"], "off"),
        ("private_dns_specifier", &["shell", "settings", "get", "global", "private_dns_specifier"], ""),
        ("unknown_sources", &["shell", "settings", "get", "secure", "install_non_market_apps"], ""),
        ("selinux", &["shell", "getenforce"], "Unknown"),
        ("verified_boot", &["shell", "getprop", "ro.boot.verifiedbootstate"], "unknown"),
        ("accessibility", &["shell", "settings", "get", "secure", "enabled_accessibility_services"], "null"),
        ("device_admins", &["shell", "dumpsys", "device_policy"], ""),
        ("packages", &["shell", "pm", "list", "packages", "-3"], ""),
        ("processes", &["shell", "ps", "-A", "-o", "USER,PID,PPID,NAME,ARGS"], ""),
        ("proc_net_tcp", &["shell", "cat", "/proc/net/tcp"], ""),
        ("proc_net_tcp6", &["shell", "cat", "/proc/net/tcp6"], ""),
        ("dns_resolver", &["shell", "dumpsys", "dnsresolver"], ""),
        ("apk_paths", &["shell", "pm", "list", "packages", "-3", "-f"], ""),
        ("ca_certs", &["shell", "ls", "/data/misc/user/0/cacerts-added"], ""),
        ("http_proxy", &["shell", "settings", "get", "global", "http_proxy"], ""),
    ];

    let mut handles = Vec::with_capacity(queries.len());
    for (key, q_args, fallback) in queries {
        let bin = adb_bin.clone();
        let ser = serial_clean.clone();
        let key_s = (*key).to_string();
        let fb = (*fallback).to_string();
        let owned_args: Vec<String> = q_args.iter().map(|s| (*s).to_string()).collect();
        handles.push(thread::spawn(move || {
            let mut full_args: Vec<&str> = Vec::new();
            if !ser.is_empty() {
                full_args.push("-s");
                full_args.push(&ser);
            }
            for a in &owned_args {
                full_args.push(a);
            }
            let out = run_cmd(&bin, &full_args)
                .ok()
                .filter(|(ok, stdout, _)| *ok || !stdout.is_empty())
                .map(|(_, stdout, _)| stdout)
                .unwrap_or(fb);
            (key_s, out)
        }));
    }

    let mut map = HashMap::new();
    for h in handles {
        if let Ok((k, v)) = h.join() {
            map.insert(k, v);
        }
    }

    let get_val = |k: &str| map.get(k).cloned().unwrap_or_default();

    let clean_packages = get_val("packages")
        .lines()
        .map(|l| l.strip_prefix("package:").unwrap_or(l).trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    let apk_file_paths: Vec<String> = get_val("apk_paths")
        .lines()
        .filter_map(|line| {
            let rest = line.strip_prefix("package:")?;
            let (apk_path, _) = rest.rsplit_once('=')?;
            if apk_path.starts_with("/data/app/")
                && apk_path.ends_with(".apk")
                && apk_path
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._/~=+@-".contains(c))
            {
                Some(apk_path.to_string())
            } else {
                None
            }
        })
        .take(18)
        .collect();

    let mut apk_hashes_raw = String::new();
    if !apk_file_paths.is_empty() {
        let mut args: Vec<&str> = Vec::new();
        if !serial_clean.is_empty() {
            args.push("-s");
            args.push(&serial_clean);
        }
        args.push("shell");
        args.push("sha256sum");
        for p in &apk_file_paths {
            args.push(p);
        }
        if let Ok((_, stdout, _)) = run_cmd(&adb_bin, &args) {
            apk_hashes_raw = stdout;
        }
    }

    let ca_certs = get_val("ca_certs");
    let ca_certs_raw = if ca_certs.to_ascii_lowercase().contains("no such file") {
        String::new()
    } else {
        ca_certs
    };

    let proxy_clean = get_val("http_proxy").trim().to_string();
    let proxy_raw = if !proxy_clean.is_empty() && !proxy_clean.eq_ignore_ascii_case("null") {
        format!("http_proxy={proxy_clean}")
    } else {
        String::new()
    };

    check_connection()?;
    Ok(json!({
        "platform": "android",
        "device": {
            "platform": "android",
            "serial": serial_clean,
            "manufacturer": get_val("manufacturer").trim(),
            "model": get_val("model").trim(),
            "android_version": get_val("android_version").trim(),
            "security_patch": get_val("security_patch").trim(),
            "private_dns_mode": get_val("private_dns_mode").trim(),
            "private_dns_specifier": get_val("private_dns_specifier").trim(),
            "install_non_market_apps": get_val("unknown_sources").trim(),
            "selinux_status": get_val("selinux").trim(),
            "verified_boot_state": get_val("verified_boot").trim(),
            "accessibility_services": get_val("accessibility").trim()
        },
        "device_admins_raw": get_val("device_admins"),
        "packages_text": clean_packages,
        "processes_text": get_val("processes"),
        "proc_net_raw": format!("{}\n{}", get_val("proc_net_tcp"), get_val("proc_net_tcp6")),
        "dns_resolver_raw": get_val("dns_resolver"),
        "apk_hashes_raw": apk_hashes_raw,
        "ca_certs_raw": ca_certs_raw,
        "proxy_raw": proxy_raw
    }))
}

#[tauri::command]
pub fn harden_private_dns(
    app: tauri::AppHandle,
    custom_path: Option<String>,
    serial: Option<String>,
    confirmed: Option<bool>,
) -> Result<Value, String> {
    if confirmed != Some(true) {
        return Err(
            "Se requiere confirmación explícita del analista antes de modificar ajustes de red."
                .to_string(),
        );
    }
    let custom = custom_path.unwrap_or_default();
    let serial_clean = serial.unwrap_or_default().trim().to_string();
    let app_dir = app.path().app_data_dir().ok();

    let run_scoped = |sub: &[&str]| -> Result<String, String> {
        let mut full = Vec::new();
        if !serial_clean.is_empty() {
            full.push("-s");
            full.push(serial_clean.as_str());
        }
        full.extend_from_slice(sub);
        run_adb(&full, &custom, app_dir.as_deref())
    };

    run_scoped(&["shell", "settings", "put", "global", "private_dns_mode", "hostname"])?;
    run_scoped(&[
        "shell",
        "settings",
        "put",
        "global",
        "private_dns_specifier",
        "dns.quad9.net",
    ])?;

    let applied_mode = run_scoped(&["shell", "settings", "get", "global", "private_dns_mode"])
        .unwrap_or_default();
    let applied_spec = run_scoped(&[
        "shell",
        "settings",
        "get",
        "global",
        "private_dns_specifier",
    ])
    .unwrap_or_default();

    let mode_trim = applied_mode.trim();
    let spec_trim = applied_spec.trim();
    Ok(json!({
        "applied": mode_trim == "hostname" && spec_trim == "dns.quad9.net",
        "mode": mode_trim,
        "specifier": spec_trim,
        "provider": "dns.quad9.net (DNS-over-TLS)"
    }))
}

fn has_apple_mobile_device_support() -> bool {
    if !cfg!(target_os = "windows") {
        return true;
    }
    [
        r"C:\Program Files\Common Files\Apple\Mobile Device Support",
        r"C:\Program Files (x86)\Common Files\Apple\Mobile Device Support",
    ]
    .iter()
    .any(|d| Path::new(d).exists())
        || is_runnable_binary("reg.exe", &["query", r"HKLM\SYSTEM\CurrentControlSet\Services\Apple Mobile Device Service"])
}

struct IosTool {
    kind: &'static str,
    cmd: String,
    prefix: Vec<String>,
    has_crash: bool,
}

const IOS_CONNECTOR_PACKAGE: &str = "pymobiledevice3==11.65.0";
static IOS_CONNECTOR_INSTALL: Mutex<()> = Mutex::new(());

fn ios_environment(app_dir: &Path) -> PathBuf {
    app_dir.join("tools").join("iphone-connector")
}

fn ios_environment_python(environment: &Path) -> PathBuf {
    environment.join(if cfg!(target_os = "windows") { "Scripts/python.exe" } else { "bin/python" })
}

fn portable_python_binary(app_dir: &Path) -> PathBuf {
    let base = app_dir.join("tools").join("python-runtime");
    if cfg!(target_os = "windows") {
        base.join("tools").join("python.exe")
    } else {
        base.join("python").join("bin").join("python3")
    }
}

fn ensure_portable_python(app_dir: &Path) -> Result<String, String> {
    let target_bin = portable_python_binary(app_dir);
    if target_bin.is_file() {
        let bin_str = target_bin.to_string_lossy().to_string();
        if is_runnable_binary(&bin_str, &["-I", "-c", "import sys, venv; sys.exit(sys.version_info < (3, 9))"]) {
            return Ok(bin_str);
        }
    }

    let tools_dir = app_dir.join("tools");
    fs::create_dir_all(&tools_dir)
        .map_err(|e| format!("No se pudo preparar la carpeta local de herramientas: {e}"))?;
    let runtime_dir = tools_dir.join("python-runtime");
    let _ = fs::remove_dir_all(&runtime_dir);
    fs::create_dir_all(&runtime_dir)
        .map_err(|e| format!("No se pudo crear la carpeta del motor Python local: {e}"))?;

    if cfg!(target_os = "windows") {
        let pkg_url = if cfg!(target_arch = "aarch64") {
            "https://www.nuget.org/api/v2/package/pythonarm64/3.12.8"
        } else {
            "https://www.nuget.org/api/v2/package/python/3.12.8"
        };
        let tmp_zip = tools_dir.join("python-runtime-tmp.zip");
        let tmp_zip_str = tmp_zip.to_string_lossy().to_string();
        let runtime_dir_str = runtime_dir.to_string_lossy().to_string();
        let script = format!(
            "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '{}' -OutFile '{}' -UseBasicParsing; Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
            pkg_url,
            tmp_zip_str.replace('\'', "''"),
            tmp_zip_str.replace('\'', "''"),
            runtime_dir_str.replace('\'', "''")
        );
        let res = run_cmd(
            "powershell.exe",
            &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script],
        );
        let _ = fs::remove_file(&tmp_zip);
        match res {
            Ok((true, _, _)) => {}
            Ok((false, _, stderr)) => {
                return Err(format!("No se pudo descargar el motor automático para iPhone: {stderr}"));
            }
            Err(err) => return Err(err),
        }
    } else {
        let triple = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            "aarch64-apple-darwin"
        } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
            "x86_64-apple-darwin"
        } else {
            "x86_64-unknown-linux-gnu"
        };
        let tar_url = format!(
            "https://github.com/astral-sh/python-build-standalone/releases/download/20241206/cpython-3.12.8%2B20241206-{triple}-install_only_stripped.tar.gz"
        );
        let tmp_tar = tools_dir.join("python-runtime-tmp.tar.gz");
        let tmp_tar_str = tmp_tar.to_string_lossy().to_string();
        let runtime_dir_str = runtime_dir.to_string_lossy().to_string();
        let res = run_cmd("curl", &["-fsSL", &tar_url, "-o", &tmp_tar_str]).and_then(|(ok, _, err)| {
            if !ok {
                return Err(format!("Fallo descargando motor Python local: {err}"));
            }
            run_cmd("tar", &["-xzf", &tmp_tar_str, "-C", &runtime_dir_str])
        });
        let _ = fs::remove_file(&tmp_tar);
        match res {
            Ok((true, _, _)) => {}
            Ok((false, _, stderr)) => {
                return Err(format!("No se pudo extraer el motor automático para iPhone: {stderr}"));
            }
            Err(err) => return Err(err),
        }
    }

    let bin_str = target_bin.to_string_lossy().to_string();
    if !target_bin.is_file()
        || !is_runnable_binary(&bin_str, &["-I", "-c", "import sys, venv; sys.exit(sys.version_info < (3, 9))"])
    {
        return Err("El motor automático descargado no pudo iniciarse en este equipo.".to_string());
    }
    Ok(bin_str)
}

fn pymobiledevice_tool(python: &str) -> Option<IosTool> {
    is_runnable_binary(python, &["-I", "-m", "pymobiledevice3", "--help"]).then(|| IosTool {
        kind: "pymobiledevice3",
        cmd: python.to_string(),
        prefix: vec!["-I".into(), "-m".into(), "pymobiledevice3".into()],
        has_crash: true,
    })
}

#[tauri::command]
pub async fn install_ios_connector(app: tauri::AppHandle) -> Result<Value, String> {
    let app_dir = app.path().app_data_dir().map_err(|_| "No se pudo abrir la carpeta de herramientas de OMEGA.")?;
    tauri::async_runtime::spawn_blocking(move || install_ios_connector_at(&app_dir))
        .await
        .map_err(|_| "No se pudo completar la instalación del conector.".to_string())
}

fn install_ios_connector_at(app_dir: &Path) -> Value {
    let Ok(_lock) = IOS_CONNECTOR_INSTALL.try_lock() else {
        return json!({"ok": false, "error": "Ya se está instalando el conector para iPhone."});
    };
    if resolve_ios_tools(Some(app_dir)).is_some() {
        return json!({"ok": true});
    }
    let environment = ios_environment(app_dir);
    let venv_python = ios_environment_python(&environment);
    let executable = venv_python.to_string_lossy().to_string();
    if !is_runnable_binary(&executable, &["-I", "-m", "pip", "--version"]) {
        let system_python = ["py", "python3", "python"]
            .into_iter()
            .find(|python| {
                is_runnable_binary(python, &["-I", "-c", "import sys, venv; sys.exit(sys.version_info < (3, 9))"])
            })
            .map(str::to_string);

        let mut venv_ready = false;
        if let Some(ref sys_py) = system_python {
            venv_ready = is_runnable_binary(sys_py, &["-I", "-m", "venv", &environment.to_string_lossy()]);
        }

        if !venv_ready {
            let _ = fs::remove_dir_all(&environment);
            let portable_py = match ensure_portable_python(app_dir) {
                Ok(py) => py,
                Err(_) => {
                    return json!({
                        "ok": false,
                        "code": "PYTHON_REQUIRED",
                        "error": "No se pudo descargar automáticamente el entorno base para iPhone. Comprueba tu conexión a Internet o instala Python 3.9+."
                    });
                }
            };
            if !is_runnable_binary(&portable_py, &["-I", "-m", "venv", &environment.to_string_lossy()]) {
                return json!({
                    "ok": false,
                    "error": "No se pudo preparar la carpeta aislada del conector para iPhone."
                });
            }
        }
    }
    if !is_runnable_binary(&executable, &[
        "-I", "-c", "import os, runpy; os.environ['PIP_CONFIG_FILE'] = os.devnull; runpy.run_module('pip', run_name='__main__')",
        "--isolated", "--disable-pip-version-check", "install",
        "--no-input", "--only-binary=:all:", "--index-url", "https://pypi.org/simple", IOS_CONNECTOR_PACKAGE,
    ]) {
        return json!({"ok": false, "error": "No se pudo descargar o instalar el conector. Comprueba tu conexión a Internet e inténtalo de nuevo."});
    }
    if pymobiledevice_tool(&executable).is_none() {
        return json!({"ok": false, "error": "El conector se descargó, pero no pudo iniciarse. Vuelve a intentar la instalación."});
    }
    json!({"ok": true})
}

#[tauri::command]
pub fn open_ios_prerequisite(app: tauri::AppHandle, prerequisite: String) -> Result<(), String> {
    let url = match prerequisite.as_str() {
        "python" => "https://www.python.org/downloads/",
        "apple" => "https://www.apple.com/itunes/download/win64",
        _ => return Err("Requisito de iPhone desconocido.".into()),
    };
    #[allow(deprecated)]
    app.shell().open(url, None).map_err(|_| "No se pudo abrir la página de descarga.".into())
}

fn resolve_ios_tools(app_dir: Option<&Path>) -> Option<IosTool> {
    if let Some(app_dir) = app_dir {
        let app_python = ios_environment_python(&ios_environment(app_dir));
        if app_python.is_file() {
            if let Some(tool) = pymobiledevice_tool(&app_python.to_string_lossy()) {
                return Some(tool);
            }
        }
    }
    if is_runnable_binary("idevice_id", &["--version"]) {
        let has_crash = is_runnable_binary("idevicecrashreport", &["--help"]);
        return Some(IosTool {
            kind: "libimobiledevice",
            cmd: "idevice_id".to_string(),
            prefix: Vec::new(),
            has_crash,
        });
    }
    if is_runnable_binary("pymobiledevice3", &["--help"]) {
        return Some(IosTool {
            kind: "pymobiledevice3",
            cmd: "pymobiledevice3".to_string(),
            prefix: Vec::new(),
            has_crash: true,
        });
    }
    for py in ["python", "python3", "py"] {
        if is_runnable_binary(py, &["-m", "pymobiledevice3", "--help"]) {
            return Some(IosTool {
                kind: "pymobiledevice3",
                cmd: py.to_string(),
                prefix: vec!["-m".to_string(), "pymobiledevice3".to_string()],
                has_crash: true,
            });
        }
    }
    None
}

pub fn read_xml_plist_string(text: &str, key: &str) -> String {
    let needle = format!("<key>{key}</key>");
    let Some(pos) = text.find(&needle) else {
        return String::new();
    };
    let rest = &text[pos + needle.len()..];
    for tag in ["string", "date"] {
        let open = format!("<{tag}>");
        let close = format!("</{tag}>");
        if let Some(s_idx) = rest.find(&open) {
            if rest[..s_idx].trim().is_empty() {
                let after_open = &rest[s_idx + open.len()..];
                if let Some(e_idx) = after_open.find(&close) {
                    return after_open[..e_idx].trim().to_string();
                }
            }
        }
    }
    String::new()
}

pub fn read_backup_metadata(backup_dir: &Path) -> Option<Value> {
    let info_path = backup_dir.join("Info.plist");
    let manifest_db_path = backup_dir.join("Manifest.db");
    let manifest_plist_path = backup_dir.join("Manifest.plist");
    if !info_path.exists() && !manifest_db_path.exists() && !manifest_plist_path.exists() {
        return None;
    }

    let id = backup_dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "iOS Backup".to_string());
    let mut device_name = id.clone();
    let mut product_type = String::new();
    let mut ios_version = String::new();
    let mut last_backup_date = String::new();

    if let Ok(info_raw) = fs::read_to_string(&info_path) {
        let dn = read_xml_plist_string(&info_raw, "Device Name");
        if !dn.is_empty() {
            device_name = dn;
        }
        product_type = read_xml_plist_string(&info_raw, "Product Type");
        ios_version = read_xml_plist_string(&info_raw, "Product Version");
        last_backup_date = read_xml_plist_string(&info_raw, "Last Backup Date");
    }

    let has_manifest_db = manifest_db_path.is_file();
    let mut encrypted = false;
    if has_manifest_db {
        if let Ok(mut file) = fs::File::open(&manifest_db_path) {
            let mut header = [0u8; 16];
            if file.read_exact(&mut header).is_ok() {
                encrypted = &header != SQLITE_MAGIC;
            } else {
                encrypted = true;
            }
        } else {
            encrypted = true;
        }
    } else if let Ok(m_text) = fs::read_to_string(&manifest_plist_path) {
        let compact: String = m_text.chars().filter(|c| !c.is_whitespace()).collect();
        if compact.contains("<key>IsEncrypted</key><true/>") {
            encrypted = true;
        }
    }

    let mtime_ms = fs::metadata(backup_dir)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    Some(json!({
        "id": id,
        "path": backup_dir.to_string_lossy(),
        "deviceName": device_name,
        "productType": product_type,
        "iosVersion": ios_version,
        "lastBackupDate": last_backup_date,
        "hasManifestDb": has_manifest_db,
        "encrypted": encrypted,
        "mtimeMs": mtime_ms
    }))
}

fn discover_local_ios_backups() -> Vec<Value> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "windows") {
        if let Ok(appdata) = std::env::var("APPDATA") {
            roots.push(
                PathBuf::from(appdata)
                    .join("Apple Computer")
                    .join("MobileSync")
                    .join("Backup"),
            );
        }
        if let Ok(home) = std::env::var("USERPROFILE") {
            roots.push(
                PathBuf::from(home)
                    .join("Apple")
                    .join("MobileSync")
                    .join("Backup"),
            );
        }
    } else if cfg!(target_os = "macos") {
        if let Ok(home) = std::env::var("HOME") {
            roots.push(
                PathBuf::from(home)
                    .join("Library")
                    .join("Application Support")
                    .join("MobileSync")
                    .join("Backup"),
            );
        }
    } else if let Ok(home) = std::env::var("HOME") {
        roots.push(
            PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("MobileSync")
                .join("Backup"),
        );
    }

    let mut found: Vec<Value> = Vec::new();
    for root in roots {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if let Some(meta) = read_backup_metadata(&p) {
                    found.push(meta);
                }
            }
        }
    }

    found.sort_by(|a, b| {
        let ma = a.get("mtimeMs").and_then(Value::as_u64).unwrap_or(0);
        let mb = b.get("mtimeMs").and_then(Value::as_u64).unwrap_or(0);
        mb.cmp(&ma)
    });
    found.truncate(8);
    found
}

fn parse_key_value_lines(raw: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for line in raw.lines() {
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim();
            if !key.is_empty() {
                out.insert(key.to_string(), v.trim().to_string());
            }
        }
    }
    out
}

#[tauri::command]
pub fn check_ios_status(app: tauri::AppHandle) -> Value {
    let local_backups = discover_local_ios_backups();
    let apple_support = has_apple_mobile_device_support();
    let app_dir = app.path().app_data_dir().ok();
    let Some(tools) = resolve_ios_tools(app_dir.as_deref()) else {
        let reason = if cfg!(target_os = "windows") && !apple_support {
            "Por seguridad de Apple, un iPhone no deja revisar archivos por cable sin drivers de iTunes/Dispositivos Apple. No pasa nada: puedes revisarlo igual con un reporte rápido (Paso 1 abajo) o una copia de seguridad en esta PC."
        } else {
            "No hace falta instalar cables extra para revisar tu iPhone: genera el reporte rápido en tu teléfono o elige abajo una copia de seguridad guardada en esta computadora."
        };
        return json!({
            "tools_available": false,
            "tool_name": Value::Null,
            "apple_driver_present": apple_support,
            "connected": false,
            "status_code": "TOOLS_MISSING",
            "device": Value::Null,
            "local_backups": local_backups,
            "reason": reason
        });
    };

    let mut udids: Vec<String> = Vec::new();
    if tools.kind == "libimobiledevice" {
        if let Ok((true, stdout, _)) = run_cmd("idevice_id", &["-l"]) {
            udids = stdout
                .lines()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect();
        }
    } else {
        let mut args: Vec<&str> = tools.prefix.iter().map(String::as_str).collect();
        args.extend_from_slice(&["usbmux", "list"]);
        if let Ok((true, stdout, _)) = run_cmd(&tools.cmd, &args) {
            if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&stdout) {
                for item in items {
                    let conn = item
                        .get("ConnectionType")
                        .and_then(Value::as_str)
                        .unwrap_or("USB");
                    if conn.eq_ignore_ascii_case("USB") {
                        if let Some(id) = item
                            .get("UniqueDeviceID")
                            .or_else(|| item.get("Identifier"))
                            .and_then(Value::as_str)
                        {
                            if !id.is_empty() {
                                udids.push(id.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    let Some(udid) = udids.first().cloned() else {
        return json!({
            "tools_available": true,
            "tool_name": tools.kind,
            "apple_driver_present": apple_support,
            "connected": false,
            "status_code": "NO_DEVICE",
            "device": Value::Null,
            "local_backups": local_backups,
            "reason": "Computadora lista para iPhone. Conéctalo por cable y toca \"Confiar\" en su pantalla (como en la imagen 2), o elige abajo una copia de seguridad."
        });
    };

    if tools.kind == "libimobiledevice" {
        match run_cmd("ideviceinfo", &["-u", &udid]) {
            Ok((true, main_out, _)) if !main_out.is_empty() => {
                let info = parse_key_value_lines(&main_out);
                let bak = run_cmd("ideviceinfo", &["-u", &udid, "-q", "com.apple.mobile.backup"])
                    .ok()
                    .map(|(_, out, _)| parse_key_value_lines(&out))
                    .unwrap_or_default();
                json!({
                    "tools_available": true,
                    "tool_name": tools.kind,
                    "apple_driver_present": apple_support,
                    "connected": true,
                    "status_code": "READY",
                    "local_backups": local_backups,
                    "device": {
                        "platform": "ios",
                        "udid": udid,
                        "name": info.get("DeviceName").cloned().unwrap_or_else(|| "iPhone / iPad".to_string()),
                        "model": info.get("ProductType").or_else(|| info.get("DeviceClass")).cloned().unwrap_or_else(|| "iOS Device".to_string()),
                        "ios_version": info.get("ProductVersion").cloned().unwrap_or_default(),
                        "build_version": info.get("BuildVersion").cloned().unwrap_or_default(),
                        "backup_encrypted": bak.get("WillEncrypt").or_else(|| info.get("WillEncrypt")),
                        "developer_mode": info.get("DeveloperModeStatus")
                    },
                    "reason": "iPhone emparejado por Lockdown en modo solo lectura."
                })
            }
            _ => json!({
                "tools_available": true,
                "tool_name": tools.kind,
                "apple_driver_present": apple_support,
                "connected": false,
                "status_code": "UNPAIRED",
                "device": { "udid": udid },
                "local_backups": local_backups,
                "reason": "¡iPhone conectado! Desbloquea su pantalla y toca \"Confiar\" cuando pregunte si confías en esta computadora."
            }),
        }
    } else {
        let mut args: Vec<&str> = tools.prefix.iter().map(String::as_str).collect();
        args.extend_from_slice(&["lockdown", "info", "--udid", &udid]);
        match run_cmd(&tools.cmd, &args) {
            Ok((true, stdout, _)) => {
                let info: Value = serde_json::from_str(&stdout).unwrap_or_else(|_| json!({}));
                json!({
                    "tools_available": true,
                    "tool_name": tools.kind,
                    "apple_driver_present": apple_support,
                    "connected": true,
                    "status_code": "READY",
                    "local_backups": local_backups,
                    "device": {
                        "platform": "ios",
                        "udid": udid,
                        "name": info.get("DeviceName").and_then(Value::as_str).unwrap_or("iPhone / iPad"),
                        "model": info.get("ProductType").or_else(|| info.get("DeviceClass")).and_then(Value::as_str).unwrap_or("iOS Device"),
                        "ios_version": info.get("ProductVersion").and_then(Value::as_str).unwrap_or(""),
                        "build_version": info.get("BuildVersion").and_then(Value::as_str).unwrap_or(""),
                        "backup_encrypted": info.get("WillEncrypt"),
                        "developer_mode": info.get("DeveloperModeStatus")
                    },
                    "reason": "iPhone emparejado por Lockdown en modo solo lectura."
                })
            }
            _ => json!({
                "tools_available": true,
                "tool_name": tools.kind,
                "apple_driver_present": apple_support,
                "connected": false,
                "status_code": "UNPAIRED",
                "device": { "udid": udid },
                "local_backups": local_backups,
                "reason": "¡iPhone conectado! Desbloquea su pantalla y toca \"Confiar\" cuando pregunte si confías en esta computadora."
            }),
        }
    }
}

fn collect_crashlogs_from_dir(dir: &Path, out: &mut Vec<Value>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= 25 {
            return;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_crashlogs_from_dir(&path, out);
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if ["ips", "crash", "log", "json"]
                .iter()
                .any(|allowed| ext.eq_ignore_ascii_case(allowed))
            {
                if let Ok(meta) = fs::metadata(&path) {
                    if meta.len() > 0 && meta.len() <= 3 * 1024 * 1024 {
                        if let Ok(content) = fs::read_to_string(&path) {
                            let filename = path
                                .file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_default();
                            out.push(json!({
                                "filename": filename,
                                "content": content
                            }));
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub fn collect_ios_snapshot(app: tauri::AppHandle, udid: Option<String>) -> Result<Value, String> {
    let app_dir = app.path().app_data_dir().ok();
    let Some(tools) = resolve_ios_tools(app_dir.as_deref()) else {
        return Err(
            "No se encontró pymobiledevice3 ni libimobiledevice para extracción USB directa en iOS."
                .to_string(),
        );
    };
    let udid_clean = udid.unwrap_or_default().trim().to_string();

    let (name, model, ios_version, build_version, backup_encrypted, developer_mode) =
        if tools.kind == "libimobiledevice" {
            let args: Vec<&str> = if udid_clean.is_empty() {
                Vec::new()
            } else {
                vec!["-u", &udid_clean]
            };
            let (ok, main_out, stderr) = run_cmd("ideviceinfo", &args)?;
            if !ok && main_out.is_empty() {
                return Err(stderr);
            }
            let info = parse_key_value_lines(&main_out);
            (
                info.get("DeviceName")
                    .cloned()
                    .unwrap_or_else(|| "iPhone / iPad".to_string()),
                info.get("ProductType")
                    .or_else(|| info.get("DeviceClass"))
                    .cloned()
                    .unwrap_or_else(|| "iOS Device".to_string()),
                info.get("ProductVersion").cloned().unwrap_or_default(),
                info.get("BuildVersion").cloned().unwrap_or_default(),
                info.get("WillEncrypt").map(|v| Value::String(v.clone())).unwrap_or(Value::Null),
                info.get("DeveloperModeStatus")
                    .map(|v| Value::String(v.clone()))
                    .unwrap_or(Value::Null),
            )
        } else {
            let mut args: Vec<&str> = tools.prefix.iter().map(String::as_str).collect();
            args.extend_from_slice(&["lockdown", "info"]);
            if !udid_clean.is_empty() {
                args.push("--udid");
                args.push(&udid_clean);
            }
            let (ok, stdout, stderr) = run_cmd(&tools.cmd, &args)?;
            if !ok && stdout.is_empty() {
                return Err(stderr);
            }
            let info: Value = serde_json::from_str(&stdout).unwrap_or_else(|_| json!({}));
            (
                info.get("DeviceName")
                    .and_then(Value::as_str)
                    .unwrap_or("iPhone / iPad")
                    .to_string(),
                info.get("ProductType")
                    .or_else(|| info.get("DeviceClass"))
                    .and_then(Value::as_str)
                    .unwrap_or("iOS Device")
                    .to_string(),
                info.get("ProductVersion")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                info.get("BuildVersion")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                info.get("WillEncrypt").cloned().unwrap_or(Value::Null),
                info.get("DeveloperModeStatus").cloned().unwrap_or(Value::Null),
            )
        };

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp_dir = std::env::temp_dir().join(format!("omega-ios-ram-{stamp}"));
    let _ = fs::create_dir_all(&tmp_dir);
    let tmp_str = tmp_dir.to_string_lossy().to_string();

    if tools.kind == "libimobiledevice" && tools.has_crash {
        let args: Vec<&str> = if udid_clean.is_empty() {
            vec!["-e", &tmp_str]
        } else {
            vec!["-u", &udid_clean, "-e", &tmp_str]
        };
        let _ = run_cmd("idevicecrashreport", &args);
    } else if tools.kind == "pymobiledevice3" {
        let mut args: Vec<&str> = tools.prefix.iter().map(String::as_str).collect();
        args.extend_from_slice(&["crash", "pull", &tmp_str]);
        if !udid_clean.is_empty() {
            args.push("--udid");
            args.push(&udid_clean);
        }
        let _ = run_cmd(&tools.cmd, &args);
    }

    let mut crashlogs = Vec::new();
    collect_crashlogs_from_dir(&tmp_dir, &mut crashlogs);
    let _ = fs::remove_dir_all(&tmp_dir);

    Ok(json!({
        "platform": "ios",
        "device": {
            "platform": "ios",
            "name": name,
            "model": model,
            "ios_version": ios_version,
            "build_version": build_version,
            "backup_encrypted": backup_encrypted,
            "developer_mode": developer_mode
        },
        "crashlogs": crashlogs
    }))
}

#[tauri::command]
pub fn pick_ios_backup_dir(backup_path: Option<String>) -> Value {
    let raw = backup_path
        .filter(|s| !s.trim().is_empty())
        .or_else(|| pick_file_native_dialog(true, "Seleccionar carpeta de respaldo iOS (contiene Manifest.db)"));

    let Some(chosen) = raw else {
        return json!({ "canceled": true });
    };

    let path = PathBuf::from(chosen.trim());
    match read_backup_metadata(&path) {
        Some(meta) => json!({
            "canceled": false,
            "valid": true,
            "backup": meta
        }),
        None => json!({
            "canceled": false,
            "valid": false,
            "error": "La carpeta seleccionada no contiene Info.plist ni Manifest.db de un respaldo iOS."
        }),
    }
}

#[tauri::command]
pub fn read_ios_backup_manifest(backup_path: String) -> Result<Value, String> {
    let resolved_dir = PathBuf::from(backup_path.trim());
    let manifest_path = resolved_dir.join("Manifest.db");
    let manifest_plist_path = resolved_dir.join("Manifest.plist");
    if !manifest_path.is_file() {
        return Err(
            "No se encontró Manifest.db en la carpeta de respaldo seleccionada.".to_string(),
        );
    }
    let meta_stat = fs::metadata(&manifest_path)
        .map_err(|e| format!("No se pudo inspeccionar Manifest.db: {e}"))?;
    if meta_stat.len() > 64 * 1024 * 1024 {
        return Err("Manifest.db supera el límite de 64 MB en memoria.".to_string());
    }
    let raw =
        fs::read(&manifest_path).map_err(|e| format!("No se pudo leer Manifest.db: {e}"))?;
    let is_encrypted = raw.len() < 16 || &raw[..16] != SQLITE_MAGIC;
    let manifest_plist_b64 = if manifest_plist_path.is_file() {
        fs::read(&manifest_plist_path)
            .map(|b| encode_base64(&b))
            .unwrap_or_default()
    } else {
        String::new()
    };

    Ok(json!({
        "backup": read_backup_metadata(&resolved_dir),
        "encrypted": is_encrypted,
        "manifest_b64": encode_base64(&raw),
        "manifest_plist_b64": manifest_plist_b64
    }))
}

#[derive(Debug, Clone, Deserialize)]
pub struct IosArtifactTarget {
    pub file_id: String,
    pub relative_path: Option<String>,
}

fn is_valid_hex_file_id(file_id: &str) -> bool {
    let len = file_id.len();
    (32..=64).contains(&len) && file_id.chars().all(|c| c.is_ascii_hexdigit())
}

#[tauri::command]
pub fn read_ios_backup_artifacts(
    backup_path: String,
    encrypted: Option<bool>,
    targets: Option<Vec<IosArtifactTarget>>,
) -> Result<Value, String> {
    let resolved_dir = PathBuf::from(backup_path.trim());
    let manifest_path = resolved_dir.join("Manifest.db");
    if !manifest_path.is_file() {
        return Err("Carpeta de respaldo iOS no válida.".to_string());
    }

    let is_encrypted = encrypted.unwrap_or(false);
    let mut artifacts: Vec<Value> = Vec::new();
    let mut total_bytes: usize = 0;

    if !is_encrypted {
        if let Ok(manifest_buf) = fs::read(&manifest_path) {
            if !manifest_buf.is_empty() && manifest_buf.len() <= 25 * 1024 * 1024 {
                total_bytes += manifest_buf.len();
                artifacts.push(json!({
                    "filename": "Manifest.db",
                    "content_b64": encode_base64(&manifest_buf)
                }));
            }
        }
    }

    for tgt in targets.unwrap_or_default().into_iter().take(35) {
        let file_id = tgt.file_id.trim();
        if !is_valid_hex_file_id(file_id) {
            continue;
        }
        let sub_path = resolved_dir.join(&file_id[..2]).join(file_id);
        let flat_path = resolved_dir.join(file_id);
        let chosen = if sub_path.is_file() {
            sub_path
        } else if flat_path.is_file() {
            flat_path
        } else {
            continue;
        };

        let Ok(st) = fs::metadata(&chosen) else {
            continue;
        };
        let len = st.len() as usize;
        if !st.is_file() || len == 0 || len > 25 * 1024 * 1024 {
            continue;
        }
        if total_bytes + len > 85 * 1024 * 1024 {
            break;
        }
        let Ok(bytes) = fs::read(&chosen) else {
            continue;
        };
        total_bytes += bytes.len();
        let rel = tgt
            .relative_path
            .as_deref()
            .unwrap_or(file_id)
            .trim_start_matches('/');
        let filename = rel
            .rsplit('/')
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or(file_id);
        artifacts.push(json!({
            "file_id": file_id,
            "filename": filename,
            "content_b64": encode_base64(&bytes)
        }));
    }

    let meta = read_backup_metadata(&resolved_dir);
    let device_name = meta
        .as_ref()
        .and_then(|m| m.get("deviceName"))
        .and_then(Value::as_str)
        .unwrap_or("Respaldo iOS");
    let model = meta
        .as_ref()
        .and_then(|m| m.get("productType"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("iPhone Backup");
    let ios_version = meta
        .as_ref()
        .and_then(|m| m.get("iosVersion"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let meta_enc = meta
        .as_ref()
        .and_then(|m| m.get("encrypted"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    Ok(json!({
        "platform": "ios",
        "device": {
            "platform": "ios",
            "name": device_name,
            "model": model,
            "ios_version": ios_version,
            "backup_encrypted": encrypted.unwrap_or(meta_enc)
        },
        "binary_artifacts": artifacts
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_adb_devices_list_correctly() {
        let sample = "List of devices attached\nR58M42ABCDE            device usb:1-1 product:starlte model:SM_G960F device:starlte\nemulator-5554          unauthorized\n";
        let list = parse_adb_devices(sample);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].serial, "R58M42ABCDE");
        assert_eq!(list[0].state, "device");
        assert_eq!(list[0].model, "SM G960F");
        assert_eq!(list[1].serial, "emulator-5554");
        assert_eq!(list[1].state, "unauthorized");
    }

    #[test]
    fn reads_ios_backup_manifest_and_artifacts_in_ram() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("omega-ios-backup-test-{stamp}"));
        let sub = dir.join("ab");
        fs::create_dir_all(&sub).unwrap();

        let info_plist = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Device Name</key><string>iPhone de Periodista</string>
  <key>Product Type</key><string>iPhone15,2</string>
  <key>Product Version</key><string>17.4.1</string>
</dict></plist>"#;
        fs::write(dir.join("Info.plist"), info_plist).unwrap();

        let mut sqlite_bytes = Vec::from(&SQLITE_MAGIC[..]);
        sqlite_bytes.extend_from_slice(b"dummy-manifest-payload");
        fs::write(dir.join("Manifest.db"), &sqlite_bytes).unwrap();

        let file_id = "abcdef0123456789abcdef0123456789abcdef01";
        fs::write(sub.join(file_id), b"sms-db-content").unwrap();

        let manifest_res = read_ios_backup_manifest(dir.to_string_lossy().to_string()).unwrap();
        assert_eq!(manifest_res["encrypted"], false);
        assert_eq!(
            manifest_res["backup"]["deviceName"],
            "iPhone de Periodista"
        );
        assert_eq!(
            manifest_res["manifest_b64"],
            encode_base64(&sqlite_bytes)
        );

        let artifacts_res = read_ios_backup_artifacts(
            dir.to_string_lossy().to_string(),
            Some(false),
            Some(vec![IosArtifactTarget {
                file_id: file_id.to_string(),
                relative_path: Some("HomeDomain/Library/SMS/sms.db".to_string()),
            }]),
        )
        .unwrap();

        let arr = artifacts_res["binary_artifacts"].as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["filename"], "Manifest.db");
        assert_eq!(arr[1]["filename"], "sms.db");
        assert_eq!(arr[1]["content_b64"], encode_base64(b"sms-db-content"));

        let _ = fs::remove_dir_all(&dir);
    }
}
