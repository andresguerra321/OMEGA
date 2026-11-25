use tauri_plugin_shell::ShellExt;

fn approved_checkout_url(raw: &str) -> Result<String, String> {
    if raw.len() > 4096 {
        return Err("Enlace de pago demasiado largo".into());
    }
    let url = tauri::Url::parse(raw).map_err(|_| "Enlace de pago inválido".to_string())?;
    let host = url.host_str().unwrap_or_default();
    let approved_host = host == "mercadopago.com.co"
        || host.ends_with(".mercadopago.com.co")
        || host == "mercadopago.com"
        || host.ends_with(".mercadopago.com");
    if url.scheme() != "https"
        || !approved_host
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
    {
        return Err("Solo se permiten enlaces HTTPS de Mercado Pago".into());
    }
    Ok(url.to_string())
}

#[tauri::command]
pub fn open_billing_checkout(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let approved = approved_checkout_url(&url)?;
    // Reuse the installed shell plugin without granting general URL-opening permissions to JavaScript.
    #[allow(deprecated)]
    app.shell()
        .open(approved, None)
        .map_err(|_| "No se pudo abrir Mercado Pago en el navegador".to_string())
}

#[cfg(test)]
mod tests {
    use super::approved_checkout_url;

    #[test]
    fn billing_checkout_only_opens_official_https_urls() {
        assert!(approved_checkout_url(
            "https://www.mercadopago.com.co/subscriptions/checkout?preapproval_id=123"
        )
        .is_ok());
        for url in [
            "http://www.mercadopago.com.co/",
            "https://www.mercadopago.com.co.evil.example/",
            "https://evil.example/",
            "https://user:password@www.mercadopago.com.co/",
            "https://www.mercadopago.com.co:8443/",
            "file:///C:/Windows/System32/cmd.exe",
            "javascript:alert(1)",
        ] {
            assert!(approved_checkout_url(url).is_err(), "accepted {url}");
        }
    }
}
