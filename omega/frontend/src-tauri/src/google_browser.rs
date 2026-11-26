use tauri_plugin_shell::ShellExt;

fn google_authorization_url(raw: &str) -> Result<String, String> {
    let url = tauri::Url::parse(raw).map_err(|_| "Enlace de Google inválido".to_string())?;
    if raw.len() > 4096
        || url.scheme() != "https"
        || url.host_str() != Some("accounts.google.com")
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/o/oauth2/v2/auth"
        || url.fragment().is_some()
    {
        return Err("Enlace de autorización de Google inválido".into());
    }
    Ok(url.to_string())
}

#[tauri::command]
pub fn open_google_authorization(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let url = google_authorization_url(&url)?;
    #[allow(deprecated)]
    app.shell().open(url, None).map_err(|_| "No se pudo abrir Google en el navegador".into())
}

#[cfg(test)]
mod tests {
    use super::google_authorization_url;

    #[test]
    fn only_opens_the_google_oauth_endpoint() {
        assert!(google_authorization_url("https://accounts.google.com/o/oauth2/v2/auth?state=test").is_ok());
        assert!(google_authorization_url("https://accounts.google.com/other").is_err());
        assert!(google_authorization_url("https://example.org/o/oauth2/v2/auth").is_err());
    }
}
