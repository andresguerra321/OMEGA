use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Firma un payload JSON con HMAC-SHA256 (hex minúsculas) compatible con el relay de OMEGA.
pub fn sign_payload(secret: &str, timestamp_iso: &str, payload: &[u8]) -> Result<String, &'static str> {
    if secret.trim().is_empty() {
        return Err("HMAC secret vacío");
    }
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).map_err(|_| "Clave HMAC inválida")?;
    mac.update(timestamp_iso.as_bytes());
    mac.update(b".");
    mac.update(payload);
    Ok(hex::encode(mac.finalize().into_bytes()))
}

/// Verifica una firma HMAC-SHA256 en tiempo constante.
pub fn verify_payload(secret: &str, timestamp_iso: &str, payload: &[u8], signature_hex: &str) -> bool {
    if secret.trim().is_empty() || signature_hex.trim().is_empty() {
        return false;
    }
    let Ok(sig_bytes) = hex::decode(signature_hex.trim()) else {
        return false;
    };
    let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(timestamp_iso.as_bytes());
    mac.update(b".");
    mac.update(payload);
    mac.verify_slice(&sig_bytes).is_ok()
}
