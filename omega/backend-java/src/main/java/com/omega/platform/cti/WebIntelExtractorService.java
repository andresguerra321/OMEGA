package com.omega.platform.cti;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.omega.platform.cti.PublicSchemaSupport.CtiMatchRecord;
import com.omega.platform.ingest.InvalidDocumentException;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.IDN;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.Socket;
import java.net.URI;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;
import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Extractor efímero en RAM para analizar reportes CTI públicos por URL con protección estricta anti-SSRF
 * (bloqueo de localhost, RFC1918, CGNAT, link-local / metadata 169.254.169.254, redirecciones privadas
 * y conexión TCP fijada a la IP validada para mitigar DNS rebinding).
 */
@Service
public class WebIntelExtractorService {

    private static final int MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
    private static final int MAX_REDIRECTS = 3;
    private static final int CONNECT_TIMEOUT_MS = 8_000;
    private static final int READ_TIMEOUT_MS = 12_000;
    private static final int MAX_HEADER_LINE_BYTES = 8_192;
    private static final int MAX_RESPONSE_HEADERS = 128;

    private static final Pattern TITLE_PATTERN = Pattern.compile("<title[^>]*>(.*?)</title>",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern SCRIPT_STYLE_PATTERN = Pattern.compile("<(script|style|noscript)[^>]*>.*?</\\1>",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern HTML_TAG_PATTERN = Pattern.compile("<[^>]+>");
    private static final Pattern WHITESPACE_PATTERN = Pattern.compile("\\s+");
    private static final Pattern IPV4_PATTERN = Pattern
            .compile("\\b(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\b");
    private static final Pattern DOMAIN_PATTERN = Pattern.compile(
            "\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:com|net|org|io|info|biz|xyz|top|me|co|edu|gov|ru|cn|tk|cc|pw|club|online|site|app|dev|tech|onion)\\b",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern CVE_PATTERN = Pattern.compile("\\bCVE-\\d{4}-\\d{4,7}\\b", Pattern.CASE_INSENSITIVE);

    private final PublicSchemaSupport publicSchemaSupport;
    private final AuditLogService auditLogService;
    private final DnsResolver dnsResolver;
    private final Predicate<InetAddress> addressPolicy;
    private final SSLSocketFactory sslSocketFactory;

    @Autowired
    public WebIntelExtractorService(
            PublicSchemaSupport publicSchemaSupport,
            AuditLogService auditLogService) {
        this(
                publicSchemaSupport,
                auditLogService,
                InetAddress::getAllByName,
                WebIntelExtractorService::isPublicRoutableAddress,
                (SSLSocketFactory) SSLSocketFactory.getDefault()
        );
    }

    WebIntelExtractorService(
            PublicSchemaSupport publicSchemaSupport,
            AuditLogService auditLogService,
            DnsResolver dnsResolver,
            Predicate<InetAddress> addressPolicy,
            SSLSocketFactory sslSocketFactory
    ) {
        this.publicSchemaSupport = publicSchemaSupport;
        this.auditLogService = auditLogService;
        this.dnsResolver = dnsResolver;
        this.addressPolicy = addressPolicy;
        this.sslSocketFactory = sslSocketFactory;
    }

    @Transactional
    public WebIntelScanResponse scanUrlEphemerally(
            OmegaPrincipal principal,
            String rawUrl,
            List<String> activeNet4Ips) {
        ValidatedTarget target = parseAndValidatePublicTarget(rawUrl, dnsResolver, addressPolicy);
        String html = fetchBoundedHtmlWithSafeRedirects(target);

        String title = extractTitle(html, target.uri().getHost());
        String cleanText = stripHtml(html);

        List<String> ipv4s = extractDistinctPublicIpv4s(cleanText);
        List<String> domains = extractDistinctDomains(cleanText, target.uri().getHost());
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
        List<PublicSchemaSupport.CtiMatchRecord> knownMatches = publicSchemaSupport.matchKnownIocs(lookupCandidates,
                50);

        String preview = cleanText.length() > 420 ? cleanText.substring(0, 420) : cleanText;

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "CTI_WEBLOADER_SCANNED",
                "PUBLIC_WEB_INTEL",
                target.uri().getHost(),
                Map.of(
                        "ipv4Count", ipv4s.size(),
                        "domainCount", domains.size(),
                        "cveCount", cves.size(),
                        "knownMatchesCount", knownMatches.size()));

        return new WebIntelScanResponse(
                target.uri().toString(),
                title,
                ipv4s,
                domains,
                cves,
                matchedLiveNet4,
                knownMatches,
                false,
                preview);
    }

    static URI parseAndValidatePublicUri(String rawUrl) {
        return parseAndValidatePublicTarget(
                rawUrl,
                InetAddress::getAllByName,
                WebIntelExtractorService::isPublicRoutableAddress
        ).uri();
    }

    static ValidatedTarget parseAndValidatePublicTarget(
            String rawUrl,
            DnsResolver dnsResolver,
            Predicate<InetAddress> addressPolicy
    ) {
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
        String unbracketedHost = unbracketIpv6(host);
        String lowerHost = unbracketedHost.toLowerCase(Locale.ROOT);
        if ("localhost".equals(lowerHost)
                || lowerHost.endsWith(".localhost")
                || lowerHost.endsWith(".local")
                || lowerHost.endsWith(".internal")) {
            throw new InvalidDocumentException("URL bloqueada por política anti-SSRF (destino interno/local).");
        }

        InetAddress pinnedAddress = null;
        try {
            InetAddress[] resolved = dnsResolver.resolve(unbracketedHost);
            if (resolved == null || resolved.length == 0) {
                throw new InvalidDocumentException("No se pudo resolver el dominio indicado.");
            }
            for (InetAddress addr : resolved) {
                if (!addressPolicy.test(addr)) {
                    throw new InvalidDocumentException(
                            "URL bloqueada por política anti-SSRF: IP privada, loopback o reservada (" + host + ").");
                }
                if (pinnedAddress == null || (!(pinnedAddress instanceof Inet4Address) && addr instanceof Inet4Address)) {
                    pinnedAddress = addr;
                }
            }
        } catch (UnknownHostException ex) {
            throw new InvalidDocumentException("No se pudo resolver el host destino: " + host, ex);
        }
        return new ValidatedTarget(uri, pinnedAddress);
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

    private String fetchBoundedHtmlWithSafeRedirects(ValidatedTarget initialTarget) {
        ValidatedTarget current = initialTarget;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            try {
                PinnedHttpResponse response = executePinnedGet(current);
                int status = response.statusCode();
                if (status >= 300 && status < 400) {
                    String location = response.headers().getOrDefault("location", "");
                    if (location.isBlank() || hop == MAX_REDIRECTS) {
                        throw new InvalidDocumentException("Demasiadas redirecciones al inspeccionar el artículo.");
                    }
                    URI resolved = current.uri().resolve(location.trim());
                    current = parseAndValidatePublicTarget(resolved.toString(), dnsResolver, addressPolicy);
                    continue;
                }
                if (status < 200 || status >= 300) {
                    throw new InvalidDocumentException("El servidor remoto respondió HTTP " + status + ".");
                }
                return response.body();
            } catch (IOException ex) {
                throw new InvalidDocumentException("No se pudo obtener el artículo remoto: " + ex.getMessage(), ex);
            }
        }
        throw new InvalidDocumentException("Límite de redirecciones excedido.");
    }

    private PinnedHttpResponse executePinnedGet(ValidatedTarget target) throws IOException {
        URI uri = target.uri();
        String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
        boolean isHttps = "https".equals(scheme);
        int port = uri.getPort() != -1 ? uri.getPort() : (isHttps ? 443 : 80);

        String rawHost = uri.getHost();
        if (containsControlChars(rawHost)) {
            throw new InvalidDocumentException("Hostname inválido en la solicitud.");
        }
        String hostHeader = uri.getPort() != -1 ? rawHost + ":" + uri.getPort() : rawHost;
        String requestTarget = buildRequestTarget(uri);
        String peerHost = unbracketIpv6(rawHost);

        try (Socket socket = connectPinnedSocket(target.pinnedAddress(), peerHost, port, isHttps)) {
            OutputStream out = socket.getOutputStream();
            String rawRequest = "GET " + requestTarget + " HTTP/1.1\r\n"
                    + "Host: " + hostHeader + "\r\n"
                    + "User-Agent: OMEGA-CTI-WebLoader/1.0 (+Zero-Retention)\r\n"
                    + "Accept: text/html, text/plain, application/xhtml+xml\r\n"
                    + "Accept-Encoding: identity\r\n"
                    + "Connection: close\r\n\r\n";
            out.write(rawRequest.getBytes(StandardCharsets.US_ASCII));
            out.flush();

            BufferedInputStream in = new BufferedInputStream(socket.getInputStream(), 8192);
            return readHttpResponse(in);
        }
    }

    private Socket connectPinnedSocket(
            InetAddress pinnedAddress,
            String peerHost,
            int port,
            boolean isHttps
    ) throws IOException {
        Socket plain = new Socket(Proxy.NO_PROXY);
        try {
            plain.connect(new InetSocketAddress(pinnedAddress, port), CONNECT_TIMEOUT_MS);
            plain.setSoTimeout(READ_TIMEOUT_MS);
            if (!isHttps) {
                return plain;
            }
            SSLSocket ssl = (SSLSocket) sslSocketFactory.createSocket(plain, peerHost, port, true);
            ssl.setSoTimeout(READ_TIMEOUT_MS);
            configureTlsParameters(ssl, peerHost);
            ssl.startHandshake();
            return ssl;
        } catch (IOException | RuntimeException ex) {
            try {
                plain.close();
            } catch (IOException suppressed) {
                ex.addSuppressed(suppressed);
            }
            throw ex;
        }
    }

    static void configureTlsParameters(SSLSocket ssl, String peerHost) {
        SSLParameters params = ssl.getSSLParameters();
        params.setEndpointIdentificationAlgorithm("HTTPS");
        if (peerHost != null && !peerHost.isBlank() && !isIpLiteral(peerHost)) {
            String asciiHost = IDN.toASCII(peerHost);
            params.setServerNames(List.of(new SNIHostName(asciiHost)));
        }
        ssl.setSSLParameters(params);
    }

    private static PinnedHttpResponse readHttpResponse(BufferedInputStream in) throws IOException {
        String statusLine;
        Map<String, String> headers;
        int statusCode;
        while (true) {
            statusLine = readAsciiLine(in, MAX_HEADER_LINE_BYTES);
            if (statusLine == null) {
                throw new EOFException("Respuesta HTTP vacía del servidor remoto.");
            }
            statusCode = parseStatusCode(statusLine);
            headers = readHeaders(in);
            if (statusCode < 100 || statusCode >= 200 || statusCode == 101) {
                break;
            }
        }

        if (statusCode >= 300 && statusCode < 400) {
            return new PinnedHttpResponse(statusCode, headers, "");
        }

        byte[] rawBody = readBoundedBodyBytes(in, headers);
        String contentEncoding = headers.getOrDefault("content-encoding", "").toLowerCase(Locale.ROOT);
        if (contentEncoding.contains("gzip")) {
            rawBody = gunzipBounded(rawBody);
        }
        return new PinnedHttpResponse(statusCode, headers, new String(rawBody, StandardCharsets.UTF_8));
    }

    private static int parseStatusCode(String statusLine) throws IOException {
        if (!statusLine.startsWith("HTTP/")) {
            throw new IOException("Línea de estado HTTP inválida: " + statusLine);
        }
        int firstSpace = statusLine.indexOf(' ');
        if (firstSpace <= 0) {
            throw new IOException("Línea de estado HTTP malformada.");
        }
        String rest = statusLine.substring(firstSpace + 1).trim();
        int nextSpace = rest.indexOf(' ');
        String codeToken = nextSpace > 0 ? rest.substring(0, nextSpace) : rest;
        try {
            return Integer.parseInt(codeToken);
        } catch (NumberFormatException ex) {
            throw new IOException("Código HTTP inválido: " + codeToken, ex);
        }
    }

    private static Map<String, String> readHeaders(BufferedInputStream in) throws IOException {
        Map<String, String> headers = new LinkedHashMap<>();
        int count = 0;
        while (true) {
            String line = readAsciiLine(in, MAX_HEADER_LINE_BYTES);
            if (line == null || line.isEmpty()) {
                break;
            }
            count++;
            if (count > MAX_RESPONSE_HEADERS) {
                throw new IOException("Demasiadas cabeceras en la respuesta HTTP.");
            }
            int colon = line.indexOf(':');
            if (colon > 0) {
                String name = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
                String value = line.substring(colon + 1).trim();
                headers.putIfAbsent(name, value);
            }
        }
        return headers;
    }

    private static byte[] readBoundedBodyBytes(BufferedInputStream in, Map<String, String> headers)
            throws IOException {
        String transferEncoding = headers.getOrDefault("transfer-encoding", "").toLowerCase(Locale.ROOT);
        if (transferEncoding.contains("chunked")) {
            return readChunkedBounded(in);
        }
        String contentLengthHeader = headers.get("content-length");
        if (contentLengthHeader != null && !contentLengthHeader.isBlank()) {
            long declaredLength;
            try {
                declaredLength = Long.parseLong(contentLengthHeader.trim());
            } catch (NumberFormatException ex) {
                throw new IOException("Content-Length inválido en respuesta HTTP.", ex);
            }
            if (declaredLength < 0L) {
                throw new IOException("Content-Length negativo en respuesta HTTP.");
            }
            int targetBytes = (int) Math.min(declaredLength, MAX_DOWNLOAD_BYTES);
            return readExactlyUpTo(in, targetBytes);
        }
        return readBoundedBytes(in, MAX_DOWNLOAD_BYTES);
    }

    private static byte[] readChunkedBounded(BufferedInputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.min(65536, MAX_DOWNLOAD_BYTES));
        int remaining = MAX_DOWNLOAD_BYTES;
        byte[] buf = new byte[8192];
        while (remaining > 0) {
            String sizeLine = readAsciiLine(in, MAX_HEADER_LINE_BYTES);
            if (sizeLine == null) {
                break;
            }
            if (sizeLine.isEmpty()) {
                continue;
            }
            int semi = sizeLine.indexOf(';');
            String hex = (semi >= 0 ? sizeLine.substring(0, semi) : sizeLine).trim();
            int chunkSize;
            try {
                chunkSize = Integer.parseInt(hex, 16);
            } catch (NumberFormatException ex) {
                throw new IOException("Tamaño de chunk HTTP inválido: " + hex, ex);
            }
            if (chunkSize < 0) {
                throw new IOException("Tamaño de chunk HTTP negativo.");
            }
            if (chunkSize == 0) {
                break;
            }
            int toCopy = Math.min(chunkSize, remaining);
            int copied = 0;
            while (copied < toCopy) {
                int n = in.read(buf, 0, Math.min(buf.length, toCopy - copied));
                if (n == -1) {
                    return out.toByteArray();
                }
                out.write(buf, 0, n);
                copied += n;
                remaining -= n;
            }
            if (remaining == 0) {
                break;
            }
            // Consumir \r\n de fin de chunk antes del siguiente chunk
            consumeChunkTerminator(in);
        }
        return out.toByteArray();
    }

    private static void consumeChunkTerminator(BufferedInputStream in) throws IOException {
        int b = in.read();
        if (b == '\r') {
            in.mark(1);
            int next = in.read();
            if (next != '\n' && next != -1) {
                in.reset();
            }
        }
    }

    private static byte[] readExactlyUpTo(InputStream is, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.min(65536, Math.max(256, limit)));
        byte[] buf = new byte[8192];
        int remaining = limit;
        int n;
        while (remaining > 0 && (n = is.read(buf, 0, Math.min(buf.length, remaining))) != -1) {
            out.write(buf, 0, n);
            remaining -= n;
        }
        return out.toByteArray();
    }

    private static byte[] readBoundedBytes(InputStream is, int maxBytes) throws IOException {
        return readExactlyUpTo(is, maxBytes);
    }

    private static byte[] gunzipBounded(byte[] compressed) throws IOException {
        try (GZIPInputStream gzip = new GZIPInputStream(new ByteArrayInputStream(compressed))) {
            return readBoundedBytes(gzip, MAX_DOWNLOAD_BYTES);
        }
    }

    private static String readAsciiLine(InputStream in, int maxBytes) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream(128);
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\n') {
                break;
            }
            if (b != '\r') {
                if (line.size() >= maxBytes) {
                    throw new IOException("Línea de cabecera HTTP excede el límite permitido.");
                }
                line.write(b);
            }
        }
        if (b == -1 && line.size() == 0) {
            return null;
        }
        return line.toString(StandardCharsets.US_ASCII);
    }

    private static String buildRequestTarget(URI uri) {
        String rawPath = uri.getRawPath();
        String path = (rawPath == null || rawPath.isEmpty()) ? "/" : rawPath;
        String rawQuery = uri.getRawQuery();
        String target = rawQuery != null ? (path + "?" + rawQuery) : path;
        if (containsControlChars(target)) {
            throw new InvalidDocumentException("Ruta URL inválida en la solicitud.");
        }
        return target;
    }

    private static boolean containsControlChars(String value) {
        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            if (ch == '\r' || ch == '\n' || ch < 0x20 || ch == 0x7F) {
                return true;
            }
        }
        return false;
    }

    private static String unbracketIpv6(String host) {
        if (host.startsWith("[") && host.endsWith("]") && host.length() > 2) {
            return host.substring(1, host.length() - 1);
        }
        return host;
    }

    private static boolean isIpLiteral(String host) {
        return host.indexOf(':') >= 0 || host.matches("^(?:\\d{1,3}\\.){3}\\d{1,3}$");
    }

    @FunctionalInterface
    interface DnsResolver {
        InetAddress[] resolve(String host) throws UnknownHostException;
    }

    record ValidatedTarget(URI uri, InetAddress pinnedAddress) {
    }

    private record PinnedHttpResponse(int statusCode, Map<String, String> headers, String body) {
    }

    private static String extractTitle(String html, String fallbackHost) {
        Matcher m = TITLE_PATTERN.matcher(html);
        if (m.find()) {
            String raw = WHITESPACE_PATTERN.matcher(HTML_TAG_PATTERN.matcher(m.group(1)).replaceAll(" "))
                    .replaceAll(" ").trim();
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
            @JsonProperty("chunks_preview") String chunksPreview) {
    }
}
