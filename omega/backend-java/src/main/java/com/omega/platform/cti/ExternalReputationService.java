package com.omega.platform.cti;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.cti.PublicSchemaSupport.CtiMatchRecord;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Consulta bajo demanda de reputación externa en AbuseIPDB (IPs), VirusTotal v3
 * (URL completa Base64URL vt-py,
 * dominio, IP o SHA-256) y cruce multi-variante contra feeds CTI activos
 * (OpenPhish / URLhaus / ThreatFox).
 */
@Service
public class ExternalReputationService {
    @Value("${omega.ai.provider:openai}")
    private String aiProvider = "openai";

    private static final Pattern IPV4_PATTERN = Pattern.compile("^(?:\\d{1,3}\\.){3}\\d{1,3}$");
    private static final Pattern SHA256_PATTERN = Pattern.compile("^[a-f0-9]{64}$");

    private final PublicSchemaSupport publicSchemaSupport;
    private final ObjectMapper objectMapper;
    private final String virusTotalKey;
    private final String abuseIpDbKey;
    private final HttpClient httpClient;
    private org.springframework.web.client.RestClient infrastructureClient;

    @org.springframework.beans.factory.annotation.Autowired
    public void setInfrastructureClient(@org.springframework.beans.factory.annotation.Qualifier("forensicWorkerRestClient") org.springframework.web.client.RestClient client) {
        this.infrastructureClient = client;
    }

    public ExternalReputationService(
            PublicSchemaSupport publicSchemaSupport,
            ObjectMapper objectMapper,
            @Value("${VIRUSTOTAL_API_KEY:}") String virusTotalKey,
            @Value("${ABUSEIPDB_API_KEY:}") String abuseIpDbKey) {
        this.publicSchemaSupport = publicSchemaSupport;
        this.objectMapper = objectMapper;
        this.virusTotalKey = virusTotalKey == null ? "" : virusTotalKey.trim();
        this.abuseIpDbKey = abuseIpDbKey == null ? "" : abuseIpDbKey.trim();
        this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }

    public Map<String, Object> lookupIndicator(String rawIndicator) {
        String indicator = rawIndicator == null ? "" : rawIndicator.trim().toLowerCase(Locale.ROOT);
        if (indicator.isBlank() || indicator.length() > 1024) {
            throw new IllegalArgumentException("Indicador inválido para consulta de reputación.");
        }

        List<String> candidates = buildLookupCandidates(indicator);
        List<CtiMatchRecord> localMatches = publicSchemaSupport.matchKnownIocs(candidates, 30);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("indicator", indicator);
        result.put("local_cti_matches", localMatches);
        if ("ollama".equals(aiProvider)) {
            result.put("abuseipdb", Map.of("status", "disabled_local_mode"));
            result.put("virustotal", Map.of("status", "disabled_local_mode"));
            result.put("infrastructure_intelligence", Map.of("status", "disabled_local_mode"));
            result.put("riskLevel", localMatches.isEmpty() ? "UNKNOWN" : "HIGH");
            return result;
        }
        result.put(
                "abuseipdb",
                IPV4_PATTERN.matcher(indicator).matches()
                        ? queryAbuseIpDb(indicator)
                        : Map.of("status", "skipped", "reason", "Solo aplica a direcciones IPv4"));
        result.put("virustotal", queryVirusTotalOrCtiFallback(indicator, localMatches));
        Map<String, Object> infrastructure = queryInfrastructure(indicator);
        result.put("infrastructure_intelligence", infrastructure);
        String infrastructureRisk = String.valueOf(infrastructure.getOrDefault("riskLevel", "UNKNOWN"));
        result.put("riskLevel", !localMatches.isEmpty() && !"CRITICAL".equals(infrastructureRisk) ? "HIGH" : infrastructureRisk);
        return result;
    }

    Map<String, Object> queryInfrastructure(String indicator) {
        if (infrastructureClient == null || SHA256_PATTERN.matcher(indicator).matches() || IPV4_PATTERN.matcher(indicator).matches()) {
            return Map.of("status", "unavailable");
        }
        try {
            String url = indicator.startsWith("http://") || indicator.startsWith("https://") ? indicator : "https://" + indicator;
            Map<String, Object> response = infrastructureClient.post().uri("/api/link/infrastructure")
                    .contentType(org.springframework.http.MediaType.APPLICATION_JSON).body(Map.of("url", url, "activeProbe", false))
                    .retrieve().body(new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {});
            return response == null ? Map.of("status", "unavailable") : response;
        } catch (org.springframework.web.client.RestClientException ex) {
            return Map.of("status", "unavailable", "reason", "No se pudo consultar infraestructura fresca.");
        }
    }

    private static List<String> buildLookupCandidates(String indicator) {
        Set<String> set = new LinkedHashSet<>();
        set.add(indicator);
        if (indicator.startsWith("http://") || indicator.startsWith("https://")) {
            String stripped = indicator.endsWith("/") && indicator.length() > 8
                    ? indicator.substring(0, indicator.length() - 1)
                    : indicator;
            set.add(stripped);
            set.add(stripped + "/");
            String altScheme = stripped.startsWith("http://")
                    ? "https://" + stripped.substring("http://".length())
                    : "http://" + stripped.substring("https://".length());
            set.add(altScheme);
            set.add(altScheme + "/");
            try {
                URI uri = URI.create(indicator);
                if (uri.getHost() != null) {
                    String host = uri.getHost().toLowerCase(Locale.ROOT);
                    set.add(host);
                    if (uri.getPath() != null && !uri.getPath().isBlank() && !"/".equals(uri.getPath())) {
                        set.add(host + uri.getPath().toLowerCase(Locale.ROOT));
                    }
                }
            } catch (Exception ignored) {
            }
        }
        return new ArrayList<>(set);
    }

    private Map<String, Object> queryAbuseIpDb(String ip) {
        if (abuseIpDbKey.isBlank()) {
            return Map.of("status", "unconfigured", "message", "ABUSEIPDB_API_KEY no configurada.");
        }
        try {
            String url = "https://api.abuseipdb.com/api/v2/check?ipAddress="
                    + URLEncoder.encode(ip, StandardCharsets.UTF_8) + "&maxAgeInDays=90";
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(6))
                    .header("Key", abuseIpDbKey)
                    .header("Accept", "application/json")
                    .GET()
                    .build();
            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) {
                return Map.of("status", "unavailable", "http_status", res.statusCode());
            }
            JsonNode data = objectMapper.readTree(res.body()).path("data");
            return Map.of(
                    "status", "ok",
                    "abuse_confidence_score", data.path("abuseConfidenceScore").asInt(0),
                    "total_reports", data.path("totalReports").asInt(0),
                    "country_code", data.path("countryCode").asText(""),
                    "isp", data.path("isp").asText(""));
        } catch (Exception ex) {
            return Map.of("status", "error", "message", "No se pudo consultar AbuseIPDB.");
        }
    }

    private Map<String, Object> queryVirusTotalOrCtiFallback(String indicator, List<CtiMatchRecord> localMatches) {
        if (virusTotalKey.isBlank()) {
            int mal = localMatches != null ? localMatches.size() : 0;
            return Map.of(
                    "status", "ok",
                    "engine", "OpenPhish + OMEGA CTI",
                    "malicious", mal,
                    "suspicious", 0,
                    "harmless", 0,
                    "undetected", mal > 0 ? 0 : 1);
        }
        try {
            String path;
            if (SHA256_PATTERN.matcher(indicator).matches()) {
                path = "/files/" + indicator;
            } else if (IPV4_PATTERN.matcher(indicator).matches()) {
                path = "/ip_addresses/" + indicator;
            } else if (indicator.startsWith("http://") || indicator.startsWith("https://")) {
                String vtUrlId = Base64.getUrlEncoder()
                        .withoutPadding()
                        .encodeToString(indicator.getBytes(StandardCharsets.UTF_8));
                path = "/urls/" + vtUrlId;
            } else {
                path = "/domains/" + URLEncoder.encode(indicator, StandardCharsets.UTF_8);
            }
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create("https://www.virustotal.com/api/v3" + path))
                    .timeout(Duration.ofSeconds(6))
                    .header("x-apikey", virusTotalKey)
                    .header("Accept", "application/json")
                    .GET()
                    .build();
            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 404 && (indicator.startsWith("http://") || indicator.startsWith("https://"))) {
                URI uri = URI.create(indicator);
                if (uri.getHost() != null) {
                    return queryVirusTotalOrCtiFallback(uri.getHost().toLowerCase(Locale.ROOT), localMatches);
                }
            }
            if (res.statusCode() == 404) {
                int mal = localMatches != null ? localMatches.size() : 0;
                return Map.of("status", "not_found", "malicious", mal, "suspicious", 0, "harmless", 0,
                        "undetected", mal > 0 ? 0 : 1);
            }
            if (res.statusCode() != 200) {
                return Map.of("status", "unavailable", "http_status", res.statusCode());
            }
            JsonNode stats = objectMapper.readTree(res.body()).path("data").path("attributes")
                    .path("last_analysis_stats");
            return Map.of(
                    "status", "ok",
                    "malicious", stats.path("malicious").asInt(0),
                    "suspicious", stats.path("suspicious").asInt(0),
                    "harmless", stats.path("harmless").asInt(0),
                    "undetected", stats.path("undetected").asInt(0));
        } catch (Exception ex) {
            return Map.of("status", "error", "message", "No se pudo consultar VirusTotal.");
        }
    }
}
