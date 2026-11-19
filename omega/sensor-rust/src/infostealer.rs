use serde::Serialize;

const BROWSER_PROCESS_NAMES: &[&str] = &[
    "chrome.exe", "chrome", "google chrome",
    "msedge.exe", "msedge", "microsoft edge",
    "brave.exe", "brave", "brave browser",
    "firefox.exe", "firefox",
    "opera.exe", "opera", "vivaldi.exe", "vivaldi", "safari",
];

const SSH_ALLOWED_NAMES: &[&str] = &[
    "ssh.exe", "ssh", "ssh-agent.exe", "ssh-agent", "sshd.exe", "sshd",
    "git.exe", "git", "scp.exe", "scp", "sftp.exe", "sftp", "pageant.exe",
];

const BROWSER_PROFILE_MARKERS: &[&str] = &[
    "chrome", "edge", "brave", "opera", "vivaldi", "mozilla",
    "firefox", "safari", "chromium", "waterfox", "librewolf", "user data",
];

const BROWSER_STORE_PATTERNS: &[&str] = &[
    "/login data",
    "/web data",
    "/local state",
    "/network/cookies",
    "/cookies",
    "/logins.json",
    "/key4.db",
    "/cookies.sqlite",
];

const SSH_KEY_PATTERNS: &[&str] = &[
    "/.ssh/id_rsa",
    "/.ssh/id_ed25519",
    "/.ssh/id_ecdsa",
    "/.ssh/id_dsa",
    "/.ssh/identity",
];

const SECRET_FILE_PATTERNS: &[&str] = &[
    "/.aws/credentials",
    "/.kube/config",
    "/.npmrc",
    "/.pypirc",
    "/.env",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TargetClassification {
    pub target_kind: &'static str,
    pub severity: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct InfostealerFinding {
    pub category: &'static str,
    pub severity: &'static str,
    pub target_kind: &'static str,
    pub pid: u32,
    pub process_name: String,
    pub exe_path: String,
    pub sensitive_path: String,
    pub detail: String,
}

fn normalize_path(raw: &str) -> String {
    raw.replace('\\', "/").trim().to_ascii_lowercase()
}

pub fn classify_sensitive_target(raw_path: &str) -> Option<TargetClassification> {
    let norm = normalize_path(raw_path);
    if norm.is_empty() {
        return None;
    }

    for pat in BROWSER_STORE_PATTERNS {
        if norm.contains(pat) {
            if BROWSER_PROFILE_MARKERS.iter().any(|m| norm.contains(m)) {
                return Some(TargetClassification {
                    target_kind: "BROWSER_CREDENTIAL_STORE",
                    severity: "CRITICAL",
                });
            }
        }
    }

    for pat in SSH_KEY_PATTERNS {
        if norm.contains(pat) {
            return Some(TargetClassification {
                target_kind: "SSH_PRIVATE_KEY",
                severity: "CRITICAL",
            });
        }
    }

    for pat in SECRET_FILE_PATTERNS {
        if *pat == "/.env" {
            let is_env = norm.ends_with("/.env") || norm == ".env" || norm.contains("/.env.");
            let is_template = norm.ends_with(".env.example")
                || norm.ends_with(".env.sample")
                || norm.ends_with(".env.template");
            if is_env && !is_template {
                return Some(TargetClassification {
                    target_kind: "SECRET_ENV_OR_CLOUD_CREDENTIAL",
                    severity: "HIGH",
                });
            }
        } else if norm.contains(pat) {
            return Some(TargetClassification {
                target_kind: "SECRET_ENV_OR_CLOUD_CREDENTIAL",
                severity: "HIGH",
            });
        }
    }

    None
}

pub fn evaluate_cmdline_for_infostealer(
    pid: u32,
    process_name: &str,
    exe_path: &str,
    cmdline: &[String],
    is_signed_valid: bool,
) -> Vec<InfostealerFinding> {
    let low_name = process_name.trim().to_ascii_lowercase();
    let mut findings = Vec::new();

    for arg in cmdline.iter().skip(1) {
        let cleaned = arg.trim().trim_matches('"').trim_matches('\'');
        let Some(class) = classify_sensitive_target(cleaned) else {
            continue;
        };

        let allowed_browser = class.target_kind == "BROWSER_CREDENTIAL_STORE"
            && is_signed_valid
            && BROWSER_PROCESS_NAMES.contains(&low_name.as_str());
        let allowed_ssh = class.target_kind == "SSH_PRIVATE_KEY"
            && is_signed_valid
            && SSH_ALLOWED_NAMES.contains(&low_name.as_str());
        let allowed_secret =
            class.target_kind == "SECRET_ENV_OR_CLOUD_CREDENTIAL" && is_signed_valid;

        if allowed_browser || allowed_ssh || allowed_secret {
            continue;
        }

        findings.push(InfostealerFinding {
            category: "INFOSTEALER_CREDENTIAL_ACCESS",
            severity: class.severity,
            target_kind: class.target_kind,
            pid,
            process_name: process_name.to_string(),
            exe_path: exe_path.to_string(),
            sensitive_path: cleaned.to_string(),
            detail: format!(
                "El proceso '{}' (PID {}) referencia una ruta sensible ({}).",
                process_name, pid, class.target_kind
            ),
        });
    }

    findings
}
