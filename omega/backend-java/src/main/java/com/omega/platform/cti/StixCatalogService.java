package com.omega.platform.cti;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.domain.CampaignEntity;
import com.omega.platform.domain.IocIndicatorEntity;
import com.omega.platform.repository.CampaignRepository;
import com.omega.platform.repository.IocIndicatorRepository;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ingestor nativo de bundles STIX 2.1 (`.stix2`) hacia `omega_rag.campaigns` e `omega_rag.ioc_indicators`.
 * Consolida el catálogo CTI bajo autoridad de PostgreSQL sin depender de scripts Python legacy.
 */
@Service
public class StixCatalogService {

    private static final Logger log = LoggerFactory.getLogger(StixCatalogService.class);
    private static final Pattern STIX_PATTERN = Pattern.compile("\\[\\s*([a-z0-9\\-.:']+?)\\s*=\\s*'([^']+)'\\s*]", Pattern.CASE_INSENSITIVE);
    private static final Pattern IPV4_PATTERN = Pattern.compile("^(?:\\d{1,3}\\.){3}\\d{1,3}$");

    private static final String UPSERT_IOC_SQL = """
            INSERT INTO omega_rag.ioc_indicators
                (id, campaign_id, external_stix_id, ioc_type, ioc_value, normalized_value, stix_pattern, context, source_report, organization, source_url, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON CONFLICT (ioc_type, normalized_value)
            DO UPDATE SET
                campaign_id = COALESCE(omega_rag.ioc_indicators.campaign_id, EXCLUDED.campaign_id),
                source_report = COALESCE(omega_rag.ioc_indicators.source_report, EXCLUDED.source_report)
            """;

    private final ObjectMapper objectMapper;
    private final CampaignRepository campaignRepository;
    private final IocIndicatorRepository indicatorRepository;
    private final JdbcTemplate jdbcTemplate;
    private final OmegaProperties properties;

    public StixCatalogService(
            ObjectMapper objectMapper,
            CampaignRepository campaignRepository,
            IocIndicatorRepository indicatorRepository,
            JdbcTemplate jdbcTemplate,
            OmegaProperties properties
    ) {
        this.objectMapper = objectMapper;
        this.campaignRepository = campaignRepository;
        this.indicatorRepository = indicatorRepository;
        this.jdbcTemplate = jdbcTemplate;
        this.properties = properties;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void seedCorpusIfEmpty() {
        try {
            if (indicatorRepository.count() > 0) {
                return;
            }
            Path resolved = resolveCorpusDirectory();
            if (resolved != null) {
                StixSyncSummary summary = syncDirectory(resolved);
                log.info("Bootstrap STIX 2.1 completado: archivos={}, indicadores={}", summary.filesScanned(), summary.indicatorsParsed());
            }
        } catch (Exception ex) {
            log.warn("Omitido bootstrap STIX automático al iniciar: {}", ex.getMessage());
        }
    }

    @Transactional
    public StixSyncSummary syncConfiguredDirectory() {
        Path dir = resolveCorpusDirectory();
        if (dir == null) {
            return new StixSyncSummary(0, 0, 0, indicatorRepository.count(), "No se encontró el directorio de corpus STIX 2.1");
        }
        return syncDirectory(dir);
    }

    @Transactional
    public StixSyncSummary syncDirectory(Path corpusDir) {
        if (corpusDir == null || !Files.isDirectory(corpusDir)) {
            return new StixSyncSummary(0, 0, 0, indicatorRepository.count(), "Directorio STIX inexistente");
        }

        List<Path> files;
        try (Stream<Path> walk = Files.list(corpusDir)) {
            files = walk.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".stix2"))
                    .sorted()
                    .toList();
        } catch (IOException ex) {
            throw new IllegalStateException("Error listando bundles STIX 2.1 en " + corpusDir, ex);
        }

        Map<String, ManifestBundleMeta> verifiedMeta = verifyManifestAndBundles(corpusDir, files);

        int parsedTotal = 0;
        long beforeCount = indicatorRepository.count();

        for (Path file : files) {
            ManifestBundleMeta meta = verifiedMeta.get(file.getFileName().toString());
            parsedTotal += ingestBundleFile(file, meta);
        }

        long afterCount = indicatorRepository.count();
        long insertedNet = Math.max(0, afterCount - beforeCount);
        return new StixSyncSummary(files.size(), parsedTotal, insertedNet, afterCount, "Sincronización STIX 2.1 verificada y completada");
    }

    @Transactional(readOnly = true)
    public CatalogFreshnessDto getCatalogFreshness() {
        String cutoffDate = "2024-12-16";
        String updatePolicy = "pr_reviewed_only";
        int verifiedCount = 0;
        boolean manifestVerified = false;

        Path dir = resolveCorpusDirectory();
        if (dir != null) {
            Path manifestPath = dir.resolve("stix_manifest.json");
            if (Files.isRegularFile(manifestPath)) {
                try {
                    JsonNode root = objectMapper.readTree(manifestPath.toFile());
                    String manifestCutoff = root.path("catalog_cutoff_date").asText("");
                    if (!manifestCutoff.isBlank()) {
                        cutoffDate = manifestCutoff;
                    }
                    String policy = root.path("update_policy").asText("");
                    if (!policy.isBlank()) {
                        updatePolicy = policy;
                    }
                    JsonNode bundles = root.path("bundles");
                    if (bundles.isArray()) {
                        verifiedCount = bundles.size();
                    }
                    manifestVerified = true;
                } catch (IOException ex) {
                    log.warn("No se pudo leer stix_manifest.json para frescura CTI: {}", ex.getMessage());
                }
            }
        }

        String latestCampaignDate = cutoffDate;
        try {
            String dbMaxDate = jdbcTemplate.queryForObject(
                    "SELECT TO_CHAR(MAX(COALESCE(first_seen_at::date, created_at::date)), 'YYYY-MM-DD') FROM omega_rag.campaigns",
                    String.class
            );
            if (dbMaxDate != null && !dbMaxDate.isBlank() && dbMaxDate.compareTo(latestCampaignDate) > 0) {
                latestCampaignDate = dbMaxDate;
            }
        } catch (Exception ex) {
            log.debug("Consulta de fecha máxima en omega_rag.campaigns omitida: {}", ex.getMessage());
        }

        if (cutoffDate == null || cutoffDate.isBlank()) {
            cutoffDate = latestCampaignDate;
        }
        return new CatalogFreshnessDto(
                cutoffDate,
                latestCampaignDate,
                verifiedCount,
                updatePolicy,
                manifestVerified
        );
    }

    @Transactional(readOnly = true)
    public List<CampaignEntity> listCampaigns() {
        return campaignRepository.findAllByOrderByCreatedAtDesc();
    }

    @Transactional(readOnly = true)
    public List<com.omega.platform.integration.forensic.ForensicWorkerContracts.HostIndicator> hostIndicators() {
        var rows = indicatorRepository.findAll(org.springframework.data.domain.PageRequest.of(0, 200001));
        if (rows.getTotalElements() > 200000) {
            throw new IllegalStateException("El catálogo excede el límite del sensor de equipo");
        }
        return rows.getContent().stream()
                .map(i -> new com.omega.platform.integration.forensic.ForensicWorkerContracts.HostIndicator(
                        i.getIocType(), i.getNormalizedValue(), i.getSourceUrl() == null ? "" : i.getSourceUrl()))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<IocIndicatorEntity> lookupIndicator(String value) {
        if (value == null || value.isBlank()) {
            return List.of();
        }
        return indicatorRepository.findAllByNormalizedValue(value.trim().toLowerCase(Locale.ROOT));
    }

    private int ingestBundleFile(Path stixFile, ManifestBundleMeta manifestMeta) {
        JsonNode root;
        try {
            root = objectMapper.readTree(stixFile.toFile());
        } catch (IOException ex) {
            throw new IllegalStateException("Bundle STIX 2.1 ilegible: " + stixFile.getFileName(), ex);
        }

        JsonNode objects = root.path("objects");
        if (!objects.isArray()) {
            return 0;
        }

        String filename = stixFile.getFileName().toString();
        String sourceOrg = (manifestMeta != null && manifestMeta.organization() != null && !manifestMeta.organization().isBlank())
                ? manifestMeta.organization()
                : "Amnesty Tech / OMEGA CTI";
        String sourceUrl = (manifestMeta != null && manifestMeta.sourceUrl() != null && !manifestMeta.sourceUrl().isBlank())
                ? manifestMeta.sourceUrl()
                : "https://github.com/AmnestyTech/investigations";
        Map<String, UUID> malwareToCampaignId = new HashMap<>();
        Map<String, String> indicatorToMalwareRef = new HashMap<>();
        List<JsonNode> indicatorNodes = new ArrayList<>();

        for (JsonNode obj : objects) {
            String type = obj.path("type").asText("");
            if ("malware".equals(type)) {
                CampaignEntity camp = upsertCampaignFromMalware(obj, filename);
                malwareToCampaignId.put(obj.path("id").asText(""), camp.getId());
            } else if ("relationship".equals(type) && "indicates".equals(obj.path("relationship_type").asText(""))) {
                indicatorToMalwareRef.put(obj.path("source_ref").asText(""), obj.path("target_ref").asText(""));
            } else if ("indicator".equals(type)) {
                indicatorNodes.add(obj);
            }
        }

        UUID fallbackCampaignId = malwareToCampaignId.values().stream().findFirst().orElseGet(() ->
                ensureFallbackCampaign(filename).getId()
        );

        Map<String, ParsedIndicatorRow> uniqueBatch = new LinkedHashMap<>();
        for (JsonNode ind : indicatorNodes) {
            String pattern = ind.path("pattern").asText("");
            ParsedPattern parsed = parseStixPattern(pattern);
            if (parsed == null) {
                continue;
            }
            String stixId = ind.path("id").asText("");
            UUID campId = malwareToCampaignId.getOrDefault(indicatorToMalwareRef.get(stixId), fallbackCampaignId);
            String desc = ind.path("description").asText("");
            if (desc.isBlank()) {
                desc = "Indicador STIX 2.1 (" + filename + ")";
            }
            String key = parsed.iocType() + "|" + parsed.normalizedValue();
            uniqueBatch.putIfAbsent(key, new ParsedIndicatorRow(
                    campId,
                    stixId,
                    parsed.iocType(),
                    parsed.iocValue(),
                    parsed.normalizedValue(),
                    pattern,
                    desc,
                    filename,
                    sourceOrg,
                    sourceUrl
            ));
        }

        if (!uniqueBatch.isEmpty()) {
            List<ParsedIndicatorRow> rows = new ArrayList<>(uniqueBatch.values());
            jdbcTemplate.batchUpdate(
                    UPSERT_IOC_SQL,
                    rows,
                    250,
                    (ps, row) -> {
                        ps.setObject(1, UUID.randomUUID());
                        ps.setObject(2, row.campaignId());
                        ps.setString(3, row.externalStixId());
                        ps.setString(4, row.iocType());
                        ps.setString(5, row.iocValue());
                        ps.setString(6, row.normalizedValue());
                        ps.setString(7, row.stixPattern());
                        ps.setString(8, row.context());
                        ps.setString(9, row.sourceReport());
                        ps.setString(10, row.organization());
                        ps.setString(11, row.sourceUrl());
                    }
            );
        }
        return uniqueBatch.size();
    }

    private CampaignEntity upsertCampaignFromMalware(JsonNode malwareNode, String filename) {
        String stixId = malwareNode.path("id").asText("");
        if (!stixId.isBlank()) {
            var existing = campaignRepository.findByExternalStixId(stixId);
            if (existing.isPresent()) {
                return existing.get();
            }
        }
        String name = malwareNode.path("name").asText("");
        if (name.isBlank()) {
            name = filename.replace(".stix2", "");
        }
        String family = inferSpywareFamily(name + " " + filename);
        String desc = malwareNode.path("description").asText("");
        Instant created = parseInstantOrNull(malwareNode.path("created").asText(""));
        return campaignRepository.saveAndFlush(new CampaignEntity(
                stixId.isBlank() ? "bundle-file:" + filename : stixId,
                name,
                family,
                "Por atribución CTI",
                desc,
                filename,
                created
        ));
    }

    private CampaignEntity ensureFallbackCampaign(String filename) {
        String key = "bundle-file:" + filename;
        return campaignRepository.findByExternalStixId(key).orElseGet(() ->
                campaignRepository.saveAndFlush(new CampaignEntity(
                        key,
                        filename.replace(".stix2", ""),
                        inferSpywareFamily(filename),
                        "Por atribución CTI",
                        "Campaña derivada de feed STIX 2.1 " + filename,
                        filename,
                        null
                ))
        );
    }

    static ParsedPattern parseStixPattern(String pattern) {
        if (pattern == null || pattern.isBlank()) {
            return null;
        }
        Matcher matcher = STIX_PATTERN.matcher(pattern);
        if (!matcher.find()) {
            return null;
        }
        String objectField = matcher.group(1).toLowerCase(Locale.ROOT);
        String rawValue = matcher.group(2).trim();
        if (rawValue.isBlank()) {
            return null;
        }
        String normalized = rawValue.toLowerCase(Locale.ROOT);
        String iocType = mapStixFieldToIocType(objectField, normalized);
        return new ParsedPattern(iocType, rawValue, normalized);
    }

    private static String mapStixFieldToIocType(String field, String normalizedVal) {
        if (field.startsWith("domain-name")) {
            return IPV4_PATTERN.matcher(normalizedVal).matches() ? "ip" : "domain";
        }
        if (field.startsWith("ipv4-addr") || field.startsWith("ipv6-addr")) {
            return "ip";
        }
        if (field.startsWith("url")) {
            return "url";
        }
        if (field.startsWith("email-addr")) {
            return "email";
        }
        if (field.contains("sha256") || field.contains("sha-256")) {
            return "sha256";
        }
        if (field.startsWith("process")) {
            return "process";
        }
        if (field.startsWith("app:") || field.startsWith("configuration-profile") || field.startsWith("android-property")) {
            return "package";
        }
        return "file_path";
    }

    private static String inferSpywareFamily(String hint) {
        String low = hint.toLowerCase(Locale.ROOT);
        if (low.contains("pegasus") || low.contains("nso")) {
            return "Pegasus";
        }
        if (low.contains("predator") || low.contains("cytrox")) {
            return "Predator";
        }
        if (low.contains("novispy")) {
            return "NoviSpy";
        }
        if (low.contains("wintego") || low.contains("helios")) {
            return "Helios / Wintego";
        }
        if (low.contains("candiru")) {
            return "Candiru";
        }
        if (low.contains("android")) {
            return "Android Commercial Spyware";
        }
        return "Commercial Spyware";
    }

    private static Instant parseInstantOrNull(String iso) {
        if (iso == null || iso.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(iso);
        } catch (Exception ex) {
            return null;
        }
    }

    private Path resolveCorpusDirectory() {
        List<Path> candidates = List.of(
                Path.of(properties.cti().stixCorpusDir()),
                Path.of("corpus_mvp/iocs"),
                Path.of("../corpus_mvp/iocs"),
                Path.of("/app/corpus_mvp/iocs")
        );
        for (Path p : candidates) {
            if (Files.isDirectory(p)) {
                return p.toAbsolutePath().normalize();
            }
        }
        return null;
    }

    private Map<String, ManifestBundleMeta> verifyManifestAndBundles(Path corpusDir, List<Path> stixFiles) {
        Path manifestPath = corpusDir.resolve("stix_manifest.json");
        if (!Files.isRegularFile(manifestPath)) {
            if (stixFiles.isEmpty()) {
                return Map.of();
            }
            throw new IllegalStateException("Falta stix_manifest.json para verificar integridad STIX fail-closed en " + corpusDir);
        }

        JsonNode manifest;
        try {
            manifest = objectMapper.readTree(manifestPath.toFile());
        } catch (IOException ex) {
            throw new IllegalStateException("Manifiesto stix_manifest.json ilegible", ex);
        }

        Set<String> trustedOrgs = new HashSet<>();
        for (JsonNode orgNode : manifest.path("trusted_organizations")) {
            String val = orgNode.asText("").trim();
            if (!val.isBlank()) {
                trustedOrgs.add(val);
            }
        }
        if (trustedOrgs.isEmpty()) {
            throw new IllegalStateException("stix_manifest.json debe definir trusted_organizations no vacía");
        }

        Map<String, ManifestBundleMeta> byFilename = new HashMap<>();
        JsonNode bundlesNode = manifest.path("bundles");
        if (bundlesNode.isObject()) {
            var fields = bundlesNode.fields();
            while (fields.hasNext()) {
                var field = fields.next();
                String filename = field.getKey() == null ? "" : field.getKey().trim();
                JsonNode entry = field.getValue();
                registerManifestEntry(byFilename, trustedOrgs, filename, entry);
            }
        } else {
            for (JsonNode entry : bundlesNode) {
                String filename = entry.path("filename").asText("").trim();
                registerManifestEntry(byFilename, trustedOrgs, filename, entry);
            }
        }

        for (Path file : stixFiles) {
            String filename = file.getFileName().toString();
            ManifestBundleMeta meta = byFilename.get(filename);
            if (meta == null) {
                throw new IllegalStateException("Bundle STIX no autorizado ni listado en stix_manifest.json (fail-closed): " + filename);
            }
            String actualSha = computeSha256Hex(file);
            if (!meta.expectedSha256().equals(actualSha)) {
                throw new IllegalStateException("Digest SHA-256 adulterado o inconsistente para bundle STIX (fail-closed): " + filename);
            }
        }
        return byFilename;
    }

    private static void registerManifestEntry(
            Map<String, ManifestBundleMeta> byFilename,
            Set<String> trustedOrgs,
            String filename,
            JsonNode entry
    ) {
        String expectedSha = entry.path("expected_sha256").asText("").trim().toLowerCase(Locale.ROOT);
        String organization = entry.path("organization").asText("").trim();
        String sourceUrl = entry.path("source_url").asText("").trim();
        String publishedDate = entry.path("published_date").asText("").trim();

        if (filename.isBlank() || expectedSha.length() != 64) {
            throw new IllegalStateException("Entrada inválida o sin expected_sha256 en stix_manifest.json: " + filename);
        }
        if (!trustedOrgs.contains(organization)) {
            throw new IllegalStateException("Organización no confiable en stix_manifest.json para " + filename + ": " + organization);
        }
        if (!sourceUrl.startsWith("https://")) {
            throw new IllegalStateException("URL de origen STIX debe usar HTTPS en " + filename);
        }
        byFilename.put(filename, new ManifestBundleMeta(filename, expectedSha, organization, sourceUrl, publishedDate));
    }

    private static String computeSha256Hex(Path file) {
        try {
            byte[] content = Files.readAllBytes(file);
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(content);
            return HexFormat.of().formatHex(digest);
        } catch (IOException | NoSuchAlgorithmException ex) {
            throw new IllegalStateException("No se pudo calcular SHA-256 para " + file.getFileName(), ex);
        }
    }

    record ManifestBundleMeta(
            String filename,
            String expectedSha256,
            String organization,
            String sourceUrl,
            String publishedDate
    ) {
    }

    public record CatalogFreshnessDto(
            @JsonProperty("catalog_cutoff_date") String catalogCutoffDate,
            @JsonProperty("latest_campaign_date") String latestCampaignDate,
            @JsonProperty("verified_bundles_count") int verifiedBundlesCount,
            @JsonProperty("update_policy") String updatePolicy,
            @JsonProperty("manifest_verified") boolean manifestVerified
    ) {
    }

    record ParsedPattern(String iocType, String iocValue, String normalizedValue) {
    }

    record ParsedIndicatorRow(
            UUID campaignId,
            String externalStixId,
            String iocType,
            String iocValue,
            String normalizedValue,
            String stixPattern,
            String context,
            String sourceReport,
            String organization,
            String sourceUrl
    ) {
    }

    public record StixSyncSummary(
            int filesScanned,
            int indicatorsParsed,
            long netIndicatorsInserted,
            long totalIndicatorsInCatalog,
            String message
    ) {
    }
}
