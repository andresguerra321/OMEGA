package com.omega.platform.cti;

import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Verificador criptográfico Ed25519 para feeds CTI externos (Amnesty Tech, Citizen Lab,
 * ThreatFox/URLhaus) antes de cargar indicadores en la base local o en sensores de host.
 * Aplica política fail-closed cuando hay una clave pública configurada.
 */
@Component
public class SignedFeedVerifier {

    private static final Logger log = LoggerFactory.getLogger(SignedFeedVerifier.class);

    private final PublicKey configuredPublicKey;

    public SignedFeedVerifier(@Value("${OMEGA_CTI_FEED_PUBLIC_KEY:}") String rawPublicKey) {
        this.configuredPublicKey = parsePublicKeyOrNull(rawPublicKey);
    }

    public boolean isSignatureVerificationEnforced() {
        return configuredPublicKey != null;
    }

    public boolean verify(byte[] payload, String signatureBase64) {
        if (configuredPublicKey == null) {
            return false;
        }
        return verifyWithKey(payload, signatureBase64, configuredPublicKey);
    }

    public static boolean verifyWithKey(byte[] payload, String signatureBase64, PublicKey publicKey) {
        if (payload == null || payload.length == 0 || signatureBase64 == null || signatureBase64.isBlank() || publicKey == null) {
            return false;
        }
        try {
            byte[] sigBytes = Base64.getDecoder().decode(signatureBase64.trim());
            Signature verifier = Signature.getInstance("Ed25519");
            verifier.initVerify(publicKey);
            verifier.update(payload);
            return verifier.verify(sigBytes);
        } catch (Exception ex) {
            log.warn("Firma Ed25519 de feed CTI rechazada: {}", ex.getClass().getSimpleName());
            return false;
        }
    }

    public static PublicKey parsePublicKeyOrNull(String rawPublicKey) {
        if (rawPublicKey == null || rawPublicKey.isBlank()) {
            return null;
        }
        try {
            String normalized = rawPublicKey
                    .replace("-----BEGIN PUBLIC KEY-----", "")
                    .replace("-----END PUBLIC KEY-----", "")
                    .replaceAll("\\s+", "");
            byte[] der = Base64.getDecoder().decode(normalized);
            return KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(der));
        } catch (Exception ex) {
            throw new IllegalStateException("OMEGA_CTI_FEED_PUBLIC_KEY no es una clave pública Ed25519 X.509 válida", ex);
        }
    }
}
