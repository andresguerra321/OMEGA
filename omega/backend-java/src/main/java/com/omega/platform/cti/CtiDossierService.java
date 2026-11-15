package com.omega.platform.cti;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.omega.platform.service.ResourceNotFoundException;
import java.sql.Array;
import java.sql.Date;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Servicio unificado de dosieres CTI que combina el catálogo STIX 2.1 (`omega_rag.*`)
 * con las campañas históricas ingeridas del corpus público (`public.*`) si existen.
 */
@Service
public class CtiDossierService {

    private final NamedParameterJdbcTemplate jdbcTemplate;
    private final PublicSchemaSupport publicSchemaSupport;
    private final StixCatalogService stixCatalogService;

    public CtiDossierService(
            NamedParameterJdbcTemplate jdbcTemplate,
            PublicSchemaSupport publicSchemaSupport
    ) {
        this(jdbcTemplate, publicSchemaSupport, null);
    }

    @Autowired
    public CtiDossierService(
            NamedParameterJdbcTemplate jdbcTemplate,
            PublicSchemaSupport publicSchemaSupport,
            StixCatalogService stixCatalogService
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.publicSchemaSupport = publicSchemaSupport;
        this.stixCatalogService = stixCatalogService;
    }

    @Transactional(readOnly = true)
    public CampaignListResponse listCampaignSummaries() {
        Map<UUID, CampaignSummaryDto> byId = new LinkedHashMap<>();

        if (publicSchemaSupport.hasTable("public.campaigns")) {
            List<CampaignSummaryDto> publicRows = jdbcTemplate.query(
                    """
                    SELECT c.id,
                           c.name,
                           c.spyware_family,
                           c.suspected_actor,
                           c.target_sector,
                           c.target_regions,
                           c.first_seen_date,
                           c.summary,
                           c.created_at,
                           (SELECT COUNT(*) FROM public.iocs i WHERE i.campaign_id = c.id) AS ioc_count,
                           COALESCE(
                               (SELECT array_agg(DISTINCT cv.cve_code ORDER BY cv.cve_code)
                                FROM public.campaign_cves cc
                                JOIN public.cves cv ON cv.id = cc.cve_id
                                WHERE cc.campaign_id = c.id),
                               ARRAY[]::text[]
                           ) AS cve_codes
                    FROM public.campaigns c
                    ORDER BY c.first_seen_date DESC NULLS LAST, c.name ASC
                    """,
                    (rs, rowNum) -> new CampaignSummaryDto(
                            UUID.fromString(rs.getString("id")),
                            rs.getString("name"),
                            rs.getString("spyware_family"),
                            rs.getString("suspected_actor"),
                            rs.getString("target_sector"),
                            toStringList(rs.getArray("target_regions")),
                            formatDate(rs.getDate("first_seen_date")),
                            rs.getString("summary"),
                            "Corpus Público CTI",
                            rs.getLong("ioc_count"),
                            toStringList(rs.getArray("cve_codes")),
                            rs.getTimestamp("created_at") != null ? rs.getTimestamp("created_at").toInstant() : null
                    )
            );
            for (CampaignSummaryDto dto : publicRows) {
                byId.put(dto.id(), dto);
            }
        }

        List<CampaignSummaryDto> ragRows = jdbcTemplate.query(
                """
                SELECT c.id,
                       c.name,
                       c.spyware_family,
                       c.suspected_actor,
                       c.description,
                       c.source_feed,
                       c.first_seen_at,
                       c.created_at,
                       (SELECT COUNT(*) FROM omega_rag.ioc_indicators i WHERE i.campaign_id = c.id) AS ioc_count
                FROM omega_rag.campaigns c
                ORDER BY c.created_at DESC, c.name ASC
                """,
                (rs, rowNum) -> {
                    Instant firstSeen = rs.getTimestamp("first_seen_at") != null
                            ? rs.getTimestamp("first_seen_at").toInstant()
                            : null;
                    Instant created = rs.getTimestamp("created_at") != null
                            ? rs.getTimestamp("created_at").toInstant()
                            : null;
                    return new CampaignSummaryDto(
                            UUID.fromString(rs.getString("id")),
                            rs.getString("name"),
                            rs.getString("spyware_family"),
                            rs.getString("suspected_actor"),
                            null,
                            List.of(),
                            firstSeen != null ? firstSeen.toString().substring(0, 10) : null,
                            rs.getString("description"),
                            rs.getString("source_feed"),
                            rs.getLong("ioc_count"),
                            List.of(),
                            created
                    );
                }
        );

        for (CampaignSummaryDto dto : ragRows) {
            boolean duplicateByName = byId.values().stream()
                    .anyMatch(existing -> existing.name() != null && existing.name().equalsIgnoreCase(dto.name()));
            if (!byId.containsKey(dto.id()) && !duplicateByName) {
                byId.put(dto.id(), dto);
            }
        }

        List<CampaignSummaryDto> items = new ArrayList<>(byId.values());
        StixCatalogService.CatalogFreshnessDto freshness = stixCatalogService != null
                ? stixCatalogService.getCatalogFreshness()
                : new StixCatalogService.CatalogFreshnessDto("2024-12-16", "2024-12-16", 0, "pr_reviewed_only", false);
        return new CampaignListResponse(items, items.size(), freshness);
    }

    @Transactional(readOnly = true)
    public CampaignDossierDto getCampaignDossier(UUID campaignId) {
        MapSqlParameterSource params = new MapSqlParameterSource("id", campaignId);

        if (publicSchemaSupport.hasTable("public.campaigns")) {
            List<CampaignSummaryDto> found = jdbcTemplate.query(
                    """
                    SELECT id, name, spyware_family, suspected_actor, target_sector,
                           target_regions, first_seen_date, summary, created_at
                    FROM public.campaigns
                    WHERE id = :id
                    """,
                    params,
                    (rs, rowNum) -> new CampaignSummaryDto(
                            UUID.fromString(rs.getString("id")),
                            rs.getString("name"),
                            rs.getString("spyware_family"),
                            rs.getString("suspected_actor"),
                            rs.getString("target_sector"),
                            toStringList(rs.getArray("target_regions")),
                            formatDate(rs.getDate("first_seen_date")),
                            rs.getString("summary"),
                            "Corpus Público CTI",
                            0L,
                            List.of(),
                            rs.getTimestamp("created_at") != null ? rs.getTimestamp("created_at").toInstant() : null
                    )
            );
            if (!found.isEmpty()) {
                CampaignSummaryDto head = found.getFirst();
                List<CveItem> cves = jdbcTemplate.query(
                        """
                        SELECT cv.cve_code, cv.description, cv.cvss_score
                        FROM public.campaign_cves cc
                        JOIN public.cves cv ON cv.id = cc.cve_id
                        WHERE cc.campaign_id = :id
                        ORDER BY cv.cvss_score DESC NULLS LAST, cv.cve_code ASC
                        """,
                        params,
                        (rs, rowNum) -> new CveItem(
                                rs.getString("cve_code"),
                                rs.getString("description"),
                                rs.getObject("cvss_score") != null ? rs.getDouble("cvss_score") : null
                        )
                );
                List<IocItem> iocs = jdbcTemplate.query(
                        """
                        SELECT ioc_type, ioc_value, context
                        FROM public.iocs
                        WHERE campaign_id = :id
                        ORDER BY ioc_type ASC, ioc_value ASC
                        LIMIT 500
                        """,
                        params,
                        (rs, rowNum) -> new IocItem(
                                rs.getString("ioc_type"),
                                rs.getString("ioc_value"),
                                rs.getString("context")
                        )
                );
                List<ReportItem> reports = jdbcTemplate.query(
                        """
                        SELECT id, title, organization, publication_date, source_url, file_hash
                        FROM public.reports
                        WHERE campaign_id = :id
                        ORDER BY publication_date DESC NULLS LAST, ingested_at DESC
                        """,
                        params,
                        (rs, rowNum) -> new ReportItem(
                                UUID.fromString(rs.getString("id")),
                                rs.getString("title"),
                                rs.getString("organization"),
                                formatDate(rs.getDate("publication_date")),
                                rs.getString("source_url"),
                                rs.getString("file_hash")
                        )
                );
                return new CampaignDossierDto(
                        head.id(),
                        head.name(),
                        head.spywareFamily(),
                        head.suspectedActor(),
                        head.targetSector(),
                        head.targetRegions(),
                        head.firstSeenDate(),
                        head.summary(),
                        cves,
                        iocs,
                        computeBreakdown(iocs),
                        reports
                );
            }
        }

        List<CampaignSummaryDto> stixFound = jdbcTemplate.query(
                """
                SELECT id, name, spyware_family, suspected_actor, description,
                       source_feed, first_seen_at, created_at
                FROM omega_rag.campaigns
                WHERE id = :id
                """,
                params,
                (rs, rowNum) -> {
                    Instant firstSeen = rs.getTimestamp("first_seen_at") != null
                            ? rs.getTimestamp("first_seen_at").toInstant()
                            : null;
                    return new CampaignSummaryDto(
                            UUID.fromString(rs.getString("id")),
                            rs.getString("name"),
                            rs.getString("spyware_family"),
                            rs.getString("suspected_actor"),
                            null,
                            List.of(),
                            firstSeen != null ? firstSeen.toString().substring(0, 10) : null,
                            rs.getString("description"),
                            rs.getString("source_feed"),
                            0L,
                            List.of(),
                            rs.getTimestamp("created_at") != null ? rs.getTimestamp("created_at").toInstant() : null
                    );
                }
        );

        if (stixFound.isEmpty()) {
            throw new ResourceNotFoundException("Campaña CTI no encontrada: " + campaignId);
        }

        CampaignSummaryDto head = stixFound.getFirst();
        List<IocItem> stixIocs = jdbcTemplate.query(
                """
                SELECT ioc_type, ioc_value, context
                FROM omega_rag.ioc_indicators
                WHERE campaign_id = :id
                ORDER BY ioc_type ASC, ioc_value ASC
                LIMIT 500
                """,
                params,
                (rs, rowNum) -> new IocItem(
                        rs.getString("ioc_type"),
                        rs.getString("ioc_value"),
                        rs.getString("context")
                )
        );

        List<ReportItem> stixReports = jdbcTemplate.query(
                """
                SELECT MIN(id::text)::uuid AS id,
                       COALESCE(source_report, 'STIX 2.1 Feed') AS title,
                       COALESCE(organization, 'Amnesty / STIX') AS organization,
                       MIN(source_url) AS source_url
                FROM omega_rag.ioc_indicators
                WHERE campaign_id = :id
                GROUP BY COALESCE(source_report, 'STIX 2.1 Feed'), COALESCE(organization, 'Amnesty / STIX')
                """,
                params,
                (rs, rowNum) -> new ReportItem(
                        UUID.fromString(rs.getString("id")),
                        rs.getString("title"),
                        rs.getString("organization"),
                        head.firstSeenDate(),
                        rs.getString("source_url"),
                        null
                )
        );

        return new CampaignDossierDto(
                head.id(),
                head.name(),
                head.spywareFamily(),
                head.suspectedActor(),
                head.targetSector(),
                head.targetRegions(),
                head.firstSeenDate(),
                head.summary(),
                List.of(),
                stixIocs,
                computeBreakdown(stixIocs),
                stixReports
        );
    }

    private static Map<String, Long> computeBreakdown(List<IocItem> iocs) {
        Map<String, Long> breakdown = new LinkedHashMap<>();
        for (IocItem ioc : iocs) {
            String key = ioc.iocType() != null ? ioc.iocType() : "unknown";
            breakdown.merge(key, 1L, Long::sum);
        }
        return breakdown;
    }

    private static List<String> toStringList(Array sqlArray) throws SQLException {
        if (sqlArray == null) {
            return List.of();
        }
        Object raw = sqlArray.getArray();
        if (raw instanceof Object[] arr) {
            List<String> out = new ArrayList<>(arr.length);
            for (Object item : arr) {
                if (item != null) {
                    out.add(item.toString());
                }
            }
            return out;
        }
        return List.of();
    }

    private static String formatDate(Date date) {
        return date != null ? date.toString() : null;
    }

    public record CampaignListResponse(
            List<CampaignSummaryDto> campaigns,
            int total,
            @JsonProperty("catalog_freshness") StixCatalogService.CatalogFreshnessDto catalogFreshness
    ) {
        public CampaignListResponse(List<CampaignSummaryDto> campaigns, int total) {
            this(campaigns, total, null);
        }
    }

    public record CampaignSummaryDto(
            UUID id,
            String name,
            @JsonProperty("spyware_family") String spywareFamily,
            @JsonProperty("suspected_actor") String suspectedActor,
            @JsonProperty("target_sector") String targetSector,
            @JsonProperty("target_regions") List<String> targetRegions,
            @JsonProperty("first_seen_date") String firstSeenDate,
            String summary,
            @JsonProperty("source_feed") String sourceFeed,
            @JsonProperty("ioc_count") long iocCount,
            List<String> cves,
            @JsonProperty("created_at") Instant createdAt
    ) {
    }

    public record CveItem(
            @JsonProperty("cve_code") String cveCode,
            String description,
            @JsonProperty("cvss_score") Double cvssScore
    ) {
    }

    public record IocItem(
            @JsonProperty("ioc_type") String iocType,
            @JsonProperty("ioc_value") String iocValue,
            String context
    ) {
    }

    public record ReportItem(
            UUID id,
            String title,
            String organization,
            @JsonProperty("publication_date") String publicationDate,
            @JsonProperty("source_url") String sourceUrl,
            @JsonProperty("file_hash") String fileHash
    ) {
    }

    public record CampaignDossierDto(
            UUID id,
            String name,
            @JsonProperty("spyware_family") String spywareFamily,
            @JsonProperty("suspected_actor") String suspectedActor,
            @JsonProperty("target_sector") String targetSector,
            @JsonProperty("target_regions") List<String> targetRegions,
            @JsonProperty("first_seen_date") String firstSeenDate,
            String summary,
            List<CveItem> cves,
            List<IocItem> iocs,
            @JsonProperty("ioc_breakdown") Map<String, Long> iocBreakdown,
            List<ReportItem> reports
    ) {
    }
}
