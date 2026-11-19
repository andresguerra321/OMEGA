package com.omega.platform.cti;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.util.Base64;
import org.junit.jupiter.api.Test;

class SignedFeedVerifierTest {

    @Test
    void acceptsValidEd25519SignatureAndRejectsTamperedPayload() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("Ed25519");
        KeyPair kp = kpg.generateKeyPair();

        String pemPublicKey = "-----BEGIN PUBLIC KEY-----\n"
                + Base64.getEncoder().encodeToString(kp.getPublic().getEncoded())
                + "\n-----END PUBLIC KEY-----";

        SignedFeedVerifier verifier = new SignedFeedVerifier(pemPublicKey);
        assertTrue(verifier.isSignatureVerificationEnforced());

        byte[] payload = "{\"type\":\"bundle\",\"objects\":[]}".getBytes(StandardCharsets.UTF_8);
        Signature signer = Signature.getInstance("Ed25519");
        signer.initSign(kp.getPrivate());
        signer.update(payload);
        String signatureB64 = Base64.getEncoder().encodeToString(signer.sign());

        assertTrue(verifier.verify(payload, signatureB64));

        byte[] tampered = "{\"type\":\"bundle\",\"objects\":[{\"evil\":true}]}".getBytes(StandardCharsets.UTF_8);
        assertFalse(verifier.verify(tampered, signatureB64));
        assertFalse(verifier.verify(payload, "not-a-valid-signature"));
        assertFalse(verifier.verify(payload, ""));
    }

    @Test
    void unconfiguredVerifierIsNotEnforcedAndFailsClosedOnVerify() {
        SignedFeedVerifier verifier = new SignedFeedVerifier("");
        assertFalse(verifier.isSignatureVerificationEnforced());
        assertFalse(verifier.verify("data".getBytes(StandardCharsets.UTF_8), "AAAA"));
    }

    @Test
    void invalidConfiguredPublicKeyFailsFast() {
        assertThrows(IllegalStateException.class, () -> new SignedFeedVerifier("not-valid-base64-key!!!"));
    }
}
