package com.omega.platform.service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** Only technical identifiers, fixed states, counters and timestamps belong in the audit chain. */
public final class AuditMetadataPolicy {
    private AuditMetadataPolicy() {}
    private static final Set<String> PRIVATE_KEYS = Set.of("originalfilename", "filename", "title", "name", "email",
            "error", "reason", "content", "text", "excerpt", "secret", "token", "password", "url", "path", "question",
            "key", "credential", "authorization", "cookie", "recovery", "trace", "stack", "snippet", "prompt", "payload", "body", "headers");
    private static final Set<String> FIXED_VALUES = Set.of("openai", "groq", "ollama", "custom", "omniroute", "pdf", "json");
    private static final Set<String> STATE_KEYS = Set.of("status", "finalstatus", "permission", "previouspermission",
            "previousprofile", "newprofile", "format", "risklevel", "errorcode", "reasoncode", "mode", "degradedmode",
            "actiontype", "method", "plan", "provider", "embeddingprovider", "responseprovider", "scope", "classification");

    public static Map<String, Object> sanitize(Map<String, ?> metadata) {
        Map<String, Object> safe = new LinkedHashMap<>();
        if (metadata == null) return safe;
        metadata.forEach((key, value) -> {
            String normalized = key.toLowerCase(java.util.Locale.ROOT);
            if (!Set.of("errorcode", "reasoncode").contains(normalized) && PRIVATE_KEYS.stream().anyMatch(normalized::contains)) return;
            if (value instanceof Number || value instanceof Boolean) safe.put(key, value);
            else if (value instanceof String text && isSafe(normalized, text)) safe.put(key, text);
        });
        return safe;
    }

    private static boolean isSafe(String key, String value) {
        if (key.endsWith("id") && value.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) return true;
        if (key.endsWith("hash") && value.matches("[0-9a-fA-F]{64}")) return true;
        if (STATE_KEYS.contains(key) && (value.matches("[A-Z][A-Z0-9_]{0,63}") || FIXED_VALUES.contains(value))) return true;
        if (!key.endsWith("at") && !key.endsWith("utc")) return false;
        try { Instant.parse(value); return true; } catch (Exception ex) { return false; }
    }
}
