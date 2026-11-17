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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Consulta bajo demanda de reputación externa en AbuseIPDB (IPs) y VirusTotal v3 (hash/dominio/IP),
 * respetando cuotas gratuitas sin sincronización masiva.
 */
@Service
public class ExternalReputationService {

    private static final Pattern IPV4_PATTERN = Pattern.compile("^(?:\\d{1,3}\\.){3}\\d{1,3}$");
    private static final Pattern SHA256_PATTERN = Pattern.compile("^[a-f0-9]{64}$");

    private final PublicSchemaSupport publicSchemaSupport;
    private final ObjectMapper objectMapper;
    private final String virusTotalKey;
    private final String abuseIpDbKey;
    private final HttpClient httpClient;

    public ExternalReputationService(
            PublicSchemaSupport publicSchemaSupport,
            ObjectMapper objectMapper,
            @Value("${VIRUSTOTAL_API_KEY:}") String virusTotalKey,
            @Value("${ABUSEIPDB_API_KEY:}") String abuseIpDbKey
    ) {
        this.publicSchemaSupport = publicSchemaSupport;
        this.objectMapper = objectMapper;
        this.virusTotalKey = virusTotalKey == null ? "" : virusTotalKey.trim();
        this.abuseIpDbKey = abuseIpDbKey == null ? "" : abuseIpDbKey.trim();
        this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }

    public Map<String, Object> lookupIndicator(String rawIndicator) {
        String indicator = rawIndicator == null ? "" : rawIndicator.trim().toLowerCase(Locale.ROOT);
        if (indicator.isBlank() || indicator.length() > 300) {
            throw new IllegalArgumentException("Indicador inválido para consulta de reputación.");
        }

        List<CtiMatchRecord> localMatches = publicSchemaSupport.matchKnownIocs(List.of(indicator), 20);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("indicator", indicator);
        result.put("local_cti_matches", localMatches);
        result.put("abuseipdb", IPV4_PATTERN.matcher(indicator).matches() ? queryAbuseIpDb(indicator) : Map.of("status", "skipped", "reason", "Solo aplica a direcciones IPv4"));
        result.put("virustotal", queryVirusTotal(indicator));
        return result;
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
                    "isp", data.path("isp").asText("")
            );
        } catch (Exception ex) {
            return Map.of("status", "error", "message", "No se pudo consultar AbuseIPDB.");
        }
    }

    private Map<String, Object> queryVirusTotal(String indicator) {
        if (virusTotalKey.isBlank()) {
            return Map.of("status", "unconfigured", "message", "VIRUSTOTAL_API_KEY no configurada.");
        }
        try {
            String path;
            if (SHA256_PATTERN.matcher(indicator).matches()) {
                path = "/files/" + indicator;
            } else if (IPV4_PATTERN.matcher(indicator).matches()) {
                path = "/ip_addresses/" + indicator;
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
            if (res.statusCode() == 404) {
                return Map.of("status", "not_found");
            }
            if (res.statusCode() != 200) {
                return Map.of("status", "unavailable", "http_status", res.statusCode());
            }
            JsonNode stats = objectMapper.readTree(res.body()).path("data").path("attributes").path("last_analysis_stats");
            return Map.of(
                    "status", "ok",
                    "malicious", stats.path("malicious").asInt(0),
                    "suspicious", stats.path("suspicious").asInt(0),
                    "harmless", stats.path("harmless").asInt(0),
                    "undetected", stats.path("undetected").asInt(0)
            );
        } catch (Exception ex) {
            return Map.of("status", "error", "message", "No se pudo consultar VirusTotal.");
        }
    }
}
