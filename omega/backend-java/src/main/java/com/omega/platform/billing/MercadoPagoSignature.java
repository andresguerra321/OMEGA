package com.omega.platform.billing;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Locale;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class MercadoPagoSignature {
    private MercadoPagoSignature() {}
    public static boolean valid(String secret, String signature, String requestId, String dataId) {
        if (secret == null || secret.isBlank() || signature == null || requestId == null || dataId == null) return false;
        try {
            String timestamp = null, expected = null;
            for (String part : signature.split(",")) {
                String[] pair = part.trim().split("=", 2);
                if (pair.length != 2) return false;
                if (pair[0].equals("ts")) { if (timestamp != null) return false; timestamp = pair[1]; }
                if (pair[0].equals("v1")) { if (expected != null) return false; expected = pair[1]; }
            }
            if (timestamp == null || !timestamp.matches("[0-9]{10,16}") || expected == null || !expected.matches("[a-fA-F0-9]{64}")) return false;
            String manifest = "id:" + dataId.toLowerCase(Locale.ROOT) + ";request-id:" + requestId + ";ts:" + timestamp + ";";
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return MessageDigest.isEqual(mac.doFinal(manifest.getBytes(StandardCharsets.UTF_8)), HexFormat.of().parseHex(expected));
        } catch (Exception ex) { return false; }
    }
}
