package com.omega.platform.cti;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.omega.platform.cti.PublicSchemaSupport.CtiMatchRecord;
import com.omega.platform.ingest.InvalidDocumentException;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Extractor efímero en RAM para analizar reportes CTI públicos por URL con protección estricta anti-SSRF
 * (bloqueo de localhost, RFC1918, CGNAT, link-local / metadata 169.254.169.254 y redirecciones privadas).
 */
@Service
public class WebIntelExtractorService {

    private static final int MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
    private static final int MAX_REDIRECTS = 3;

    private static final Pattern TITLE_PATTERN =
            Pattern.compile("<title[^>]*>(.*?)</title>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern SCRIPT_STYLE_PATTERN =
            Pattern.compile("<(script|style|noscript)[^>]*>.*?</\\1>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern HTML_TAG_PATTERN = Pattern.compile("<[^>]+>");
    private static final Pattern WHITESPACE_PATTERN = Pattern.compile("\\s+");
    private static final Pattern IPV4_PATTERN =
            Pattern.compile("\\b(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\b");
    private static final Pattern DOMAIN_PATTERN =
            Pattern.compile("\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:com|net|org|io|info|biz|xyz|top|me|co|edu|gov|ru|cn|tk|cc|pw|club|online|site|app|dev|tech|onion)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern CVE_PATTERN =
            Pattern.compile("\\bCVE-\\d{4}-\\d{4,7}\\b", Pattern.CASE_INSENSITIVE);

    private final PublicSchemaSupport publicSchemaSupport;
    private final AuditLogService auditLogService;
    private final HttpClient httpClient;

    public WebIntelExtractorService(
            PublicSchemaSupport publicSchemaSupport,
            AuditLogService auditLogService
    ) {
        this.publicSchemaSupport = publicSchemaSupport;
        this.auditLogService = auditLogService;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(8))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    @Transactional
    public WebIntelScanResponse scanUrlEphemerally(
            OmegaPrincipal principal,
            String rawUrl,
            List<String> activeNet4Ips
    ) {
        URI targetUri = parseAndValidatePublicUri(rawUrl);
        String html = fetchBoundedHtmlWithSafeRedirects(targetUri);

        String title = extractTitle(html, targetUri.getHost());
        String cleanText = stripHtml(html);

        List<String> ipv4s = extractDistinctPublicIpv4s(cleanText);
        List<String> domains = extractDistinctDomains(cleanText, targetUri.getHost());
        List<String> cves = extractDistinctCves(cleanText);

        Set<String> activeSet = new LinkedHashSet<>();
        if (activeNet4Ips != null) {
            for (String ip : activeNet4Ips) {
                if (ip != null && !ip.isBlank()) {
                    activeSet.add(ip.trim());
                }
            }
        }
        List<String> matchedLiveNet4 = ipv4s.stream()
                .filter(activeSet::contains)
                .toList();

        List<String> lookupCandidates = new ArrayList<>();
        lookupCandidates.addAll(ipv4s);
        lookupCandidates.addAll(domains);
        List<PublicSchemaSupport.CtiMatchRecord> knownMatches =
                publicSchemaSupport.matchKnownIocs(lookupCandidates, 50);

        String preview = cleanText.length() > 420 ? cleanText.substring(0, 420) : cleanText;

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "CTI_WEBLOADER_SCANNED",
                "PUBLIC_WEB_INTEL",
                targetUri.getHost(),
                Map.of(
                        "ipv4Count", ipv4s.size(),
                        "domainCount", domains.size(),
                        "cveCount", cves.size(),
                        "knownMatchesCount", knownMatches.size()
                )
        );

        return new WebIntelScanResponse(
                targetUri.toString(),
                title,
                ipv4s,
                domains,
                cves,
                matchedLiveNet4,
                knownMatches,
                false,
                preview
        );
    }

    static URI parseAndValidatePublicUri(String rawUrl) {
        if (rawUrl == null || rawUrl.isBlank()) {
            throw new InvalidDocumentException("La URL del reporte público es obligatoria.");
        }
        String trimmed = rawUrl.trim();
        URI uri;
        try {
            uri = URI.create(trimmed);
        } catch (IllegalArgumentException ex) {
            throw new InvalidDocumentException("Formato de URL inválido.", ex);
        }

        String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase(Locale.ROOT) : "";
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            throw new InvalidDocumentException("Solo se permiten esquemas http:// o https://.");
        }
        if (uri.getRawUserInfo() != null) {
            throw new InvalidDocumentException("No se permiten credenciales embebidas en la URL.");
        }
        String host = uri.getHost();
        if (host == null || host.isBlank()) {
            throw new InvalidDocumentException("La URL no contiene un hostname válido.");
        }
        String lowerHost = host.toLowerCase(Locale.ROOT);
        if ("localhost".equals(lowerHost)
                || lowerHost.endsWith(".localhost")
                || lowerHost.endsWith(".local")
                || lowerHost.endsWith(".internal")) {
            throw new InvalidDocumentException("URL bloqueada por política anti-SSRF (destino interno/local).");
        }

        try {
            InetAddress[] resolved = InetAddress.getAllByName(host);
            if (resolved.length == 0) {
                throw new InvalidDocumentException("No se pudo resolver el dominio indicado.");
            }
            for (InetAddress addr : resolved) {
                if (!isPublicRoutableAddress(addr)) {
                    throw new InvalidDocumentException(
                            "URL bloqueada por política anti-SSRF: IP privada, loopback o reservada (" + host + ")."
                    );
                }
            }
        } catch (UnknownHostException ex) {
            throw new InvalidDocumentException("No se pudo resolver el host destino: " + host, ex);
        }
        return uri;
    }

    static boolean isPublicRoutableAddress(InetAddress addr) {
        if (addr == null
                || addr.isAnyLocalAddress()
                || addr.isLoopbackAddress()
                || addr.isLinkLocalAddress()
                || addr.isSiteLocalAddress()
                || addr.isMulticastAddress()) {
            return false;
        }
        byte[] bytes = addr.getAddress();
        if (bytes.length == 4) {
            int b0 = bytes[0] & 0xFF;
            int b1 = bytes[1] & 0xFF;
            int b2 = bytes[2] & 0xFF;
            if (b0 == 0 || b0 == 10 || b0 == 127) {
                return false;
            }
            if (b0 == 100 && (b1 & 0xC0) == 64) { // 100.64.0.0/10 CGNAT
                return false;
            }
            if (b0 == 169 && b1 == 254) { // link-local / cloud metadata
                return false;
            }
            if (b0 == 172 && b1 >= 16 && b1 <= 31) {
                return false;
            }
            if (b0 == 192 && ((b1 == 0 && b2 == 0) || (b1 == 0 && b2 == 2) || b1 == 168)) {
                return false;
            }
            if (b0 == 198 && (b1 == 18 || b1 == 19 || (b1 == 51 && b2 == 100))) {
                return false;
            }
            if (b0 == 203 && b1 == 0 && b2 == 113) {
                return false;
            }
            return b0 < 224;
        }
        if (bytes.length == 16) {
            int b0 = bytes[0] & 0xFF;
            // fc00::/7 Unique Local IPv6, fe80::/10 Link-Local, ff00::/8 Multicast
            if ((b0 & 0xFE) == 0xFC || b0 == 0xFF) {
                return false;
            }
        }
        return true;
    }

    private String fetchBoundedHtmlWithSafeRedirects(URI initialUri) {
        URI current = initialUri;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            HttpRequest request = HttpRequest.newBuilder(current)
                    .timeout(Duration.ofSeconds(12))
                    .header("User-Agent", "OMEGA-CTI-WebLoader/1.0 (+Zero-Retention)")
                    .header("Accept", "text/html, text/plain, application/xhtml+xml")
                    .GET()
                    .build();
            try {
                HttpResponse<InputStream> response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
                int status = response.statusCode();
                if (status >= 300 && status < 400) {
                    try (InputStream body = response.body()) {
                        body.close();
                    }
                    String location = response.headers().firstValue("Location").orElse("");
                    if (location.isBlank() || hop == MAX_REDIRECTS) {
                        throw new InvalidDocumentException("Demasiadas redirecciones al inspeccionar el artículo.");
                    }
                    current = parseAndValidatePublicUri(current.resolve(location).toString());
                    continue;
                }
                if (status < 200 || status >= 300) {
                    throw new InvalidDocumentException("El servidor remoto respondió HTTP " + status + ".");
                }
                try (InputStream is = response.body()) {
                    return readBoundedUtf8(is);
                }
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                throw new InvalidDocumentException("La descarga efímera fue interrumpida.", ex);
            } catch (IOException ex) {
                throw new InvalidDocumentException("No se pudo obtener el artículo remoto: " + ex.getMessage(), ex);
            }
        }
        throw new InvalidDocumentException("Límite de redirecciones excedido.");
    }

    private static String readBoundedUtf8(InputStream is) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.min(65536, MAX_DOWNLOAD_BYTES));
        byte[] buf = new byte[8192];
        int remaining = MAX_DOWNLOAD_BYTES;
        int n;
        while (remaining > 0 && (n = is.read(buf, 0, Math.min(buf.length, remaining))) != -1) {
            out.write(buf, 0, n);
            remaining -= n;
        }
        return out.toString(StandardCharsets.UTF_8);
    }

    private static String extractTitle(String html, String fallbackHost) {
        Matcher m = TITLE_PATTERN.matcher(html);
        if (m.find()) {
            String raw = WHITESPACE_PATTERN.matcher(HTML_TAG_PATTERN.matcher(m.group(1)).replaceAll(" ")).replaceAll(" ").trim();
            if (!raw.isBlank()) {
                return raw.length() > 180 ? raw.substring(0, 180) : raw;
            }
        }
        return fallbackHost;
    }

    private static String stripHtml(String html) {
        String noScripts = SCRIPT_STYLE_PATTERN.matcher(html).replaceAll(" ");
        String noTags = HTML_TAG_PATTERN.matcher(noScripts).replaceAll(" ");
        return WHITESPACE_PATTERN.matcher(noTags).replaceAll(" ").trim();
    }

    private static List<String> extractDistinctPublicIpv4s(String text) {
        Set<String> found = new LinkedHashSet<>();
        Matcher m = IPV4_PATTERN.matcher(text);
        while (m.find() && found.size() < 100) {
            String ip = m.group();
            try {
                InetAddress addr = InetAddress.getByName(ip);
                if (isPublicRoutableAddress(addr)) {
                    found.add(ip);
                }
            } catch (UnknownHostException ignored) {
                // skip malformed literal
            }
        }
        return new ArrayList<>(found);
    }

    private static List<String> extractDistinctDomains(String text, String articleHost) {
        Set<String> found = new LinkedHashSet<>();
        String lowerHost = articleHost != null ? articleHost.toLowerCase(Locale.ROOT) : "";
        Matcher m = DOMAIN_PATTERN.matcher(text);
        while (m.find() && found.size() < 150) {
            String domain = m.group().toLowerCase(Locale.ROOT);
            if (!domain.equals(lowerHost)) {
                found.add(domain);
            }
        }
        return new ArrayList<>(found);
    }

    private static List<String> extractDistinctCves(String text) {
        Set<String> found = new LinkedHashSet<>();
        Matcher m = CVE_PATTERN.matcher(text);
        while (m.find() && found.size() < 50) {
            found.add(m.group().toUpperCase(Locale.ROOT));
        }
        return new ArrayList<>(found);
    }

    public record WebIntelScanResponse(
            String url,
            String title,
            @JsonProperty("ipv4_iocs") List<String> ipv4Iocs,
            List<String> domains,
            List<String> cves,
            @JsonProperty("matched_live_net4") List<String> matchedLiveNet4,
            @JsonProperty("known_cti_matches") List<CtiMatchRecord> knownCtiMatches,
            @JsonProperty("persisted_to_db") boolean persistedToDb,
            @JsonProperty("chunks_preview") String chunksPreview
    ) {
    }
}
