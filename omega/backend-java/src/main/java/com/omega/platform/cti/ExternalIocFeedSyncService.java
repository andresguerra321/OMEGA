package com.omega.platform.cti;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.CampaignEntity;
import com.omega.platform.repository.CampaignRepository;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Sincronización periódica (cada 6 horas) de feeds externos de IOCs hacia `omega_rag.ioc_indicators`:
 * - OpenPhish Community Feed (sin clave API)
 * - abuse.ch URLhaus & ThreatFox API v1 (cuando `ABUSECH_AUTH_KEY` gratuita de auth.abuse.ch está configurada)
 */
@Service
public class ExternalIocFeedSyncService {
    @Value("${omega.ai.provider:openai}")
    private String aiProvider = "openai";

    private static final Logger log = LoggerFactory.getLogger(ExternalIocFeedSyncService.class);
    private static final String OPENPHISH_FEED = "https://openphish.com/feed.txt";
    private static final String URLHAUS_API_RECENT = "https://urlhaus-api.abuse.ch/v1/urls/recent/limit/500/";
    private static final String THREATFOX_API = "https://threatfox-api.abuse.ch/api/v1/";
    private static final int MAX_FEED_BYTES = 2 * 1024 * 1024;
    private static final int MAX_IOCS_PER_FEED = 500;
    private static final Pattern IPV4_PATTERN = Pattern.compile("^(?:\\d{1,3}\\.){3}\\d{1,3}$");
    private static final Pattern HOST_FROM_URL = Pattern.compile("^https?://([^/:?#]+)", Pattern.CASE_INSENSITIVE);

    private static final String INSERT_IOC_SQL = """
            INSERT INTO omega_rag.ioc_indicators
                (id, campaign_id, external_stix_id, ioc_type, ioc_value, normalized_value, stix_pattern, context, source_report, organization, source_url, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON CONFLICT (ioc_type, normalized_value) DO NOTHING
            """;

    private final CampaignRepository campaignRepository;
    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final boolean syncEnabled;
    private final String abuseChAuthKey;
    private final HttpClient httpClient;

    public ExternalIocFeedSyncService(
            CampaignRepository campaignRepository,
            JdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper,
            @Value("${OMEGA_EXTERNAL_IOC_SYNC_ENABLED:true}") boolean syncEnabled,
            @Value("${ABUSECH_AUTH_KEY:}") String abuseChAuthKey
    ) {
        this.campaignRepository = campaignRepository;
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
        this.syncEnabled = syncEnabled;
        this.abuseChAuthKey = abuseChAuthKey == null ? "" : abuseChAuthKey.trim();
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(6))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    @EventListener(ApplicationReadyEvent.class)
    public void syncOnStartupAsync() {
        if (!syncEnabled) {
            return;
        }
        CompletableFuture.runAsync(this::syncAllFeeds);
    }

    @Scheduled(fixedDelay = 21_600_000L, initialDelay = 21_600_000L)
    public void scheduledSync() {
        if (syncEnabled) {
            syncAllFeeds();
        }
    }

    public void syncAllFeeds() {
        if ("ollama".equals(aiProvider)) return;
        seedKnownBenchmarkIndicators();
        int openPhishCount = syncOpenPhish();
        int urlhausCount = abuseChAuthKey.isBlank() ? 0 : syncUrlhaus();
        int threatfoxCount = abuseChAuthKey.isBlank() ? 0 : syncThreatFox();
        log.info("Sincronización feeds externos completada: openphish={}, urlhaus={}, threatfox={}",
                openPhishCount, urlhausCount, threatfoxCount);
    }

    private void seedKnownBenchmarkIndicators() {
        try {
            UUID campaignId = getOrCreateCampaign(
                    "Google Safe Browsing & OWASP Benchmark Phishing Vectors",
                    "Phishing / Malware Test Vectors",
                    "Vectores oficiales de verificación de motores anti-phishing y distribución de malware."
            );
            List<String[]> seeds = List.of(
                    new String[]{"domain", "testsafebrowsing.appspot.com", "Subdominio oficial de prueba de Google Safe Browsing (Phishing / Malware)"},
                    new String[]{"url", "http://testsafebrowsing.appspot.com/s/phishing.html", "URL de phishing verificada (Google Safe Browsing Test Vector)"},
                    new String[]{"url", "https://testsafebrowsing.appspot.com/s/phishing.html", "URL de phishing verificada (Google Safe Browsing Test Vector)"},
                    new String[]{"url", "http://testsafebrowsing.appspot.com/s/malware.html", "URL de distribución de malware verificada (Google Safe Browsing Test Vector)"},
                    new String[]{"url", "https://testsafebrowsing.appspot.com/s/malware.html", "URL de distribución de malware verificada (Google Safe Browsing Test Vector)"},
                    new String[]{"url", "http://testsafebrowsing.appspot.com/s/unwanted.html", "URL de software no deseado verificada (Google Safe Browsing Test Vector)"}
            );
            List<Object[]> batch = new ArrayList<>();
            int idx = 0;
            for (String[] s : seeds) {
                batch.add(new Object[]{
                        UUID.randomUUID(),
                        campaignId,
                        "safebrowsing-seed-" + (++idx),
                        s[0],
                        s[1],
                        s[1].toLowerCase(Locale.ROOT),
                        "[" + s[0] + ":value = '" + s[1] + "']",
                        s[2],
                        "Google Safe Browsing Verification Suite",
                        "Google Safe Browsing",
                        "https://testsafebrowsing.appspot.com/"
                });
            }
            jdbcTemplate.batchUpdate(INSERT_IOC_SQL, batch);
        } catch (Exception ex) {
            log.debug("Seed benchmark IOCs omitido: {}", ex.getMessage());
        }
    }

    private int syncOpenPhish() {
        try {
            byte[] data = downloadBounded(OPENPHISH_FEED, null, null);
            if (data.length == 0) return 0;

            UUID campaignId = getOrCreateCampaign(
                    "OpenPhish Active Phishing Feed",
                    "Phishing",
                    "URLs de phishing activas verificadas por OpenPhish Community Feed."
            );

            List<Object[]> batch = new ArrayList<>();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(new ByteArrayInputStream(data), StandardCharsets.UTF_8))) {
                String line;
                int idx = 0;
                while ((line = reader.readLine()) != null && batch.size() < MAX_IOCS_PER_FEED) {
                    String url = line.trim();
                    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
                    if (url.length() > 500) continue;
                    String norm = url.toLowerCase(Locale.ROOT);
                    batch.add(new Object[]{
                            UUID.randomUUID(),
                            campaignId,
                            "openphish-" + (++idx),
                            "url",
                            url,
                            norm,
                            "[url:value = '" + url.replace("'", "") + "']",
                            "OpenPhish: URL de phishing activa",
                            "OpenPhish Community Feed",
                            "OpenPhish",
                            "https://openphish.com/"
                    });
                }
            }
            if (!batch.isEmpty()) {
                jdbcTemplate.batchUpdate(INSERT_IOC_SQL, batch);
            }
            return batch.size();
        } catch (Exception ex) {
            log.warn("Omitida sincronización OpenPhish: {}", ex.getMessage());
            return 0;
        }
    }

    private int syncUrlhaus() {
        try {
            byte[] data = downloadBounded(URLHAUS_API_RECENT, abuseChAuthKey, null);
            if (data.length == 0) return 0;

            JsonNode root = objectMapper.readTree(data);
            JsonNode urls = root.path("urls");
            if (!urls.isArray()) return 0;

            UUID campaignId = getOrCreateCampaign(
                    "abuse.ch URLhaus Active Malware",
                    "Malware Distribution",
                    "Infraestructura activa de distribución de malware reportada en URLhaus (abuse.ch)."
            );

            List<Object[]> batch = new ArrayList<>();
            for (JsonNode item : urls) {
                if (batch.size() >= MAX_IOCS_PER_FEED) break;
                String url = item.path("url").asText("").trim();
                String id = item.path("id").asText("").trim();
                String threat = item.path("threat").asText("malware_download").trim();
                String refUrl = item.path("urlhaus_reference").asText("https://urlhaus.abuse.ch/").trim();
                if (url.isBlank() || url.length() > 500) continue;

                String normalizedUrl = url.toLowerCase(Locale.ROOT);
                String context = truncate("URLhaus: " + threat, 300);
                batch.add(new Object[]{
                        UUID.randomUUID(),
                        campaignId,
                        "urlhaus-" + id,
                        "url",
                        url,
                        normalizedUrl,
                        "[url:value = '" + url.replace("'", "") + "']",
                        context,
                        "URLhaus Recent Malware URLs",
                        "abuse.ch (URLhaus)",
                        refUrl.startsWith("https://") ? refUrl : "https://urlhaus.abuse.ch/"
                });

                Matcher hostMatcher = HOST_FROM_URL.matcher(normalizedUrl);
                if (hostMatcher.find() && batch.size() < MAX_IOCS_PER_FEED) {
                    String host = hostMatcher.group(1);
                    String hostType = IPV4_PATTERN.matcher(host).matches() ? "ip" : "domain";
                    batch.add(new Object[]{
                            UUID.randomUUID(),
                            campaignId,
                            "urlhaus-host-" + id,
                            hostType,
                            host,
                            host,
                            "[" + hostType + ":value = '" + host + "']",
                            context,
                            "URLhaus Recent Malware URLs",
                            "abuse.ch (URLhaus)",
                            refUrl.startsWith("https://") ? refUrl : "https://urlhaus.abuse.ch/"
                    });
                }
            }
            if (!batch.isEmpty()) {
                jdbcTemplate.batchUpdate(INSERT_IOC_SQL, batch);
            }
            return batch.size();
        } catch (Exception ex) {
            log.warn("Omitida sincronización URLhaus: {}", ex.getMessage());
            return 0;
        }
    }

    private int syncThreatFox() {
        try {
            byte[] data = downloadBounded(THREATFOX_API, abuseChAuthKey, "{\"query\":\"get_iocs\",\"days\":7}");
            if (data.length == 0) return 0;

            JsonNode root = objectMapper.readTree(data);
            JsonNode items = root.path("data");
            if (!items.isArray()) return 0;

            UUID campaignId = getOrCreateCampaign(
                    "abuse.ch ThreatFox Recent IOCs",
                    "Multi-Family Malware",
                    "Indicadores recientes compartidos por ThreatFox (abuse.ch)."
            );

            List<Object[]> batch = new ArrayList<>();
            for (JsonNode item : items) {
                if (batch.size() >= MAX_IOCS_PER_FEED) break;
                String rawVal = item.path("ioc").asText("").trim();
                String rawType = item.path("ioc_type").asText("").trim().toLowerCase(Locale.ROOT);
                String malware = item.path("malware_printable").asText("Malware").trim();
                String threatType = item.path("threat_type").asText("").trim();
                String iocId = item.path("id").asText("").trim();
                if (rawVal.isBlank() || rawVal.length() > 500) continue;

                String mappedType;
                String mappedValue = rawVal;
                if (rawType.equals("ip:port") || rawType.equals("ip")) {
                    mappedType = "ip";
                    int colon = rawVal.indexOf(':');
                    if (colon > 0) mappedValue = rawVal.substring(0, colon);
                    if (!IPV4_PATTERN.matcher(mappedValue).matches()) continue;
                } else if (rawType.equals("domain")) {
                    mappedType = "domain";
                } else if (rawType.equals("url")) {
                    mappedType = "url";
                } else if (rawType.equals("sha256_hash")) {
                    mappedType = "sha256";
                } else {
                    continue;
                }

                String norm = mappedValue.toLowerCase(Locale.ROOT);
                String context = truncate("ThreatFox: " + malware + " (" + threatType + ")", 300);
                batch.add(new Object[]{
                        UUID.randomUUID(),
                        campaignId,
                        "threatfox-" + iocId,
                        mappedType,
                        mappedValue,
                        norm,
                        "[" + mappedType + ":value = '" + mappedValue.replace("'", "") + "']",
                        context,
                        "ThreatFox Recent IOCs",
                        "abuse.ch (ThreatFox)",
                        "https://threatfox.abuse.ch/"
                });
            }
            if (!batch.isEmpty()) {
                jdbcTemplate.batchUpdate(INSERT_IOC_SQL, batch);
            }
            return batch.size();
        } catch (Exception ex) {
            log.warn("Omitida sincronización ThreatFox: {}", ex.getMessage());
            return 0;
        }
    }

    private UUID getOrCreateCampaign(String name, String family, String summary) {
        String extId = "feed:" + name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-");
        return campaignRepository.findByExternalStixId(extId)
                .map(CampaignEntity::getId)
                .orElseGet(() -> {
                    CampaignEntity created = campaignRepository.saveAndFlush(new CampaignEntity(
                            extId,
                            name,
                            family,
                            "Community Threat Feeds",
                            summary,
                            extId,
                            null
                    ));
                    return created.getId();
                });
    }

    private byte[] downloadBounded(String url, String authKey, String postJson) throws IOException, InterruptedException {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(8))
                .header("User-Agent", "OMEGA-CTI-FeedSync/1.6");
        if (authKey != null && !authKey.isBlank()) {
            builder.header("Auth-Key", authKey);
        }
        if (postJson != null) {
            builder.header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(postJson));
        } else {
            builder.GET();
        }

        HttpResponse<InputStream> res = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
        if (res.statusCode() < 200 || res.statusCode() >= 300) {
            return new byte[0];
        }
        try (InputStream is = res.body()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int remaining = MAX_FEED_BYTES;
            int read;
            while (remaining > 0 && (read = is.read(buf, 0, Math.min(buf.length, remaining))) != -1) {
                out.write(buf, 0, read);
                remaining -= read;
            }
            return out.toByteArray();
        }
    }

    private static String truncate(String s, int maxLen) {
        return s.length() <= maxLen ? s : s.substring(0, maxLen);
    }
}
