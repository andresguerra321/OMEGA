mod hmac_auth;
mod infostealer;
mod server;
mod telemetry;
mod windows_audit;

use std::env;
use std::thread;
use std::time::Duration;

fn emit_once() {
    let snapshot = telemetry::collect_snapshot();
    match serde_json::to_string(&snapshot) {
        Ok(json) => println!("{json}"),
        Err(err) => {
            eprintln!("Error serializando telemetría: {err}");
            std::process::exit(1);
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("omega-sensor {}", env!("CARGO_PKG_VERSION"));
        return;
    }

    if let Some(pos) = args.iter().position(|a| a == "--serve") {
        let bind_addr = args
            .get(pos + 1)
            .map(String::as_str)
            .unwrap_or("127.0.0.1:18791");
        if let Err(err) = server::serve_loopback(bind_addr) {
            eprintln!("{err}");
            std::process::exit(1);
        }
        return;
    }

    if let Some(pos) = args.iter().position(|a| a == "--watch") {
        let interval_secs: u64 = args
            .get(pos + 1)
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(10)
            .max(2);
        loop {
            emit_once();
            thread::sleep(Duration::from_secs(interval_secs));
        }
    } else {
        emit_once();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infostealer_classifier_detects_secrets_and_ignores_electron_and_templates() {
        let chrome = infostealer::classify_sensitive_target(
            r"C:\Users\alice\AppData\Local\Google\Chrome\User Data\Default\Login Data",
        )
        .expect("should flag Chrome Login Data");
        assert_eq!(chrome.target_kind, "BROWSER_CREDENTIAL_STORE");
        assert_eq!(chrome.severity, "CRITICAL");

        let ssh = infostealer::classify_sensitive_target(r"C:\Users\alice\.ssh\id_ed25519")
            .expect("should flag SSH key");
        assert_eq!(ssh.target_kind, "SSH_PRIVATE_KEY");

        let env_file = infostealer::classify_sensitive_target("/srv/app/.env")
            .expect("should flag .env");
        assert_eq!(env_file.target_kind, "SECRET_ENV_OR_CLOUD_CREDENTIAL");

        assert!(infostealer::classify_sensitive_target("/srv/app/.env.example").is_none());
        assert!(infostealer::classify_sensitive_target(
            r"C:\Users\alice\AppData\Roaming\Docker Desktop\Network\Cookies"
        )
        .is_none());
    }

    #[test]
    fn infostealer_evaluator_allows_signed_chrome_and_flags_unsigned_stealer() {
        let cmd = vec![
            "stealer.exe".to_string(),
            r"C:\Users\alice\AppData\Local\Google\Chrome\User Data\Default\Login Data".to_string(),
        ];
        let flagged = infostealer::evaluate_cmdline_for_infostealer(
            999,
            "stealer.exe",
            r"C:\Users\alice\AppData\Local\Temp\stealer.exe",
            &cmd,
            false,
        );
        assert_eq!(flagged.len(), 1);
        assert_eq!(flagged[0].category, "INFOSTEALER_CREDENTIAL_ACCESS");

        let chrome_allowed = infostealer::evaluate_cmdline_for_infostealer(
            100,
            "chrome.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            &cmd,
            true,
        );
        assert!(chrome_allowed.is_empty());
    }

    #[test]
    fn hmac_auth_signs_and_verifies_payload() {
        let payload = br#"{"sensor":"omega-sensor-rust"}"#;
        let ts = "2026-11-18T23:55:00Z";
        let sig = hmac_auth::sign_payload("test-shared-secret", ts, payload).unwrap();
        assert!(hmac_auth::verify_payload("test-shared-secret", ts, payload, &sig));
        assert!(!hmac_auth::verify_payload("test-shared-secret", ts, b"tampered", &sig));
        assert!(!hmac_auth::verify_payload("wrong-secret", ts, payload, &sig));
    }

    #[test]
    fn collect_snapshot_returns_live_host_telemetry() {
        let snap = telemetry::collect_snapshot();
        assert_eq!(snap.sensor, "omega-sensor-rust");
        assert!(!snap.hostname.is_empty());
        assert!(snap.process_count > 0);
        let serialized = serde_json::to_string(&snap).unwrap();
        assert!(serialized.contains("omega-sensor-rust"));
    }
}
