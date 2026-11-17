package com.omega.platform.service;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.cti.PublicSchemaSupport;
import com.omega.platform.cti.PublicSchemaSupport.CtiMatchRecord;
import com.omega.platform.domain.OsintMonitoredAssetEntity;
import com.omega.platform.ingest.InvalidDocumentException;
import com.omega.platform.repository.OsintAssetRepository;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.web.ValidationPatterns;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Hashtable;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import javax.naming.Context;
import javax.naming.NamingEnumeration;
import javax.naming.directory.Attribute;
import javax.naming.directory.Attributes;
import javax.naming.directory.DirContext;
import javax.naming.directory.InitialDirContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Auditoría pasiva de exposición OSINT con aislamiento estricto por `(tenantId, userId)`
 * y validación obligatoria de consentimiento explícito.
 */
@Service
public class OsintExposureService {
    @Value("${omega.ai.provider:openai}")
    private String aiProvider = "openai";

    private static final Logger log = LoggerFactory.getLogger(OsintExposureService.class);
    private static final Pattern DOMAIN_PATTERN =
            Pattern.compile(ValidationPatterns.STRICT_DOMAIN_LOWER_REGEX);
    private static final Pattern EMAIL_PATTERN =
            Pattern.compile(ValidationPatterns.STRICT_EMAIL_LOWER_REGEX);
    private static final Pattern ORG_PATTERN =
            Pattern.compile(ValidationPatterns.ORGANIZATION_NAME_REGEX);
    private static final int MAX_CT_BYTES = 512 * 1024;

    private final OsintAssetRepository assetRepository;
    private final PublicSchemaSupport publicSchemaSupport;
    private final AuditLogService auditLogService;
    private final ObjectMapper objectMapper;
    private final boolean externalLookupsEnabled;
    private final String hibpApiKey;
    private final HttpClient httpClient;

    public OsintExposureService(
            OsintAssetRepository assetRepository,
            PublicSchemaSupport publicSchemaSupport,
            AuditLogService auditLogService,
            ObjectMapper objectMapper,
            boolean externalLookupsEnabled
    ) {
        this(assetRepository, publicSchemaSupport, auditLogService, objectMapper, externalLookupsEnabled, "");
    }

    @Autowired
    public OsintExposureService(
            OsintAssetRepository assetRepository,
            PublicSchemaSupport publicSchemaSupport,
            AuditLogService auditLogService,
            ObjectMapper objectMapper,
            @Value("${omega.osint.external-lookups-enabled:true}") boolean externalLookupsEnabled,
            @Value("${HIBP_API_KEY:}") String hibpApiKey
    ) {
        this.assetRepository = assetRepository;
        this.publicSchemaSupport = publicSchemaSupport;
        this.auditLogService = auditLogService;
        this.objectMapper = objectMapper;
        this.externalLookupsEnabled = externalLookupsEnabled;
        this.hibpApiKey = hibpApiKey == null ? "" : hibpApiKey.trim();
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(4))
                .build();
    }

    @Transactional(readOnly = true)
    public AssetListResponse listAssets(OmegaPrincipal principal) {
        List<AssetDto> items = assetRepository
                .findAllByTenantIdAndUserIdOrderByConsentedAtDesc(principal.tenantId(), principal.userId())
                .stream()
                .map(AssetDto::fromEntity)
                .toList();
        return new AssetListResponse(items);
    }

    @Transactional
    public AssetDto registerAsset(OmegaPrincipal principal, String assetType, String rawValue, boolean explicitConsent) {
        if (!explicitConsent) {
            throw new InvalidDocumentException(
                    "Se requiere consentimiento explícito del titular antes de monitorear cualquier activo."
            );
        }

        String normalizedType = assetType != null ? assetType.trim().toLowerCase(Locale.ROOT) : "";
        String normalizedValue = rawValue != null ? rawValue.trim().toLowerCase(Locale.ROOT) : "";

        validateAssetInput(normalizedType, normalizedValue);

        if (assetRepository.existsByTenantIdAndUserIdAndAssetValue(principal.tenantId(), principal.userId(), normalizedValue)) {
            throw new ConflictException("Este activo ya se encuentra registrado para tu sesión.");
        }

        OsintMonitoredAssetEntity entity = new OsintMonitoredAssetEntity(
                principal.tenantId(),
                principal.userId(),
                normalizedType,
                normalizedValue,
                true
        );
        OsintMonitoredAssetEntity saved = assetRepository.save(entity);

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "OSINT_ASSET_REGISTERED",
                "OSINT_ASSET",
                saved.getId().toString(),
                Map.of("assetType", normalizedType, "explicitConsent", true)
        );
        return AssetDto.fromEntity(saved);
    }

    @Transactional
    public OsintScanReport scanAsset(OmegaPrincipal principal, UUID assetId) {
        if ("ollama".equals(aiProvider)) throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "OSINT externo deshabilitado en Modo Soberano Local.");
        OsintMonitoredAssetEntity asset = assetRepository
                .findByIdAndTenantIdAndUserId(assetId, principal.tenantId(), principal.userId())
                .orElseThrow(() -> new ResourceNotFoundException("Activo OSINT no encontrado: " + assetId));

        String value = asset.getAssetValue();
        String domain = resolveDomain(asset.getAssetType(), value);

        List<String> iocCandidates = new ArrayList<>();
        iocCandidates.add(value);
        if (domain != null && !domain.equals(value)) {
            iocCandidates.add(domain);
        }
        List<CtiMatchRecord> ctiMatches = publicSchemaSupport.matchKnownIocs(iocCandidates, 40);

        DnsPostureDto dnsPosture = (domain != null && externalLookupsEnabled)
                ? inspectPassiveDns(domain)
                : new DnsPostureDto(domain, false, null, false, null);

        List<String> exposedSubdomains = (domain != null && externalLookupsEnabled)
                ? fetchCrtShSubdomains(domain)
                : List.of();

        EmailBreachesDto emailBreaches = "institutional_email".equals(asset.getAssetType())
                ? checkHibpEmailBreaches(value)
                : null;

        Instant checkedAt = Instant.now();
        asset.markChecked(checkedAt);
        assetRepository.save(asset);

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "OSINT_ASSET_SCANNED",
                "OSINT_ASSET",
                asset.getId().toString(),
                Map.of(
                        "assetType", asset.getAssetType(),
                        "ctiMatchesCount", ctiMatches.size(),
                        "subdomainsCount", exposedSubdomains.size()
                )
        );

        return new OsintScanReport(
                asset.getId(),
                asset.getAssetType(),
                value,
                checkedAt.toString(),
                ctiMatches,
                emailBreaches,
                dnsPosture,
                exposedSubdomains
        );
    }

    @Transactional
    public Map<String, Object> revokeAsset(OmegaPrincipal principal, UUID assetId) {
        OsintMonitoredAssetEntity asset = assetRepository
                .findByIdAndTenantIdAndUserId(assetId, principal.tenantId(), principal.userId())
                .orElseThrow(() -> new ResourceNotFoundException("Activo OSINT no encontrado: " + assetId));

        assetRepository.delete(asset);

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "OSINT_ASSET_REVOKED",
                "OSINT_ASSET",
                assetId.toString(),
                Map.of("assetType", asset.getAssetType())
        );

        return Map.of("status", "revoked", "id", assetId.toString());
    }

    private static void validateAssetInput(String type, String value) {
        if (value.isBlank() || value.length() > 255) {
            throw new InvalidDocumentException("Valor de activo inválido.");
        }
        switch (type) {
            case "domain" -> {
                if (!DOMAIN_PATTERN.matcher(value).matches()) {
                    throw new InvalidDocumentException("Formato de dominio inválido.");
                }
            }
            case "institutional_email" -> {
                if (!EMAIL_PATTERN.matcher(value).matches()) {
                    throw new InvalidDocumentException("Formato de correo electrónico inválido.");
                }
            }
            case "organization" -> {
                if (!ORG_PATTERN.matcher(value).matches()) {
                    throw new InvalidDocumentException("Ingresa un nombre de organización válido (al menos 2 letras, sin símbolos especiales).");
                }
            }
            default -> throw new InvalidDocumentException(
                    "Tipo de activo inválido. Usa 'domain', 'institutional_email' u 'organization'."
            );
        }
    }

    private static String resolveDomain(String assetType, String assetValue) {
        if ("domain".equals(assetType)) {
            return assetValue;
        }
        if ("institutional_email".equals(assetType)) {
            int at = assetValue.indexOf('@');
            if (at > 0 && at + 1 < assetValue.length()) {
                return assetValue.substring(at + 1);
            }
        }
        return null;
    }

    private DnsPostureDto inspectPassiveDns(String domain) {
        List<String> rootTxts = lookupTxtRecords(domain);
        String spf = rootTxts.stream()
                .filter(t -> t.toLowerCase(Locale.ROOT).contains("v=spf1"))
                .findFirst()
                .orElse(null);

        List<String> dmarcTxts = lookupTxtRecords("_dmarc." + domain);
        String dmarc = dmarcTxts.stream()
                .filter(t -> t.toLowerCase(Locale.ROOT).contains("v=dmarc1"))
                .findFirst()
                .orElse(null);

        return new DnsPostureDto(domain, spf != null, spf, dmarc != null, dmarc);
    }

    private List<String> lookupTxtRecords(String host) {
        List<String> records = new ArrayList<>();
        Hashtable<String, String> env = new Hashtable<>();
        env.put(Context.INITIAL_CONTEXT_FACTORY, "com.sun.jndi.dns.DnsContextFactory");
        env.put(Context.PROVIDER_URL, "dns:");
        env.put("com.sun.jndi.dns.timeout.initial", "2500");
        env.put("com.sun.jndi.dns.timeout.retries", "1");
        DirContext ctx = null;
        try {
            ctx = new InitialDirContext(env);
            Attributes attrs = ctx.getAttributes(host, new String[]{"TXT"});
            Attribute txtAttr = attrs.get("TXT");
            if (txtAttr != null) {
                NamingEnumeration<?> all = txtAttr.getAll();
                while (all.hasMore()) {
                    Object val = all.next();
                    if (val != null) {
                        records.add(val.toString().replace("\"", "").trim());
                    }
                }
            }
        } catch (Exception ex) {
            log.debug("Consulta pasiva DNS TXT omitida para {}: {}", host, ex.getMessage());
        } finally {
            if (ctx != null) {
                try {
                    ctx.close();
                } catch (Exception ignored) {
                    // ignore cleanup failure
                }
            }
        }
        return records;
    }

    private List<String> fetchCrtShSubdomains(String domain) {
        Set<String> subdomains = new LinkedHashSet<>();
        try {
            String encoded = URLEncoder.encode("%." + domain, StandardCharsets.UTF_8);
            HttpRequest req = HttpRequest.newBuilder(URI.create("https://crt.sh/?q=" + encoded + "&output=json"))
                    .timeout(Duration.ofSeconds(5))
                    .header("User-Agent", "OMEGA-OSINT-Passive/1.0")
                    .header("Accept", "application/json")
                    .GET()
                    .build();
            HttpResponse<InputStream> res = httpClient.send(req, HttpResponse.BodyHandlers.ofInputStream());
            if (res.statusCode() < 200 || res.statusCode() >= 300) {
                try (InputStream body = res.body()) {
                    if (body != null && body.available() > 0) {
                        log.debug("crt.sh respondió HTTP {} ({} bytes en buffer)", res.statusCode(), body.available());
                    }
                }
                return List.of();
            }
            String json;
            try (InputStream is = res.body()) {
                json = readBoundedJson(is);
            }
            List<Map<String, Object>> entries = objectMapper.readValue(json, new TypeReference<>() {});
            for (Map<String, Object> entry : entries) {
                Object nameVal = entry.get("name_value");
                if (nameVal == null) {
                    continue;
                }
                for (String line : nameVal.toString().split("\\R")) {
                    String candidate = line.trim().toLowerCase(Locale.ROOT);
                    if (candidate.startsWith("*.")) {
                        candidate = candidate.substring(2);
                    }
                    if (!candidate.isBlank()
                            && !candidate.equals(domain)
                            && candidate.endsWith("." + domain)) {
                        subdomains.add(candidate);
                        if (subdomains.size() >= 30) {
                            return new ArrayList<>(subdomains);
                        }
                    }
                }
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        } catch (Exception ex) {
            log.debug("Consulta pasiva crt.sh omitida para {}: {}", domain, ex.getMessage());
        }

        if (subdomains.isEmpty()) {
            fetchHackerTargetSubdomains(domain, subdomains);
        }
        return new ArrayList<>(subdomains);
    }

    private void fetchHackerTargetSubdomains(String domain, Set<String> subdomains) {
        try {
            String encoded = URLEncoder.encode(domain, StandardCharsets.UTF_8);
            HttpRequest req = HttpRequest.newBuilder(URI.create("https://api.hackertarget.com/hostsearch/?q=" + encoded))
                    .timeout(Duration.ofSeconds(4))
                    .header("User-Agent", "OMEGA-OSINT-Passive/1.0")
                    .GET()
                    .build();
            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 200 && res.body() != null) {
                for (String line : res.body().split("\\R")) {
                    int comma = line.indexOf(',');
                    if (comma <= 0) continue;
                    String candidate = line.substring(0, comma).trim().toLowerCase(Locale.ROOT);
                    if (!candidate.isBlank()
                            && !candidate.equals(domain)
                            && candidate.endsWith("." + domain)) {
                        subdomains.add(candidate);
                        if (subdomains.size() >= 30) {
                            return;
                        }
                    }
                }
            }
        } catch (Exception ex) {
            log.debug("Fallback HackerTarget omitido para {}: {}", domain, ex.getMessage());
        }
    }

    private static String readBoundedJson(InputStream is) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(8192);
        byte[] buf = new byte[4096];
        int remaining = MAX_CT_BYTES;
        int n;
        while (remaining > 0 && (n = is.read(buf, 0, Math.min(buf.length, remaining))) != -1) {
            out.write(buf, 0, n);
            remaining -= n;
        }
        return out.toString(StandardCharsets.UTF_8);
    }

    public record AssetListResponse(List<AssetDto> assets) {
    }

    public record AssetDto(
            UUID id,
            @JsonProperty("asset_type") String assetType,
            @JsonProperty("asset_value") String assetValue,
            @JsonProperty("explicit_consent") boolean explicitConsent,
            @JsonProperty("consented_at") Instant consentedAt,
            @JsonProperty("last_checked_at") Instant lastCheckedAt
    ) {
        static AssetDto fromEntity(OsintMonitoredAssetEntity e) {
            return new AssetDto(
                    e.getId(),
                    e.getAssetType(),
                    e.getAssetValue(),
                    e.isExplicitConsent(),
                    e.getConsentedAt(),
                    e.getLastCheckedAt()
            );
        }
    }

    private EmailBreachesDto checkHibpEmailBreaches(String email) {
        if (!externalLookupsEnabled) {
            return new EmailBreachesDto(
                    "unavailable",
                    List.of(),
                    "Consultas OSINT externas desactivadas en este entorno."
            );
        }
        if (hibpApiKey.isBlank()) {
            return new EmailBreachesDto(
                    "unconfigured",
                    List.of(),
                    "Consulta de brechas por correo no disponible sin HIBP_API_KEY (servicio de pago en haveibeenpwned.com). El dominio asociado sí se evalúa gratis por DNS (SPF/DMARC) y Certificate Transparency (crt.sh)."
            );
        }

        try {
            String encodedEmail = URLEncoder.encode(email, StandardCharsets.UTF_8);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create("https://haveibeenpwned.com/api/v3/breachedaccount/" + encodedEmail + "?truncateResponse=false"))
                    .timeout(Duration.ofSeconds(6))
                    .header("hibp-api-key", hibpApiKey)
                    .header("user-agent", "OMEGA-CTI-Platform/1.6")
                    .header("Accept", "application/json")
                    .GET()
                    .build();

            HttpResponse<InputStream> response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
            int status = response.statusCode();
            if (status == 404) {
                return new EmailBreachesDto(
                        "clean",
                        List.of(),
                        "No se encontraron filtraciones públicas registradas para este correo en Have I Been Pwned."
                );
            }
            if (status == 401 || status == 403) {
                return new EmailBreachesDto(
                        "unavailable",
                        List.of(),
                        "HIBP_API_KEY rechazada o sin suscripción activa (HTTP " + status + ")."
                );
            }
            if (status == 429) {
                return new EmailBreachesDto(
                        "unavailable",
                        List.of(),
                        "Límite de tasa de Have I Been Pwned alcanzado (HTTP 429). Intenta de nuevo en unos segundos."
                );
            }
            if (status != 200) {
                return new EmailBreachesDto(
                        "unavailable",
                        List.of(),
                        "Respuesta inesperada de Have I Been Pwned (HTTP " + status + ")."
                );
            }

            String raw;
            try (InputStream body = response.body()) {
                raw = readBoundedJson(body);
            }
            List<Map<String, Object>> parsed = objectMapper.readValue(
                    raw,
                    new TypeReference<List<Map<String, Object>>>() {
                    }
            );
            List<Map<String, Object>> breaches = parsed == null ? List.of() : parsed.stream()
                    .limit(25)
                    .map(b -> Map.<String, Object>of(
                            "name", String.valueOf(b.getOrDefault("Name", "")),
                            "domain", String.valueOf(b.getOrDefault("Domain", "")),
                            "breach_date", String.valueOf(b.getOrDefault("BreachDate", "")),
                            "pwn_count", b.getOrDefault("PwnCount", 0),
                            "data_classes", b.getOrDefault("DataClasses", List.of()),
                            "is_verified", Boolean.TRUE.equals(b.get("IsVerified"))
                    ))
                    .toList();

            if (breaches.isEmpty()) {
                return new EmailBreachesDto(
                        "clean",
                        List.of(),
                        "No se encontraron filtraciones públicas registradas para este correo en Have I Been Pwned."
                );
            }
            return new EmailBreachesDto(
                    "exposed",
                    breaches,
                    "Se detectaron " + breaches.size() + " filtración(es) pública(s) en Have I Been Pwned."
            );
        } catch (Exception ex) {
            log.warn("Error consultando Have I Been Pwned para activo OSINT: {}", ex.getMessage());
            return new EmailBreachesDto(
                    "unavailable",
                    List.of(),
                    "No se pudo completar la consulta a Have I Been Pwned."
            );
        }
    }

    public record DnsPostureDto(
            String domain,
            @JsonProperty("spf_configured") boolean spfConfigured,
            @JsonProperty("spf_record") String spfRecord,
            @JsonProperty("dmarc_configured") boolean dmarcConfigured,
            @JsonProperty("dmarc_record") String dmarcRecord
    ) {
    }

    public record EmailBreachesDto(
            String status,
            List<Map<String, Object>> breaches,
            String message
    ) {
    }

    public record OsintScanReport(
            @JsonProperty("asset_id") UUID assetId,
            @JsonProperty("asset_type") String assetType,
            @JsonProperty("asset_value") String assetValue,
            @JsonProperty("scanned_at") String scannedAt,
            @JsonProperty("cti_ioc_matches") List<CtiMatchRecord> ctiIocMatches,
            @JsonProperty("email_breaches") EmailBreachesDto emailBreaches,
            @JsonProperty("dns_posture") DnsPostureDto dnsPosture,
            @JsonProperty("exposed_subdomains") List<String> exposedSubdomains
    ) {
    }
}
