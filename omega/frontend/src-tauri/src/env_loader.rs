use crate::desktop_config::{build_docker_envs, StoredDesktopConfig};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn is_valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn unquote_double(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(c) = chars.next() {
        if c == '"' {
            break;
        }
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push(' '),
                Some('r') => {}
                Some('t') => out.push('\t'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => break,
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn strip_unquoted_inline_comment(raw: &str) -> &str {
    let bytes = raw.as_bytes();
    for (idx, &b) in bytes.iter().enumerate() {
        if b == b'#' && idx > 0 && bytes[idx - 1].is_ascii_whitespace() {
            return &raw[..idx];
        }
    }
    raw
}

fn sanitize_env_value(raw: &str) -> String {
    raw.chars()
        .filter(|&c| c != '\r' && c != '\n')
        .collect::<String>()
        .trim()
        .to_string()
}

pub fn parse_dotenv_str(raw: &str) -> BTreeMap<String, String> {
    let mut vars = BTreeMap::new();
    let stripped = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    for line in stripped.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let without_export = trimmed
            .strip_prefix("export ")
            .map(str::trim_start)
            .unwrap_or(trimmed);
        let Some((raw_key, raw_val)) = without_export.split_once('=') else {
            continue;
        };
        let key = raw_key.trim();
        if !is_valid_env_key(key) {
            continue;
        }
        let val_trimmed = raw_val.trim_start();
        let parsed = if let Some(rest) = val_trimmed.strip_prefix('"') {
            unquote_double(rest)
        } else if let Some(rest) = val_trimmed.strip_prefix('\'') {
            rest.split('\'').next().unwrap_or("").to_string()
        } else {
            strip_unquoted_inline_comment(val_trimmed)
                .trim()
                .to_string()
        };
        let clean = sanitize_env_value(&parsed);
        if clean.is_empty() {
            vars.remove(key);
        } else {
            vars.insert(key.to_string(), clean);
        }
    }
    vars
}

pub fn load_dotenv_file(path: &Path) -> BTreeMap<String, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => parse_dotenv_str(&content),
        Err(_) => BTreeMap::new(),
    }
}

pub fn save_dotenv_file(path: &Path, values: &BTreeMap<String, String>) -> Result<(), String> {
    let mut text = String::new();
    for (key, value) in values {
        if !is_valid_env_key(key) {
            continue;
        }
        let escaped = sanitize_env_value(value)
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        text.push_str(&format!("{key}=\"{escaped}\"\n"));
    }
    let temporary = path.with_extension("env.tmp");
    std::fs::write(&temporary, text)
        .map_err(|e| format!("No se pudo guardar configuración local: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    std::fs::rename(&temporary, path)
        .map_err(|e| format!("No se pudo aplicar configuración local: {e}"))
}

fn push_env_candidates_from_ancestors(start: &Path, out: &mut Vec<PathBuf>) {
    let mut cur = Some(start);
    for _ in 0..=6 {
        let Some(dir) = cur else {
            break;
        };
        let normalized = dir.to_string_lossy();
        if !normalized.contains("bundle-resources") {
            out.push(dir.join(".env"));
            out.push(dir.join("omega").join(".env"));
        }
        cur = dir.parent();
    }
}

pub fn discover_env_file_with_hints(
    compose_file: Option<&Path>,
    app_data_dir: &Path,
    docker_working_dir: Option<&Path>,
    current_dir: Option<&Path>,
    exe_dir: Option<&Path>,
    home_dir: Option<&Path>,
    explicit_override: Option<&Path>,
    saved_env_file: Option<&Path>,
) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(p) = explicit_override {
        candidates.push(p.to_path_buf());
    }
    if let Some(p) = saved_env_file {
        candidates.push(p.to_path_buf());
    }
    if let Some(compose) = compose_file {
        if let Some(parent) = compose.parent() {
            candidates.push(parent.join(".env"));
        }
    }
    candidates.push(app_data_dir.join(".env"));
    candidates.push(app_data_dir.join("omega").join(".env"));
    if let Some(cwd) = current_dir {
        push_env_candidates_from_ancestors(cwd, &mut candidates);
    }
    if let Some(exe) = exe_dir {
        push_env_candidates_from_ancestors(exe, &mut candidates);
    }
    if let Some(work_dir) = docker_working_dir {
        candidates.push(work_dir.join(".env"));
        candidates.push(work_dir.join("omega").join(".env"));
    }
    if let Some(home) = home_dir {
        candidates.push(home.join(".omega").join(".env"));
        candidates.push(home.join("OMEGA").join(".env"));
        candidates.push(home.join("OMEGA").join("omega").join(".env"));
    }
    candidates.into_iter().find(|path| path.is_file())
}

pub fn find_env_file(
    compose_file: Option<&Path>,
    app_data_dir: &Path,
    docker_working_dir: Option<&Path>,
    saved_env_file: Option<&Path>,
) -> Option<PathBuf> {
    let explicit = std::env::var_os("OMEGA_ENV_FILE")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from);
    let cwd = std::env::current_dir().ok();
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf));
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);
    discover_env_file_with_hints(
        compose_file,
        app_data_dir,
        docker_working_dir,
        if cfg!(debug_assertions) {
            cwd.as_deref()
        } else {
            None
        },
        if cfg!(debug_assertions) {
            exe_dir.as_deref()
        } else {
            None
        },
        if cfg!(debug_assertions) {
            home.as_deref()
        } else {
            None
        },
        explicit.as_deref(),
        saved_env_file,
    )
}

pub fn merge_bootstrap_envs(
    env_file: Option<&Path>,
    default_internal_token: &str,
    default_jwt_secret: &str,
    app_version: &str,
    user_cfg: &StoredDesktopConfig,
) -> Vec<(String, String)> {
    let mut merged = env_file.map(load_dotenv_file).unwrap_or_default();

    let has_valid_internal = merged
        .get("INTERNAL_SERVICE_TOKEN")
        .map(|s| s.len() >= 16)
        .unwrap_or(false);
    if !has_valid_internal {
        merged.insert(
            "INTERNAL_SERVICE_TOKEN".to_string(),
            default_internal_token.to_string(),
        );
    }
    if !merged.contains_key("OMEGA_HOST_INTERNAL_SERVICE_TOKEN") {
        if let Some(tok) = merged.get("INTERNAL_SERVICE_TOKEN").cloned() {
            merged.insert("OMEGA_HOST_INTERNAL_SERVICE_TOKEN".to_string(), tok);
        }
    }

    let has_valid_jwt = merged
        .get("OMEGA_JWT_SECRET")
        .map(|s| s.len() >= 32)
        .unwrap_or(false);
    if !has_valid_jwt {
        merged.insert(
            "OMEGA_JWT_SECRET".to_string(),
            default_jwt_secret.to_string(),
        );
    }

    merged.insert("OMEGA_DESKTOP_VERSION".to_string(), app_version.to_string());
    merged.insert(
        "OMEGA_DESKTOP_RELEASE_ID".to_string(),
        format!("v{app_version}"),
    );

    for (key, value) in build_docker_envs(user_cfg) {
        merged.insert(key.to_string(), value);
    }

    merged.into_iter().collect()
}

pub fn compute_env_fingerprint(envs: &[(String, String)]) -> String {
    let mut h1: u64 = 0xcbf29ce484222325;
    let mut h2: u64 = 0x84222325cbf29ce4;
    for (k, v) in envs {
        for &byte in k
            .as_bytes()
            .iter()
            .chain(b"=")
            .chain(v.as_bytes())
            .chain(b"\0")
        {
            h1 ^= u64::from(byte);
            h1 = h1.wrapping_mul(0x100000001b3);
            h2 = h2.wrapping_mul(0x100000001b3);
            h2 ^= u64::from(byte);
        }
    }
    format!("{h1:016x}{h2:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persisted_installation_preserves_password_special_characters() {
        let path = std::env::temp_dir().join(format!("omega-env-{}.env", std::process::id()));
        let values = BTreeMap::from([
            (
                "POSTGRES_PASSWORD".into(),
                "quotes\"slashes\\hash#and$dollar".into(),
            ),
            ("OMEGA_SMTP_HOST".into(), "".into()),
        ]);
        save_dotenv_file(&path, &values).unwrap();
        let loaded = load_dotenv_file(&path);
        assert_eq!(
            loaded.get("POSTGRES_PASSWORD"),
            values.get("POSTGRES_PASSWORD")
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn parses_dotenv_with_quotes_exports_comments_and_ignores_empty() {
        let raw = "\u{feff}# comentario inicial\n\
            GROQ_API_KEY=gsk_test_123 # inline comment\n\
            export GROQ_MODEL=\"openai/gpt-oss-120b\"\n\
            OMEGA_SMTP_PASSWORD='p@ss#word'\n\
            OMNIROUTE_BASE_URL=\n\
            INVALID-KEY=ignored\n";
        let parsed = parse_dotenv_str(raw);
        assert_eq!(
            parsed.get("GROQ_API_KEY").map(String::as_str),
            Some("gsk_test_123")
        );
        assert_eq!(
            parsed.get("GROQ_MODEL").map(String::as_str),
            Some("openai/gpt-oss-120b")
        );
        assert_eq!(
            parsed.get("OMEGA_SMTP_PASSWORD").map(String::as_str),
            Some("p@ss#word")
        );
        assert!(!parsed.contains_key("OMNIROUTE_BASE_URL"));
        assert!(!parsed.contains_key("INVALID-KEY"));
    }

    #[test]
    fn merge_respects_dotenv_and_applies_ui_overrides_and_fingerprint_changes() {
        let dir = std::env::temp_dir().join("omega-env-merge-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let env_path = dir.join(".env");
        std::fs::write(
            &env_path,
            "GROQ_API_KEY=gsk_from_env\nOMEGA_SMTP_HOST=smtp.gmail.com\n",
        )
        .unwrap();

        let empty_cfg = StoredDesktopConfig::default();
        let merged_base = merge_bootstrap_envs(
            Some(&env_path),
            "internal_tok_123456",
            "jwt_secret_012345678901234567890123456789",
            "2.0.5",
            &empty_cfg,
        );
        assert!(merged_base
            .iter()
            .any(|(k, v)| k == "GROQ_API_KEY" && v == "gsk_from_env"));
        assert!(merged_base
            .iter()
            .any(|(k, v)| k == "OMEGA_SMTP_HOST" && v == "smtp.gmail.com"));
        assert!(!merged_base
            .iter()
            .any(|(k, _)| k == "OMEGA_LOCAL_ACCESS_ENABLED"));

        let mut custom_cfg = StoredDesktopConfig::default();
        custom_cfg.groq_api_key = "gsk_from_ui".to_string();
        let merged_override = merge_bootstrap_envs(
            Some(&env_path),
            "internal_tok_123456",
            "jwt_secret_012345678901234567890123456789",
            "2.0.5",
            &custom_cfg,
        );
        assert!(merged_override
            .iter()
            .any(|(k, v)| k == "GROQ_API_KEY" && v == "gsk_from_ui"));
        assert_ne!(
            compute_env_fingerprint(&merged_base),
            compute_env_fingerprint(&merged_override)
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn discovers_env_from_docker_workdir_or_ancestor_omega_dir() {
        let root = std::env::temp_dir().join("omega-env-discover-test");
        let _ = std::fs::remove_dir_all(&root);
        let omega_dir = root.join("omega");
        let app_data = root.join("appdata");
        std::fs::create_dir_all(&omega_dir).unwrap();
        std::fs::create_dir_all(&app_data).unwrap();
        let env_path = omega_dir.join(".env");
        std::fs::write(&env_path, "GROQ_API_KEY=gsk_ok\n").unwrap();

        let found = discover_env_file_with_hints(
            None,
            &app_data,
            Some(&omega_dir),
            None,
            None,
            None,
            None,
            None,
        );
        assert_eq!(found, Some(env_path.clone()));

        let persisted = discover_env_file_with_hints(
            None,
            &app_data,
            None,
            None,
            None,
            None,
            None,
            Some(&env_path),
        );
        assert_eq!(persisted, Some(env_path));
        let _ = std::fs::remove_dir_all(&root);
    }
}
