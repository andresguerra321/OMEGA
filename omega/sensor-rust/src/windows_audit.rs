use serde_json::{json, Value};

pub fn collect() -> Value {
    #[cfg(windows)]
    {
        use std::io::Read;
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        use std::sync::mpsc;
        use std::time::Duration;

        let result = (|| -> Result<Value, String> {
            let mut child = Command::new("powershell.exe")
                .args([
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    include_str!("windows_audit.ps1"),
                ])
                .creation_flags(0x08000000)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|_| "No se pudo iniciar la consulta de Windows".to_string())?;
            let mut output = child
                .stdout
                .take()
                .ok_or("Sin salida de la consulta de Windows")?;
            let (sender, receiver) = mpsc::channel();
            std::thread::spawn(move || {
                let mut bytes = Vec::new();
                let result = output
                    .by_ref()
                    .take(8 * 1024 * 1024 + 1)
                    .read_to_end(&mut bytes);
                let _ = sender.send(result.map(|_| bytes));
            });
            let received = receiver.recv_timeout(Duration::from_secs(30));
            // Kill only this read-only collector if it hangs or exceeds the output budget.
            if received.is_err()
                || received
                    .as_ref()
                    .ok()
                    .and_then(|result| result.as_ref().ok())
                    .is_some_and(|bytes| bytes.len() > 8 * 1024 * 1024)
            {
                let _ = child.kill();
            }
            let exit = child
                .wait()
                .map_err(|_| "No se pudo cerrar la consulta de Windows")?;
            let bytes = received
                .map_err(|_| "La consulta de Windows excedió 30 segundos")?
                .map_err(|_| "No se pudo leer la consulta de Windows")?;
            if !exit.success() || bytes.len() > 8 * 1024 * 1024 {
                return Err("La consulta de Windows falló o excedió el límite de datos".into());
            }
            serde_json::from_slice(&bytes)
                .map_err(|_| "La consulta de Windows no devolvió JSON válido".into())
        })();
        return result.unwrap_or_else(|error| json!({"collection_status": {"windows": "unavailable"}, "collection_errors": [error]}));
    }
    #[cfg(not(windows))]
    json!({"collection_status": {"platform_controls": "unsupported"}})
}
