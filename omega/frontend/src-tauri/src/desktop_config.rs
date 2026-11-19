use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const CONFIG_FILENAME: &str = "desktop-config.json";
const MAX_FIELD_LEN: usize = 2048;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct StoredDesktopConfig {
    pub groq_api_key: String,
    pub groq_model: String,
    pub open_ai_api_key: String,
    pub open_ai_chat_model: String,
    pub omni_route_enabled: bool,
    pub omni_route_api_key: String,
    pub omni_route_model: String,
    pub custom_provider: String,
    pub custom_base_url: String,
    pub custom_api_key: String,
    pub custom_model: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_username: String,
    pub smtp_password: String,
    pub smtp_from: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SaveDesktopConfigPayload {
    pub groq_api_key: Option<String>,
    pub groq_model: Option<String>,
    pub clear_groq_key: Option<bool>,
    pub open_ai_api_key: Option<String>,
    pub open_ai_chat_model: Option<String>,
    pub clear_open_ai_key: Option<bool>,
    pub custom_provider: Option<String>,
    pub custom_base_url: Option<String>,
    pub custom_api_key: Option<String>,
    pub custom_model: Option<String>,
    pub clear_custom_provider: Option<bool>,
    pub clear_custom_key: Option<bool>,
    pub omni_route_enabled: Option<bool>,
    pub omni_route_api_key: Option<String>,
    pub omni_route_model: Option<String>,
    pub clear_omni_route_key: Option<bool>,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<u16>,
    pub smtp_username: Option<String>,
    pub smtp_password: Option<String>,
    pub smtp_from: Option<String>,
    pub clear_smtp_config: Option<bool>,
}

/// Resumen seguro devuelto a React: jamás incluye API keys ni contraseñas SMTP en claro.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConfigSummary {
    pub configured: bool,
    pub active_provider: String,
    pub active_model: String,
    pub sovereign_local: bool,
    pub groq_configured: bool,
    pub groq_model: String,
    pub open_ai_configured: bool,
    pub open_ai_chat_model: String,
    pub custom_configured: bool,
    pub custom_provider: String,
    pub custom_base_url: String,
    pub custom_model: String,
    pub omni_route_enabled: bool,
    pub omni_route_configured: bool,
    pub omni_route_model: String,
    pub smtp_configured: bool,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_username: String,
    pub smtp_from: String,
}

fn sanitize_line(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.len() > MAX_FIELD_LEN {
        return Err("Un campo excede el tamaño máximo permitido (2048 caracteres).".to_string());
    }
    if trimmed.chars().any(|c| c == '\0' || c == '\r' || c == '\n') {
        return Err("Caracteres de control no permitidos en configuración local.".to_string());
    }
    Ok(trimmed.to_string())
}

fn sanitize_http_url(raw: &str) -> Result<String, String> {
    let clean = sanitize_line(raw)?;
    if clean.is_empty() {
        return Ok(clean);
    }
    let lower = clean.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("La URL del motor de IA debe comenzar por http:// o https://.".to_string());
    }
    Ok(clean)
}

fn config_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(CONFIG_FILENAME)
}

pub fn load_desktop_config(app_data_dir: &Path) -> StoredDesktopConfig {
    let path = config_path(app_data_dir);
    let Ok(raw) = std::fs::read_to_string(path) else {
        return StoredDesktopConfig {
            smtp_port: 587,
            ..Default::default()
        };
    };
    let mut parsed = serde_json::from_str::<StoredDesktopConfig>(&raw).unwrap_or_default();
    if parsed.smtp_port == 0 {
        parsed.smtp_port = 587;
    }
    parsed
}

pub fn apply_payload_and_save(
    app_data_dir: &Path,
    payload: &SaveDesktopConfigPayload,
) -> Result<StoredDesktopConfig, String> {
    let mut cfg = load_desktop_config(app_data_dir);

    if payload.clear_groq_key == Some(true) {
        cfg.groq_api_key.clear();
    } else if let Some(ref key) = payload.groq_api_key {
        let clean = sanitize_line(key)?;
        if !clean.is_empty() {
            cfg.groq_api_key = clean;
        }
    }
    if let Some(ref model) = payload.groq_model {
        cfg.groq_model = sanitize_line(model)?;
    }

    if payload.clear_open_ai_key == Some(true) {
        cfg.open_ai_api_key.clear();
    } else if let Some(ref key) = payload.open_ai_api_key {
        let clean = sanitize_line(key)?;
        if !clean.is_empty() {
            cfg.open_ai_api_key = clean;
        }
    }
    if let Some(ref model) = payload.open_ai_chat_model {
        cfg.open_ai_chat_model = sanitize_line(model)?;
    }

    if let Some(enabled) = payload.omni_route_enabled {
        cfg.omni_route_enabled = enabled;
    }
    if payload.clear_omni_route_key == Some(true) {
        cfg.omni_route_api_key.clear();
    } else if let Some(ref key) = payload.omni_route_api_key {
        let clean = sanitize_line(key)?;
        if !clean.is_empty() {
            cfg.omni_route_api_key = clean;
        }
    }
    if let Some(ref model) = payload.omni_route_model {
        cfg.omni_route_model = sanitize_line(model)?;
    }

    if payload.clear_custom_provider == Some(true) {
        cfg.custom_provider.clear();
        cfg.custom_base_url.clear();
        cfg.custom_model.clear();
        cfg.custom_api_key.clear();
    } else {
        if let Some(ref prov) = payload.custom_provider {
            cfg.custom_provider = sanitize_line(prov)?.to_ascii_lowercase();
        }
        if let Some(ref url) = payload.custom_base_url {
            cfg.custom_base_url = sanitize_http_url(url)?;
        }
        if let Some(ref model) = payload.custom_model {
            cfg.custom_model = sanitize_line(model)?;
        }
        if payload.clear_custom_key == Some(true) {
            cfg.custom_api_key.clear();
        } else if let Some(ref key) = payload.custom_api_key {
            let clean = sanitize_line(key)?;
            if !clean.is_empty() {
                cfg.custom_api_key = clean;
            }
        }
    }

    if payload.clear_smtp_config == Some(true) {
        cfg.smtp_host.clear();
        cfg.smtp_port = 587;
        cfg.smtp_username.clear();
        cfg.smtp_password.clear();
        cfg.smtp_from.clear();
    } else {
        if let Some(ref host) = payload.smtp_host {
            cfg.smtp_host = sanitize_line(host)?;
        }
        if let Some(port) = payload.smtp_port {
            if port == 0 {
                return Err("El puerto SMTP debe estar entre 1 y 65535.".to_string());
            }
            cfg.smtp_port = port;
        }
        if let Some(ref user) = payload.smtp_username {
            cfg.smtp_username = sanitize_line(user)?;
        }
        if let Some(ref pwd) = payload.smtp_password {
            let clean = sanitize_line(pwd)?;
            if !clean.is_empty() {
                cfg.smtp_password = clean;
            }
        }
        if let Some(ref from) = payload.smtp_from {
            cfg.smtp_from = sanitize_line(from)?;
        }
    }

    // El modo soberano Ollama prohíbe SMTP externo en SovereignModePolicy.java.
    if cfg.custom_provider == "ollama" && !cfg.smtp_host.is_empty() {
        let h = cfg.smtp_host.to_ascii_lowercase();
        if !matches!(h.as_str(), "localhost" | "127.0.0.1" | "::1" | "mailpit") {
            return Err(
                "El Modo Soberano Local (Ollama) no permite SMTP externo; limpia SMTP o usa localhost."
                    .to_string(),
            );
        }
    }

    std::fs::create_dir_all(app_data_dir)
        .map_err(|e| format!("No se pudo crear {}: {e}", app_data_dir.display()))?;
    let path = config_path(app_data_dir);
    let body = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| format!("No se pudo guardar configuración: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(cfg)
}

fn ollama_base_for_docker(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    let without_v1 = trimmed.strip_suffix("/v1").unwrap_or(trimmed);
    if without_v1.is_empty()
        || without_v1.contains("://localhost")
        || without_v1.contains("://127.0.0.1")
    {
        return "http://host.docker.internal:11434".to_string();
    }
    without_v1.to_string()
}

pub fn build_summary(cfg: &StoredDesktopConfig) -> DesktopConfigSummary {
    let sovereign_local = cfg.custom_provider == "ollama";
    let groq_ok = !cfg.groq_api_key.is_empty();
    let openai_ok = !cfg.open_ai_api_key.is_empty();
    let custom_ok = !cfg.custom_provider.is_empty()
        && (!cfg.custom_base_url.is_empty() || cfg.custom_provider == "ollama");
    let omni_ok = cfg.omni_route_enabled;

    let (active_provider, active_model, configured) = if custom_ok {
        let model = if cfg.custom_model.is_empty() {
            if sovereign_local {
                "qwen2.5:14b".to_string()
            } else {
                "auto".to_string()
            }
        } else {
            cfg.custom_model.clone()
        };
        (cfg.custom_provider.clone(), model, true)
    } else if omni_ok {
        let model = if cfg.omni_route_model.is_empty() {
            "auto".to_string()
        } else {
            cfg.omni_route_model.clone()
        };
        ("omniroute".to_string(), model, true)
    } else if groq_ok {
        let model = if cfg.groq_model.is_empty() {
            "openai/gpt-oss-120b".to_string()
        } else {
            cfg.groq_model.clone()
        };
        ("groq".to_string(), model, true)
    } else if openai_ok {
        let model = if cfg.open_ai_chat_model.is_empty() {
            "gpt-4o-mini".to_string()
        } else {
            cfg.open_ai_chat_model.clone()
        };
        ("openai".to_string(), model, true)
    } else {
        ("extractive".to_string(), "sin-llm".to_string(), false)
    };

    DesktopConfigSummary {
        configured,
        active_provider,
        active_model,
        sovereign_local,
        groq_configured: groq_ok,
        groq_model: cfg.groq_model.clone(),
        open_ai_configured: openai_ok,
        open_ai_chat_model: cfg.open_ai_chat_model.clone(),
        custom_configured: custom_ok,
        custom_provider: cfg.custom_provider.clone(),
        custom_base_url: cfg.custom_base_url.clone(),
        custom_model: cfg.custom_model.clone(),
        omni_route_enabled: cfg.omni_route_enabled,
        omni_route_configured: !cfg.omni_route_api_key.is_empty(),
        omni_route_model: cfg.omni_route_model.clone(),
        smtp_configured: !cfg.smtp_host.is_empty(),
        smtp_host: cfg.smtp_host.clone(),
        smtp_port: if cfg.smtp_port == 0 { 587 } else { cfg.smtp_port },
        smtp_username: cfg.smtp_username.clone(),
        smtp_from: cfg.smtp_from.clone(),
    }
}

pub fn build_docker_envs(cfg: &StoredDesktopConfig) -> Vec<(&'static str, String)> {
    let mut envs = Vec::new();
    if !cfg.groq_api_key.is_empty() {
        envs.push(("GROQ_API_KEY", cfg.groq_api_key.clone()));
    }
    if !cfg.groq_model.is_empty() {
        envs.push(("GROQ_MODEL", cfg.groq_model.clone()));
    }
    if !cfg.open_ai_api_key.is_empty() {
        envs.push(("OPENAI_API_KEY", cfg.open_ai_api_key.clone()));
    }
    if cfg.custom_provider == "ollama" {
        envs.push(("OMEGA_AI_PROVIDER", "ollama".to_string()));
        envs.push(("OMEGA_OLLAMA_BASE_URL", ollama_base_for_docker(&cfg.custom_base_url)));
        if !cfg.custom_model.is_empty() {
            envs.push(("OMEGA_OLLAMA_CHAT_MODEL", cfg.custom_model.clone()));
        }
    } else if !cfg.custom_provider.is_empty() {
        envs.push(("OMEGA_AI_PROVIDER", "openai".to_string()));
        envs.push(("CUSTOM_LLM_PROVIDER", cfg.custom_provider.clone()));
        if !cfg.custom_base_url.is_empty() {
            envs.push(("CUSTOM_LLM_BASE_URL", cfg.custom_base_url.clone()));
        }
        if !cfg.custom_api_key.is_empty() {
            envs.push(("CUSTOM_LLM_API_KEY", cfg.custom_api_key.clone()));
        }
        if !cfg.custom_model.is_empty() {
            envs.push(("CUSTOM_LLM_MODEL", cfg.custom_model.clone()));
        }
    }
    if cfg.omni_route_enabled {
        envs.push(("OMNIROUTE_BASE_URL", "http://host.docker.internal:20128/v1".to_string()));
        if !cfg.omni_route_api_key.is_empty() {
            envs.push(("OMNIROUTE_API_KEY", cfg.omni_route_api_key.clone()));
        }
        if !cfg.omni_route_model.is_empty() {
            envs.push(("OMNIROUTE_MODEL", cfg.omni_route_model.clone()));
        }
    }
    if !cfg.smtp_host.is_empty() {
        envs.push(("OMEGA_SMTP_HOST", cfg.smtp_host.clone()));
        envs.push(("OMEGA_SMTP_PORT", cfg.smtp_port.to_string()));
        if !cfg.smtp_username.is_empty() {
            envs.push(("OMEGA_SMTP_USERNAME", cfg.smtp_username.clone()));
        }
        if !cfg.smtp_password.is_empty() {
            envs.push(("OMEGA_SMTP_PASSWORD", cfg.smtp_password.clone()));
        }
        if !cfg.smtp_from.is_empty() {
            envs.push(("OMEGA_SMTP_FROM", cfg.smtp_from.clone()));
        }
    }
    envs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_config_without_leaking_secrets_in_summary() {
        let dir = std::env::temp_dir().join("omega-desktop-cfg-test");
        let _ = std::fs::remove_dir_all(&dir);
        let payload = SaveDesktopConfigPayload {
            groq_api_key: Some("gsk_test_secret_value".to_string()),
            groq_model: Some("openai/gpt-oss-120b".to_string()),
            smtp_host: Some("smtp.gmail.com".to_string()),
            smtp_port: Some(587),
            smtp_username: Some("ops@example.com".to_string()),
            smtp_password: Some("app_password_secret".to_string()),
            ..Default::default()
        };
        let saved = apply_payload_and_save(&dir, &payload).unwrap();
        let summary = build_summary(&saved);
        assert!(summary.configured);
        assert!(summary.groq_configured);
        assert!(summary.smtp_configured);
        assert_eq!(summary.active_provider, "groq");
        let serialized = serde_json::to_string(&summary).unwrap();
        assert!(!serialized.contains("gsk_test_secret_value"));
        assert!(!serialized.contains("app_password_secret"));

        let envs = build_docker_envs(&saved);
        assert!(envs.iter().any(|(k, v)| *k == "GROQ_API_KEY" && v == "gsk_test_secret_value"));
        assert!(envs.iter().any(|(k, v)| *k == "OMEGA_SMTP_HOST" && v == "smtp.gmail.com"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ollama_sovereign_rewrites_localhost_for_docker_and_blocks_external_smtp() {
        let dir = std::env::temp_dir().join("omega-desktop-cfg-ollama");
        let _ = std::fs::remove_dir_all(&dir);
        let bad = SaveDesktopConfigPayload {
            custom_provider: Some("ollama".to_string()),
            custom_base_url: Some("http://localhost:11434/v1".to_string()),
            smtp_host: Some("smtp.gmail.com".to_string()),
            ..Default::default()
        };
        assert!(apply_payload_and_save(&dir, &bad).is_err());

        let good = SaveDesktopConfigPayload {
            custom_provider: Some("ollama".to_string()),
            custom_base_url: Some("http://localhost:11434/v1".to_string()),
            custom_model: Some("qwen2.5:14b".to_string()),
            clear_smtp_config: Some(true),
            ..Default::default()
        };
        let saved = apply_payload_and_save(&dir, &good).unwrap();
        let summary = build_summary(&saved);
        assert!(summary.sovereign_local);
        assert_eq!(summary.active_provider, "ollama");

        let envs = build_docker_envs(&saved);
        assert!(envs.iter().any(|(k, v)| *k == "OMEGA_AI_PROVIDER" && v == "ollama"));
        assert!(envs
            .iter()
            .any(|(k, v)| *k == "OMEGA_OLLAMA_BASE_URL" && v == "http://host.docker.internal:11434"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_newline_injection_in_fields() {
        let dir = std::env::temp_dir().join("omega-desktop-cfg-inj");
        let _ = std::fs::remove_dir_all(&dir);
        let evil = SaveDesktopConfigPayload {
            groq_api_key: Some("gsk_abc\nOMEGA_JWT_SECRET=hack".to_string()),
            ..Default::default()
        };
        assert!(apply_payload_and_save(&dir, &evil).is_err());
    }
}
