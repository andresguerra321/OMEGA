package com.omega.platform.billing;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Locale;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class MercadoPagoSignature {
    public static final long DEFAULT_MAX_AGE_SECONDS = 300L;

    private MercadoPagoSignature() {}

    public static boolean valid(String secret, String signature, String requestId, String dataId) {
        return valid(secret, signature, requestId, dataId, Instant.now(), DEFAULT_MAX_AGE_SECONDS);
    }

    public static boolean valid(
            String secret,
            String signature,
            String requestId,
            String dataId,
            Instant now,
            long maxAgeSeconds
    ) {
        if (secret == null || secret.isBlank() || signature == null || requestId == null || dataId == null || now == null) {
            return false;
        }
        try {
            String timestamp = null, expected = null;
            for (String part : signature.split(",")) {
                String[] pair = part.trim().split("=", 2);
                if (pair.length != 2) return false;
                if (pair[0].equals("ts")) { if (timestamp != null) return false; timestamp = pair[1]; }
                if (pair[0].equals("v1")) { if (expected != null) return false; expected = pair[1]; }
            }
            if (timestamp == null || !timestamp.matches("[0-9]{10,16}") || expected == null || !expected.matches("[a-fA-F0-9]{64}")) {
                return false;
            }
            if (maxAgeSeconds > 0) {
                long rawTs = Long.parseLong(timestamp);
                long tsSeconds = timestamp.length() >= 13 ? rawTs / 1000L : rawTs;
                if (Math.abs(now.getEpochSecond() - tsSeconds) > maxAgeSeconds) {
                    return false;
                }
            }
            String manifest = "id:" + dataId.toLowerCase(Locale.ROOT) + ";request-id:" + requestId + ";ts:" + timestamp + ";";
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return MessageDigest.isEqual(mac.doFinal(manifest.getBytes(StandardCharsets.UTF_8)), HexFormat.of().parseHex(expected));
        } catch (Exception ex) {
            return false;
        }
    }
}
