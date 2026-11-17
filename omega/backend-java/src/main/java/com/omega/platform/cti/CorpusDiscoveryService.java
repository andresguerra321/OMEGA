package com.omega.platform.cti;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * Agente de monitoreo continuo de feeds RSS/Atom (Citizen Lab, Amnesty Security Lab, Google TAG).
 * Nunca indexa automáticamente en `public.reports`: coloca los hallazgos en cola `PENDING` para
 * revisión y aprobación humana explícita, mitigando envenenamiento de fuentes.
 */
@Service
public class CorpusDiscoveryService {

    private static final Logger log = LoggerFactory.getLogger(CorpusDiscoveryService.class);
    private static final int MAX_FEED_BYTES = 1024 * 1024;
    private static final String ZERO_VECTOR_768 =
            "[" + IntStream.range(0, 768).mapToObj(i -> "0").collect(Collectors.joining(",")) + "]";

    private record FeedSource(String organization, String url) {}

    private static final List<FeedSource> FEEDS = List.of(
            new FeedSource("Citizen Lab", "https://citizenlab.ca/feed/"),
            new FeedSource("Amnesty International Security Lab", "https://securitylab.amnesty.org/feed/"),
            new FeedSource("Google TAG", "https://blog.google/threat-analysis-group/rss/")
    );

    private final JdbcTemplate jdbcTemplate;
    private final PublicSchemaSupport publicSchemaSupport;
    private final AuditLogService auditLogService;
    private final boolean discoveryEnabled;
    private final HttpClient httpClient;

    public CorpusDiscoveryService(
            JdbcTemplate jdbcTemplate,
            PublicSchemaSupport publicSchemaSupport,
            AuditLogService auditLogService,
            @Value("${OMEGA_CORPUS_DISCOVERY_ENABLED:true}") boolean discoveryEnabled
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.publicSchemaSupport = publicSchemaSupport;
        this.auditLogService = auditLogService;
        this.discoveryEnabled = discoveryEnabled;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(6))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    @EventListener(ApplicationReadyEvent.class)
    public void scanOnStartupAsync() {
        if (discoveryEnabled) {
            CompletableFuture.runAsync(this::scanAllFeeds);
        }
    }

    @Scheduled(fixedDelay = 21_600_000L, initialDelay = 21_600_000L)
    public void scheduledScan() {
        if (discoveryEnabled) {
            scanAllFeeds();
        }
    }

    public int scanAllFeeds() {
        int discovered = 0;
        for (FeedSource feed : FEEDS) {
            discovered += scanSingleFeed(feed);
        }
        if (discovered > 0) {
            log.info("Agente RSS CTI: {} nuevo(s) reporte(s) en cola de aprobación humana.", discovered);
        }
        return discovered;
    }

    public List<Map<String, Object>> listQueue(String statusFilter) {
        String status = (statusFilter == null || statusFilter.isBlank()) ? "PENDING" : statusFilter.trim().toUpperCase();
        return jdbcTemplate.queryForList(
                """
                SELECT id, source_name, title, source_url, summary, published_date, status, discovered_at, reviewed_at
                FROM omega_rag.corpus_discovery_queue
                WHERE status = ?
                ORDER BY discovered_at DESC
                LIMIT 50
                """,
                status
        );
    }

    @Transactional
    public Map<String, Object> approveCandidate(UUID candidateId, OmegaPrincipal principal) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT id, source_name, title, source_url, summary, published_date, status FROM omega_rag.corpus_discovery_queue WHERE id = ?",
                candidateId
        );
        if (rows.isEmpty()) {
            throw new IllegalArgumentException("Candidato de reporte no encontrado.");
        }
        Map<String, Object> row = rows.get(0);
        String sourceName = String.valueOf(row.get("source_name"));
        String title = String.valueOf(row.get("title"));
        String sourceUrl = String.valueOf(row.get("source_url"));
        String summary = String.valueOf(row.get("summary") == null ? "" : row.get("summary"));

        String content = (title + "\n\nFuente: " + sourceName + "\nURL: " + sourceUrl + "\n\n" + summary).trim();
        String fileHash = sha256Hex(sourceUrl + "|" + title);

        if (publicSchemaSupport.hasTable("public.reports")
                && publicSchemaSupport.hasTable("public.document_chunks")) {
            UUID reportId = UUID.randomUUID();
            int inserted = jdbcTemplate.update(
                    """
                    INSERT INTO public.reports
                        (id, title, organization, source_url, local_filename, file_hash, ingested_at)
                    VALUES (?, ?, ?, ?, ?, ?, NOW())
                    ON CONFLICT (file_hash) DO NOTHING
                    """,
                    reportId,
                    truncate(title, 500),
                    truncate(sourceName, 150),
                    sourceUrl,
                    truncate("rss_" + fileHash.substring(0, 12) + ".txt", 255),
                    fileHash
            );
            if (inserted > 0) {
                jdbcTemplate.update(
                        """
                        INSERT INTO public.document_chunks
                            (id, report_id, chunk_index, page_number, section_title, content, embedding, created_at)
                        VALUES (?, ?, 0, 1, ?, ?, CAST(? AS vector), NOW())
                        ON CONFLICT (report_id, chunk_index) DO NOTHING
                        """,
                        UUID.randomUUID(),
                        reportId,
                        truncate(title, 255),
                        content,
                        ZERO_VECTOR_768
                );
            }
        }

        jdbcTemplate.update(
                "UPDATE omega_rag.corpus_discovery_queue SET status = 'APPROVED', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
                principal.userId(),
                candidateId
        );

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "CORPUS_CANDIDATE_APPROVED",
                "CORPUS_DISCOVERY",
                candidateId.toString(),
                Map.of("title", truncate(title, 120), "source", sourceName)
        );
        return Map.of("ok", true, "id", candidateId.toString(), "status", "APPROVED");
    }

    @Transactional
    public Map<String, Object> rejectCandidate(UUID candidateId, OmegaPrincipal principal) {
        int updated = jdbcTemplate.update(
                "UPDATE omega_rag.corpus_discovery_queue SET status = 'REJECTED', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
                principal.userId(),
                candidateId
        );
        if (updated == 0) {
            throw new IllegalArgumentException("Candidato de reporte no encontrado.");
        }
        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "CORPUS_CANDIDATE_REJECTED",
                "CORPUS_DISCOVERY",
                candidateId.toString(),
                Map.of()
        );
        return Map.of("ok", true, "id", candidateId.toString(), "status", "REJECTED");
    }

    private int scanSingleFeed(FeedSource feed) {
        try {
            byte[] xmlBytes = downloadBounded(feed.url());
            if (xmlBytes.length == 0) return 0;

            DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
            dbf.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
            dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            dbf.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            dbf.setXIncludeAware(false);
            dbf.setExpandEntityReferences(false);

            Document doc = dbf.newDocumentBuilder().parse(new ByteArrayInputStream(xmlBytes));
            List<Element> items = new ArrayList<>();
            NodeList rssItems = doc.getElementsByTagName("item");
            for (int i = 0; i < rssItems.getLength() && i < 15; i++) {
                items.add((Element) rssItems.item(i));
            }
            if (items.isEmpty()) {
                NodeList atomEntries = doc.getElementsByTagName("entry");
                for (int i = 0; i < atomEntries.getLength() && i < 15; i++) {
                    items.add((Element) atomEntries.item(i));
                }
            }

            int added = 0;
            for (Element item : items) {
                String title = textTag(item, "title");
                String link = textTag(item, "link");
                if (link.isBlank()) {
                    NodeList links = item.getElementsByTagName("link");
                    if (links.getLength() > 0) {
                        link = ((Element) links.item(0)).getAttribute("href").trim();
                    }
                }
                if (title.isBlank() || !link.startsWith("https://")) continue;
                if (isAlreadyInPublicReports(link)) continue;

                String summary = stripHtml(textTag(item, "description"));
                if (summary.isBlank()) summary = stripHtml(textTag(item, "summary"));
                String pubDate = textTag(item, "pubDate");
                if (pubDate.isBlank()) pubDate = textTag(item, "updated");

                int ins = jdbcTemplate.update(
                        """
                        INSERT INTO omega_rag.corpus_discovery_queue
                            (id, source_name, title, source_url, summary, published_date, content_hash, status, discovered_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW())
                        ON CONFLICT (source_url) DO NOTHING
                        """,
                        UUID.randomUUID(),
                        truncate(feed.organization(), 150),
                        truncate(title, 500),
                        link,
                        truncate(summary, 2000),
                        truncate(pubDate, 64),
                        sha256Hex(link)
                );
                added += ins;
            }
            return added;
        } catch (Exception ex) {
            log.debug("Omitido feed RSS {} ({}): {}", feed.organization(), feed.url(), ex.getMessage());
            return 0;
        }
    }

    private boolean isAlreadyInPublicReports(String sourceUrl) {
        if (!publicSchemaSupport.hasTable("public.reports")) return false;
        Integer cnt = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM public.reports WHERE source_url = ?",
                Integer.class,
                sourceUrl
        );
        return cnt != null && cnt > 0;
    }

    private byte[] downloadBounded(String url) throws Exception {
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(6))
                .header("User-Agent", "OMEGA-CTI-Monitor/1.6")
                .GET()
                .build();
        HttpResponse<InputStream> res = httpClient.send(req, HttpResponse.BodyHandlers.ofInputStream());
        if (res.statusCode() < 200 || res.statusCode() >= 300) return new byte[0];
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

    private static String textTag(Element parent, String tag) {
        NodeList list = parent.getElementsByTagName(tag);
        if (list.getLength() == 0 || list.item(0) == null) return "";
        return list.item(0).getTextContent().trim();
    }

    private static String stripHtml(String s) {
        return s == null ? "" : s.replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim();
    }

    private static String sha256Hex(String s) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception ex) {
            return UUID.randomUUID().toString().replace("-", "");
        }
    }

    private static String truncate(String s, int maxLen) {
        return s.length() <= maxLen ? s : s.substring(0, maxLen);
    }
}
