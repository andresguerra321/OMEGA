use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use sysinfo::System;

use crate::telemetry;

type HmacSha256 = Hmac<Sha256>;

const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const TIMESTAMP_SKEW_SECS: i64 = 300;
const NONCE_TTL_SECS: i64 = 600;
const WATCH_INTERVAL_SECS: u64 = 10;

#[derive(Debug, Clone, Deserialize)]
struct SyncPayload {
    #[serde(default)]
    indicators: Vec<HostIndicatorInput>,
}

#[derive(Debug, Clone, Deserialize)]
struct HostIndicatorInput {
    #[serde(default)]
    ioc_type: String,
    #[serde(default)]
    ioc_value: String,
    #[serde(default)]
    source: String,
}

#[derive(Debug, Clone, Deserialize)]
struct TogglePayload {
    enabled: bool,
}

struct WatcherState {
    enabled: bool,
    running: bool,
    hostname: String,
    platform: &'static str,
    last_check: Option<String>,
    dns_coverage: String,
    catalog_loaded: bool,
    catalog_version: Option<String>,
    indicator_count: usize,
    blocked_ips: HashMap<String, String>,
    blocked_domains: HashMap<String, String>,
    blocked_hashes: HashMap<String, String>,
    alerts: Vec<Value>,
    seen_alert_ids: HashSet<String>,
}

impl WatcherState {
    fn new() -> Self {
        Self {
            enabled: true,
            running: true,
            hostname: System::host_name().unwrap_or_else(|| "omega-host".to_string()),
            platform: match std::env::consts::OS {
                "windows" => "win32",
                "macos" => "darwin",
                other => other,
            },
            last_check: None,
            dns_coverage: if cfg!(windows) {
                "cache-no-pid".to_string()
            } else {
                "socket-only".to_string()
            },
            catalog_loaded: false,
            catalog_version: None,
            indicator_count: 0,
            blocked_ips: HashMap::new(),
            blocked_domains: HashMap::new(),
            blocked_hashes: HashMap::new(),
            alerts: Vec::new(),
            seen_alert_ids: HashSet::new(),
        }
    }

    fn status_json(&self) -> Value {
        let active = self.enabled && self.running;
        let state = if active {
            "watching"
        } else if self.enabled {
            "starting"
        } else {
            "paused"
        };
        let notice = if active {
            "Vigilancia local activa mediante omega-sensor nativo en esta computadora (solo lectura en RAM)."
        } else {
            "La vigilancia local está en pausa. Puedes reactivarla cuando quieras."
        };
        json!({
            "enabled": self.enabled,
            "running": self.running,
            "active": active,
            "state": state,
            "scope": "native-host",
            "hostname": self.hostname,
            "platform": self.platform,
            "intervalSeconds": WATCH_INTERVAL_SECS as f64,
            "lastCheck": self.last_check,
            "indicatorCount": self.indicator_count,
            "catalogLoaded": self.catalog_loaded,
            "catalogVersion": self.catalog_version,
            "catalogError": Value::Null,
            "sensorError": Value::Null,
            "dnsCoverage": self.dns_coverage,
            "alerts": self.alerts,
            "alertCount": self.alerts.len(),
            "capabilities": {
                "blocking": false,
                "eventBasedCapture": false
            },
            "notice": notice
        })
    }

    fn push_alert(&mut self, id: String, alert: Value) {
        if self.seen_alert_ids.insert(id) {
            if self.alerts.len() >= 100 {
                self.alerts.remove(0);
            }
            self.alerts.push(alert);
        }
    }
}

pub fn derive_sensor_key(token: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hasher.finalize().into()
}

pub fn sign_gateway_message(
    key: &[u8; 32],
    direction: &str,
    method_or_status: &str,
    target: &str,
    stamp: &str,
    nonce: &str,
    body: &[u8],
    host_actor: &str,
    content_type: &str,
) -> String {
    let mut body_hasher = Sha256::new();
    body_hasher.update(body);
    let body_hash = hex::encode(body_hasher.finalize());

    let canon_actor = host_actor.trim();
    let canon_ct = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    let message = format!(
        "{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}",
        direction,
        method_or_status.to_ascii_uppercase(),
        target,
        stamp,
        nonce,
        body_hash,
        canon_actor,
        canon_ct
    );

    let mut mac = HmacSha256::new_from_slice(key).expect("32-byte key is valid");
    mac.update(message.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn now_epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(windows)]
fn query_windows_dns_cache() -> Vec<String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let script = "$ErrorActionPreference='SilentlyContinue'; @(Get-DnsClientCache | Select-Object -ExpandProperty Entry -Unique) | ConvertTo-Json -Compress";
    let Ok(out) = Command::new("powershell.exe")
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x0800_0000)
        .output()
    else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    serde_json::from_slice::<Vec<String>>(&out.stdout)
        .unwrap_or_default()
        .into_iter()
        .map(|d| d.trim().trim_end_matches('.').to_ascii_lowercase())
        .filter(|d| !d.is_empty())
        .collect()
}

#[cfg(not(windows))]
fn query_windows_dns_cache() -> Vec<String> {
    Vec::new()
}

fn file_sha256_hex(path: &str) -> Option<String> {
    if path.is_empty() {
        return None;
    }
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > 64 * 1024 * 1024 {
        return None;
    }
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Some(hex::encode(hasher.finalize()))
}

fn run_watch_cycle(shared: &Arc<Mutex<WatcherState>>) {
    let enabled = shared.lock().map(|g| g.enabled).unwrap_or(false);
    if !enabled {
        return;
    }

    let snap = telemetry::collect_snapshot();
    let dns_entries = query_windows_dns_cache();
    let now_iso = Utc::now().to_rfc3339();

    let Ok(mut state) = shared.lock() else {
        return;
    };
    if !state.enabled {
        return;
    }
    state.last_check = Some(now_iso.clone());
    if cfg!(windows) {
        state.dns_coverage = "cache-no-pid".to_string();
    }

    for finding in &snap.infostealer_alerts {
        let alert_id = format!("infostealer:{}:{}", finding.pid, finding.target_kind);
        state.push_alert(
            alert_id.clone(),
            json!({
                "id": alert_id,
                "category": "PROCESS",
                "severity": finding.severity,
                "userFriendlyTitle": format!("Acceso sospechoso a credenciales ({})", finding.process_name),
                "userFriendlyExplanation": finding.detail,
                "recommendedAction": "Revisa si reconoces este programa y considera aislar el proceso si no lo abriste tú.",
                "detail": finding.detail,
                "targetPath": finding.exe_path,
                "pid": finding.pid,
                "capturedAt": now_iso,
                "evidence": finding
            }),
        );
    }

    for sock in &snap.tcp_connections {
        let remote_ip = sock
            .get("remote_address")
            .or_else(|| sock.get("remote_ip"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if remote_ip.is_empty() {
            continue;
        }
        if let Some(source) = state.blocked_ips.get(&remote_ip).cloned() {
            let pid = sock.get("pid").and_then(Value::as_u64).unwrap_or(0);
            let alert_id = format!("net-ip:{remote_ip}:{pid}");
            state.push_alert(
                alert_id.clone(),
                json!({
                    "id": alert_id,
                    "category": "NETWORK",
                    "severity": "HIGH",
                    "remoteIp": remote_ip,
                    "pid": pid,
                    "userFriendlyTitle": format!("Conexión activa hacia dirección reportada ({remote_ip})"),
                    "userFriendlyExplanation": format!("Este equipo mantiene una conexión hacia {remote_ip}, listada en inteligencia de amenazas ({source})."),
                    "recommendedAction": "Verifica qué aplicación inició la conexión y bloquéala si no es legítima.",
                    "detail": format!("IP {remote_ip} coincide con catálogo IOC ({source})"),
                    "capturedAt": now_iso,
                    "evidence": sock
                }),
            );
        }
    }

    for domain in &dns_entries {
        let matched = state.blocked_domains.get(domain).cloned().or_else(|| {
            state
                .blocked_domains
                .iter()
                .find(|(ioc_dom, _)| domain.ends_with(&format!(".{ioc_dom}")))
                .map(|(_, src)| src.clone())
        });
        if let Some(source) = matched {
            let alert_id = format!("dns:{domain}");
            state.push_alert(
                alert_id.clone(),
                json!({
                    "id": alert_id,
                    "category": "NETWORK",
                    "severity": "HIGH",
                    "domain": domain,
                    "userFriendlyTitle": format!("Consulta DNS hacia dominio malicioso ({domain})"),
                    "userFriendlyExplanation": format!("La caché DNS de tu computadora registra resolución reciente para {domain} ({source})."),
                    "recommendedAction": "Revisa pestañas abiertas, extensiones de navegador y procesos recientes.",
                    "detail": format!("Dominio {domain} coincide con catálogo IOC ({source})"),
                    "capturedAt": now_iso,
                    "evidence": { "domain": domain, "source": source }
                }),
            );
        }
    }

    if !state.blocked_hashes.is_empty() {
        for proc_item in &snap.suspicious_processes {
            if let Some(sha) = file_sha256_hex(&proc_item.exe_path) {
                if let Some(source) = state.blocked_hashes.get(&sha).cloned() {
                    let alert_id = format!("hash:{sha}:{}", proc_item.pid);
                    state.push_alert(
                        alert_id.clone(),
                        json!({
                            "id": alert_id,
                            "category": "PROCESS",
                            "severity": "CRITICAL",
                            "sha256": sha,
                            "targetPath": proc_item.exe_path,
                            "pid": proc_item.pid,
                            "userFriendlyTitle": format!("Ejecutable malicioso conocido en memoria ({})", proc_item.name),
                            "userFriendlyExplanation": format!("El hash SHA-256 de {} coincide con un indicador malicioso verificado ({source}).", proc_item.name),
                            "recommendedAction": "Detén el proceso y pon el ejecutable en cuarentena.",
                            "detail": format!("SHA-256 {sha} coincide con {source}"),
                            "capturedAt": now_iso,
                            "evidence": proc_item
                        }),
                    );
                }
            }
        }
    }
}

fn build_persistence_audit(shared: &Arc<Mutex<WatcherState>>) -> Value {
    let snap = telemetry::collect_snapshot();
    let blocked_hashes = shared
        .lock()
        .map(|g| g.blocked_hashes.clone())
        .unwrap_or_default();

    let mut findings: Vec<Value> = Vec::new();
    let mut process_findings: Vec<Value> = Vec::new();

    for (idx, item) in snap.startup_items.iter().enumerate() {
        let name = item
            .get("name")
            .or_else(|| item.get("Name"))
            .and_then(Value::as_str)
            .unwrap_or("Elemento de inicio");
        let command = item
            .get("command")
            .or_else(|| item.get("Command"))
            .or_else(|| item.get("value"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let location = item
            .get("location")
            .or_else(|| item.get("Location"))
            .and_then(Value::as_str)
            .unwrap_or("Inicio del sistema");
        let cmd_low = command.to_ascii_lowercase();
        let suspicious = cmd_low.contains("powershell")
            || cmd_low.contains("cmd.exe /c")
            || cmd_low.contains("mshta")
            || cmd_low.contains("wscript")
            || cmd_low.contains("\\appdata\\local\\temp\\")
            || cmd_low.contains("-enc");
        if suspicious {
            findings.push(json!({
                "id": format!("startup-{idx}"),
                "category": "STARTUP",
                "persistenceType": "RUN_KEY_OR_STARTUP",
                "location": location,
                "targetPath": command,
                "sha256": Value::Null,
                "signatureStatus": "UNVERIFIED",
                "publisher": Value::Null,
                "severity": "HIGH",
                "userFriendlyTitle": format!("Inicio automático inusual: {name}"),
                "userFriendlyExplanation": "Este programa se inicia con Windows usando intérpretes de comandos o carpetas temporales.",
                "recommendedAction": "Verifica si instalaste este programa; si no lo reconoces, desactívalo del arranque.",
                "evidence": item,
                "ctiMatches": []
            }));
        }
    }

    for (idx, task) in snap.scheduled_tasks.iter().enumerate() {
        let name = task
            .get("task_name")
            .or_else(|| task.get("TaskName"))
            .and_then(Value::as_str)
            .unwrap_or("Tarea programada");
        let action = task
            .get("execute")
            .or_else(|| task.get("Execute"))
            .or_else(|| task.get("actions"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let low = action.to_ascii_lowercase();
        if low.contains("\\appdata\\local\\temp\\") || low.contains("mshta") || low.contains("-encodedcommand") {
            findings.push(json!({
                "id": format!("task-{idx}"),
                "category": "SCHEDULED_TASK",
                "persistenceType": "SCHEDULED_TASK",
                "location": name,
                "targetPath": action,
                "sha256": Value::Null,
                "signatureStatus": "UNVERIFIED",
                "publisher": Value::Null,
                "severity": "HIGH",
                "userFriendlyTitle": format!("Tarea programada sospechosa: {name}"),
                "userFriendlyExplanation": "Ejecuta comandos codificados o binarios desde una carpeta temporal.",
                "recommendedAction": "Revisa la tarea en el Programador de tareas de Windows.",
                "evidence": task,
                "ctiMatches": []
            }));
        }
    }

    for proc_item in &snap.suspicious_processes {
        let sha = file_sha256_hex(&proc_item.exe_path);
        let cti_hit = sha
            .as_ref()
            .and_then(|h| blocked_hashes.get(h))
            .cloned();
        let severity = if cti_hit.is_some() { "CRITICAL" } else { "MEDIUM" };
        process_findings.push(json!({
            "id": format!("proc-{}", proc_item.pid),
            "artifact": format!("Proceso PID {}", proc_item.pid),
            "category": "PROCESS",
            "severity": severity,
            "targetPath": proc_item.exe_path,
            "sha256": sha,
            "signatureStatus": proc_item.signature_status,
            "publisher": Value::Null,
            "userFriendlyTitle": format!("Proceso ejecutándose desde carpeta temporal ({})", proc_item.name),
            "userFriendlyExplanation": "Los programas legítimos suelen instalarse en Archivos de programa, no ejecutarse desde carpetas temporales o Descargas.",
            "recommendedAction": "Comprueba si corresponde a un instalador que acabas de abrir.",
            "evidence": proc_item
        }));
    }

    for info in &snap.infostealer_alerts {
        process_findings.push(json!({
            "id": format!("infostealer-{}", info.pid),
            "artifact": format!("Proceso PID {}", info.pid),
            "category": "PROCESS",
            "severity": info.severity,
            "targetPath": info.exe_path,
            "sha256": file_sha256_hex(&info.exe_path),
            "signatureStatus": "UNSIGNED_OR_UNTRUSTED",
            "publisher": Value::Null,
            "userFriendlyTitle": format!("Acceso sospechoso a credenciales ({})", info.process_name),
            "userFriendlyExplanation": info.detail,
            "recommendedAction": "Cierra el proceso y cambia las contraseñas afectadas si no reconoces esta aplicación.",
            "evidence": info
        }));
    }

    let processes: Vec<Value> = snap
        .processes
        .iter()
        .take(250)
        .map(|p| {
            json!({
                "pid": p.pid,
                "name": p.name,
                "exe_path": p.exe_path,
                "memory_kb": p.memory_kb,
                "suspicious_location": p.suspicious_location,
                "sha256": if p.suspicious_location { file_sha256_hex(&p.exe_path) } else { None },
                "signature": {
                    "status": p.signature_status,
                    "publisher": Value::Null,
                    "detail": if p.suspicious_location {
                        "Ejecutable ubicado en ruta temporal o de descargas."
                    } else {
                        "Ejecutable en ruta estándar del sistema."
                    }
                }
            })
        })
        .collect();

    let limitations: Vec<String> = snap
        .collection_errors
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();

    json!({
        "scope": "native-host",
        "platform": snap.platform,
        "hostname": snap.hostname,
        "collectedAt": snap.captured_at,
        "findings": findings,
        "processes": processes,
        "processFindings": process_findings,
        "limitations": limitations.clone(),
        "complete": limitations.is_empty(),
        "notice": "Auditoría de procesos y arranque completada localmente en modo de solo lectura."
    })
}

fn read_secret_token() -> Result<String, String> {
    if let Ok(env_tok) = std::env::var("OMEGA_HOST_INTERNAL_SERVICE_TOKEN")
        .or_else(|_| std::env::var("INTERNAL_SERVICE_TOKEN"))
    {
        let trimmed = env_tok.trim().to_string();
        if trimmed.len() >= 32 {
            return Ok(trimmed);
        }
    }
    let mut line = String::new();
    std::io::stdin()
        .read_line(&mut line)
        .map_err(|e| format!("No se pudo leer el token interno en stdin: {e}"))?;
    let trimmed = line.trim().to_string();
    if trimmed.len() < 32 {
        return Err("El token del sensor local debe tener al menos 32 caracteres.".to_string());
    }
    Ok(trimmed)
}

fn handle_client(
    mut stream: TcpStream,
    token: &str,
    key: &[u8; 32],
    state: &Arc<Mutex<WatcherState>>,
    nonces: &Arc<Mutex<HashMap<String, i64>>>,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));

    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).unwrap_or(0) == 0 {
        return;
    }
    let parts: Vec<&str> = request_line.trim_end().split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0].to_ascii_uppercase();
    let target = parts[1].to_string();
    let path = target.split('?').next().unwrap_or(&target);

    let mut headers: HashMap<String, String> = HashMap::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let trimmed = line.trim_end_matches(&['\r', '\n'][..]);
        if trimmed.is_empty() {
            break;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    let content_len: usize = headers
        .get("content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    if content_len > MAX_BODY_BYTES {
        let _ = write_http_response(&mut stream, 413, b"{\"error\":\"payload_too_large\"}", None);
        return;
    }
    let mut body = vec![0u8; content_len];
    if content_len > 0 && reader.read_exact(&mut body).is_err() {
        return;
    }

    let supplied_token = headers
        .get("x-internal-service-token")
        .map(String::as_str)
        .unwrap_or("");
    if !constant_time_eq(supplied_token.as_bytes(), token.as_bytes()) {
        let _ = write_http_response(&mut stream, 401, b"{\"error\":\"unauthorized\"}", None);
        return;
    }

    let stamp = headers.get("x-omega-time").cloned().unwrap_or_default();
    let nonce = headers.get("x-omega-nonce").cloned().unwrap_or_default();
    let supplied_sig = headers.get("x-omega-signature").cloned().unwrap_or_default();
    let host_actor = headers.get("x-host-actor").cloned().unwrap_or_default();
    let content_type = headers.get("content-type").cloned().unwrap_or_default();

    let mut sign_ctx: Option<(&str, &str)> = None;
    if !supplied_sig.is_empty() {
        let Ok(stamp_sec) = stamp.parse::<i64>() else {
            let _ = write_http_response(&mut stream, 401, b"{\"error\":\"invalid_timestamp\"}", None);
            return;
        };
        let now = now_epoch_secs();
        if (now - stamp_sec).abs() > TIMESTAMP_SKEW_SECS || nonce.len() < 16 {
            let _ = write_http_response(&mut stream, 401, b"{\"error\":\"expired_or_invalid_nonce\"}", None);
            return;
        }
        let expected_req_sig = sign_gateway_message(
            key,
            "request",
            &method,
            &target,
            &stamp,
            &nonce,
            &body,
            &host_actor,
            &content_type,
        );
        if !constant_time_eq(
            expected_req_sig.as_bytes(),
            supplied_sig.trim().to_ascii_lowercase().as_bytes(),
        ) {
            let _ = write_http_response(&mut stream, 401, b"{\"error\":\"invalid_hmac\"}", None);
            return;
        }
        if let Ok(mut guard) = nonces.lock() {
            guard.retain(|_, ts| now - *ts <= NONCE_TTL_SECS);
            if guard.contains_key(&nonce) {
                let _ = write_http_response(&mut stream, 401, b"{\"error\":\"replayed_nonce\"}", None);
                return;
            }
            guard.insert(nonce.clone(), now);
        }
        sign_ctx = Some((&stamp, &nonce));
    }

    let (status_code, resp_json): (u16, Value) = match (method.as_str(), path) {
        ("GET", "/api/health") => (
            200,
            json!({
                "status": "ok",
                "scope": "native-host",
                "sensor": "omega-sensor-rust",
                "version": env!("CARGO_PKG_VERSION")
            }),
        ),
        ("POST", "/api/host/iocs/sync") => match serde_json::from_slice::<SyncPayload>(&body) {
            Ok(payload) => {
                if let Ok(mut g) = state.lock() {
                    g.blocked_ips.clear();
                    g.blocked_domains.clear();
                    g.blocked_hashes.clear();
                    for ind in payload.indicators {
                        let val = ind.ioc_value.trim().to_ascii_lowercase();
                        if val.is_empty() {
                            continue;
                        }
                        let src = if ind.source.trim().is_empty() {
                            "STIX OMEGA".to_string()
                        } else {
                            ind.source.trim().to_string()
                        };
                        match ind.ioc_type.trim().to_ascii_lowercase().as_str() {
                            "ipv4-addr" | "ipv6-addr" | "ip" => {
                                g.blocked_ips.insert(val, src);
                            }
                            "domain-name" | "domain" | "hostname" => {
                                g.blocked_domains
                                    .insert(val.trim_end_matches('.').to_string(), src);
                            }
                            "file:hashes.'sha-256'" | "sha256" | "file-sha256" => {
                                g.blocked_hashes.insert(val, src);
                            }
                            _ => {
                                if val.len() == 64 && val.chars().all(|c| c.is_ascii_hexdigit()) {
                                    g.blocked_hashes.insert(val, src);
                                } else if val.parse::<std::net::IpAddr>().is_ok() {
                                    g.blocked_ips.insert(val, src);
                                } else if val.contains('.') && !val.contains('/') {
                                    g.blocked_domains
                                        .insert(val.trim_end_matches('.').to_string(), src);
                                }
                            }
                        }
                    }
                    g.indicator_count =
                        g.blocked_ips.len() + g.blocked_domains.len() + g.blocked_hashes.len();
                    g.catalog_loaded = true;
                    g.catalog_version = Some(Utc::now().to_rfc3339());
                }
                (200, json!({"ok": true}))
            }
            Err(_) => (400, json!({"error": "invalid_sync_payload"})),
        },
        ("GET", "/api/host/realtime/status") => {
            let snap_status = state
                .lock()
                .map(|g| g.status_json())
                .unwrap_or_else(|_| json!({"scope": "unavailable"}));
            (200, snap_status)
        }
        ("POST", "/api/host/realtime/toggle") => match serde_json::from_slice::<TogglePayload>(&body) {
            Ok(toggle) => {
                if let Ok(mut g) = state.lock() {
                    g.enabled = toggle.enabled;
                }
                if toggle.enabled {
                    run_watch_cycle(state);
                }
                let snap_status = state
                    .lock()
                    .map(|g| g.status_json())
                    .unwrap_or_else(|_| json!({"scope": "unavailable"}));
                (200, snap_status)
            }
            Err(_) => (422, json!({"error": "missing_enabled_boolean"})),
        },
        ("POST", "/api/host/persistence/audit") => (200, build_persistence_audit(state)),
        _ => (404, json!({"error": "not_found"})),
    };

    let resp_bytes = serde_json::to_vec(&resp_json).unwrap_or_else(|_| b"{}".to_vec());
    let resp_sig = sign_ctx.map(|(st, nc)| {
        sign_gateway_message(
            key,
            "response",
            &status_code.to_string(),
            &target,
            st,
            nc,
            &resp_bytes,
            "",
            "",
        )
    });
    let _ = write_http_response(&mut stream, status_code, &resp_bytes, resp_sig.as_deref());
}

fn write_http_response(
    stream: &mut TcpStream,
    status: u16,
    body: &[u8],
    signature: Option<&str>,
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        413 => "Payload Too Large",
        422 => "Unprocessable Entity",
        _ => "Internal Server Error",
    };
    let mut header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    if let Some(sig) = signature {
        header.push_str(&format!("X-Omega-Signature: {sig}\r\n"));
    }
    header.push_str("\r\n");
    stream.write_all(header.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

pub fn serve_loopback(bind_addr: &str) -> Result<(), String> {
    let token = read_secret_token()?;
    let key = derive_sensor_key(&token);
    let listener = TcpListener::bind(bind_addr)
        .map_err(|e| format!("No se pudo enlazar omega-sensor en {bind_addr}: {e}"))?;

    let state = Arc::new(Mutex::new(WatcherState::new()));
    let nonces = Arc::new(Mutex::new(HashMap::<String, i64>::new()));

    let watcher_state = Arc::clone(&state);
    thread::spawn(move || {
        loop {
            run_watch_cycle(&watcher_state);
            thread::sleep(Duration::from_secs(WATCH_INTERVAL_SECS));
        }
    });

    for incoming in listener.incoming() {
        if let Ok(stream) = incoming {
            let tok = token.clone();
            let k = key;
            let st = Arc::clone(&state);
            let nc = Arc::clone(&nonces);
            thread::spawn(move || {
                handle_client(stream, &tok, &k, &st, &nc);
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sensor_hmac_matches_java_gateway_canonical_signature() {
        let token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let key = derive_sensor_key(token);
        let req_sig = sign_gateway_message(
            &key,
            "request",
            "POST",
            "/api/host/realtime/toggle",
            "1700000000",
            "aabbccddeeff00112233445566778899",
            br#"{"enabled":true}"#,
            "",
            "application/json; charset=UTF-8",
        );
        let req_sig_clean = sign_gateway_message(
            &key,
            "request",
            "POST",
            "/api/host/realtime/toggle",
            "1700000000",
            "aabbccddeeff00112233445566778899",
            br#"{"enabled":true}"#,
            "",
            "application/json",
        );
        assert_eq!(req_sig, req_sig_clean);
        assert_eq!(req_sig.len(), 64);

        let resp_sig = sign_gateway_message(
            &key,
            "response",
            "200",
            "/api/host/realtime/toggle",
            "1700000000",
            "aabbccddeeff00112233445566778899",
            br#"{"ok":true}"#,
            "",
            "",
        );
        assert_ne!(req_sig, resp_sig);
        assert_eq!(resp_sig.len(), 64);
    }

    #[test]
    fn loopback_server_enforces_token_and_hmac_and_serves_host_endpoints() {
        let token = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
        let key = derive_sensor_key(token);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let state = Arc::new(Mutex::new(WatcherState::new()));
        let nonces = Arc::new(Mutex::new(HashMap::<String, i64>::new()));

        let srv_state = Arc::clone(&state);
        let srv_nonces = Arc::clone(&nonces);
        thread::spawn(move || {
            for stream in listener.incoming().take(5).flatten() {
                handle_client(stream, token, &key, &srv_state, &srv_nonces);
            }
        });

        let send_signed = |method: &str, path: &str, body: &[u8], nonce: &str, use_bad_token: bool| -> (u16, String, String) {
            let mut stream = TcpStream::connect(addr).unwrap();
            let stamp = now_epoch_secs().to_string();
            let ct = if body.is_empty() { "" } else { "application/json" };
            let sig = sign_gateway_message(&key, "request", method, path, &stamp, nonce, body, "", ct);
            let tok = if use_bad_token { "wrong-token" } else { token };
            let mut req = format!(
                "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Internal-Service-Token: {tok}\r\nX-Omega-Time: {stamp}\r\nX-Omega-Nonce: {nonce}\r\nX-Omega-Signature: {sig}\r\n"
            );
            if !body.is_empty() {
                req.push_str(&format!("Content-Type: application/json\r\nContent-Length: {}\r\n", body.len()));
            }
            req.push_str("\r\n");
            stream.write_all(req.as_bytes()).unwrap();
            if !body.is_empty() {
                stream.write_all(body).unwrap();
            }
            let mut raw = String::new();
            stream.read_to_string(&mut raw).unwrap();
            let (head, resp_body) = raw.split_once("\r\n\r\n").unwrap();
            let code: u16 = head.lines().next().unwrap().split_whitespace().nth(1).unwrap().parse().unwrap();
            let resp_sig = head
                .lines()
                .find_map(|l| l.strip_prefix("X-Omega-Signature: "))
                .unwrap_or("")
                .trim()
                .to_string();
            if code == 200 {
                let expected = sign_gateway_message(
                    &key,
                    "response",
                    &code.to_string(),
                    path,
                    &stamp,
                    nonce,
                    resp_body.as_bytes(),
                    "",
                    "",
                );
                assert_eq!(resp_sig, expected);
            }
            (code, resp_body.to_string(), resp_sig)
        };

        let (c1, _, _) = send_signed("GET", "/api/health", b"", "000102030405060708090a0b0c0d0e0f", true);
        assert_eq!(c1, 401);

        let (c2, health_body, _) = send_signed("GET", "/api/health", b"", "100102030405060708090a0b0c0d0e0f", false);
        assert_eq!(c2, 200);
        assert!(health_body.contains("\"scope\":\"native-host\""));

        // Replay with identical nonce must fail with 401
        let (c_replay, _, _) = send_signed("GET", "/api/health", b"", "100102030405060708090a0b0c0d0e0f", false);
        assert_eq!(c_replay, 401);

        let sync_json = br#"{"indicators":[{"ioc_type":"domain-name","ioc_value":"evil.example","source":"STIX"}]}"#;
        let (c3, _, _) = send_signed("POST", "/api/host/iocs/sync", sync_json, "200102030405060708090a0b0c0d0e0f", false);
        assert_eq!(c3, 200);

        let (c4, status_body, _) = send_signed("GET", "/api/host/realtime/status", b"", "300102030405060708090a0b0c0d0e0f", false);
        assert_eq!(c4, 200);
        let parsed: Value = serde_json::from_str(&status_body).unwrap();
        assert_eq!(parsed["scope"], "native-host");
        assert_eq!(parsed["indicatorCount"], 1);
        assert_eq!(parsed["active"], true);
    }
}
