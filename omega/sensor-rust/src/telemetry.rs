use chrono::Utc;
use serde::Serialize;
use sysinfo::{ProcessesToUpdate, System};

use crate::infostealer::{evaluate_cmdline_for_infostealer, InfostealerFinding};

#[derive(Debug, Clone, Serialize)]
pub struct ProcessTelemetry {
    pub pid: u32,
    pub name: String,
    pub exe_path: String,
    pub memory_kb: u64,
    pub suspicious_location: bool,
    pub command_line: String,
    pub signature_status: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostTelemetrySnapshot {
    pub platform: &'static str,
    pub host: serde_json::Value,
    pub processes: Vec<ProcessTelemetry>,
    pub tcp_connections: Vec<serde_json::Value>,
    pub wmi_subscriptions: Vec<serde_json::Value>,
    pub scheduled_tasks: Vec<serde_json::Value>,
    pub startup_items: Vec<serde_json::Value>,
    pub collection_status: serde_json::Value,
    pub collection_errors: Vec<serde_json::Value>,
    pub sensor: &'static str,
    pub sensor_version: &'static str,
    pub captured_at: String,
    pub hostname: String,
    pub os_name: String,
    pub os_version: String,
    pub kernel_version: String,
    pub total_memory_mb: u64,
    pub used_memory_mb: u64,
    pub process_count: usize,
    pub suspicious_processes: Vec<ProcessTelemetry>,
    pub infostealer_alerts: Vec<InfostealerFinding>,
}

fn is_volatile_exec_path(exe_path: &str) -> bool {
    let low = exe_path.replace('\\', "/").to_ascii_lowercase();
    low.contains("/appdata/local/temp/")
        || low.contains("/windows/temp/")
        || low.starts_with("/tmp/")
        || low.starts_with("/private/var/tmp/")
        || low.contains("/downloads/")
}

pub fn collect_snapshot() -> HostTelemetrySnapshot {
    let mut sys = System::new_all();
    sys.refresh_memory();
    sys.refresh_processes(ProcessesToUpdate::All);

    let mut suspicious_processes = Vec::new();
    let mut processes = Vec::new();
    let mut infostealer_alerts = Vec::new();
    let mut process_count = 0usize;

    for (pid, process) in sys.processes() {
        process_count += 1;
        let pid_u32 = pid.as_u32();
        let name = process.name().to_string_lossy().into_owned();
        let exe_path = process
            .exe()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let cmdline: Vec<String> = process
            .cmd()
            .iter()
            .map(|c| c.to_string_lossy().into_owned())
            .collect();

        let suspicious_location = !exe_path.is_empty() && is_volatile_exec_path(&exe_path);
        processes.push(ProcessTelemetry {
            pid: pid_u32,
            name: name.clone(),
            exe_path: exe_path.clone(),
            memory_kb: process.memory() / 1024,
            suspicious_location,
            command_line: cmdline.join(" "),
            signature_status: "Unknown",
        });
        if suspicious_location {
            suspicious_processes.push(ProcessTelemetry {
                pid: pid_u32,
                name: name.clone(),
                exe_path: exe_path.clone(),
                memory_kb: process.memory() / 1024,
                suspicious_location: true,
                command_line: cmdline.join(" "),
                signature_status: "Unknown",
            });
        }

        // En fase 9 base, los procesos desde rutas volátiles o sin ruta verificada se evalúan como no firmados
        let assumed_signed = !suspicious_location && !exe_path.is_empty();
        let alerts =
            evaluate_cmdline_for_infostealer(pid_u32, &name, &exe_path, &cmdline, assumed_signed);
        infostealer_alerts.extend(alerts);
    }

    let audit = crate::windows_audit::collect();
    let mut host = audit
        .get("host")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    host["hostname"] = serde_json::json!(System::host_name().unwrap_or_default());
    host["os_version"] = serde_json::json!(System::os_version().unwrap_or_default());
    let mut collection_status = audit
        .get("collection_status")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    collection_status["processes"] = serde_json::json!(if processes.is_empty() {
        "unavailable"
    } else {
        "available"
    });
    let items = |key| {
        audit
            .get(key)
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default()
    };
    HostTelemetrySnapshot {
        platform: match std::env::consts::OS {
            "windows" => "win32",
            "macos" => "darwin",
            other => other,
        },
        host,
        processes,
        tcp_connections: items("tcp_connections"),
        wmi_subscriptions: items("wmi_subscriptions"),
        scheduled_tasks: items("scheduled_tasks"),
        startup_items: items("startup_items"),
        collection_status,
        collection_errors: items("collection_errors"),
        sensor: "omega-sensor-rust",
        sensor_version: env!("CARGO_PKG_VERSION"),
        captured_at: Utc::now().to_rfc3339(),
        hostname: System::host_name().unwrap_or_else(|| "omega-host".to_string()),
        os_name: System::name().unwrap_or_else(|| std::env::consts::OS.to_string()),
        os_version: System::os_version().unwrap_or_default(),
        kernel_version: System::kernel_version().unwrap_or_default(),
        total_memory_mb: sys.total_memory() / (1024 * 1024),
        used_memory_mb: sys.used_memory() / (1024 * 1024),
        process_count,
        suspicious_processes,
        infostealer_alerts,
    }
}
