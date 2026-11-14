package com.omega.platform.cti;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Utilidad compartida para inspeccionar de forma segura el esquema heredado `public.*`
 * (cuando existe junto a `omega_rag.*`) y cruzar valores contra IOCs conocidos.
 */
@Component
public class PublicSchemaSupport {

    private final NamedParameterJdbcTemplate jdbcTemplate;

    public PublicSchemaSupport(NamedParameterJdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public boolean hasTable(String qualifiedName) {
        Boolean exists = jdbcTemplate.queryForObject(
                "SELECT to_regclass(:name) IS NOT NULL",
                new MapSqlParameterSource("name", qualifiedName),
                Boolean.class
        );
        return Boolean.TRUE.equals(exists);
    }

    /**
     * Cruza valores candidatos (dominios, IPs, emails, subcadenas) contra `omega_rag.ioc_indicators`
     * y opcionalmente contra `public.iocs` si el esquema público CTI está presente.
     */
    public List<CtiMatchRecord> matchKnownIocs(Collection<String> candidates, int limit) {
        if (candidates == null || candidates.isEmpty()) {
            return List.of();
        }
        List<String> normalized = candidates.stream()
                .filter(Objects::nonNull)
                .map(s -> s.trim().toLowerCase(Locale.ROOT))
                .filter(s -> !s.isBlank())
                .distinct()
                .limit(200)
                .toList();
        if (normalized.isEmpty()) {
            return List.of();
        }

        int safeLimit = Math.max(1, Math.min(limit, 100));
        Map<String, CtiMatchRecord> dedup = new LinkedHashMap<>();

        List<CtiMatchRecord> stixMatches = jdbcTemplate.query(
                """
                SELECT i.ioc_type,
                       i.ioc_value,
                       COALESCE(c.name, i.source_report, 'Catálogo STIX 2.1') AS campaign_name,
                       COALESCE(c.spyware_family, 'Unknown') AS spyware_family,
                       COALESCE(i.organization, 'STIX Feed') AS organization,
                       COALESCE(i.source_url, '') AS source_url,
                       COALESCE(i.context, '') AS context
                FROM omega_rag.ioc_indicators i
                LEFT JOIN omega_rag.campaigns c ON c.id = i.campaign_id
                WHERE i.normalized_value IN (:vals)
                   OR LOWER(i.ioc_value) IN (:vals)
                LIMIT :limit
                """,
                new MapSqlParameterSource()
                        .addValue("vals", normalized)
                        .addValue("limit", safeLimit),
                (rs, rowNum) -> new CtiMatchRecord(
                        rs.getString("ioc_type"),
                        rs.getString("ioc_value"),
                        rs.getString("campaign_name"),
                        rs.getString("spyware_family"),
                        rs.getString("organization"),
                        rs.getString("source_url"),
                        rs.getString("context")
                )
        );
        for (CtiMatchRecord rec : stixMatches) {
            dedup.putIfAbsent(rec.iocType() + "|" + rec.iocValue().toLowerCase(Locale.ROOT), rec);
        }

        if (hasTable("public.iocs") && dedup.size() < safeLimit) {
            List<CtiMatchRecord> publicMatches = jdbcTemplate.query(
                    """
                    SELECT i.ioc_type,
                           i.ioc_value,
                           COALESCE(c.name, r.title, 'Corpus Público CTI') AS campaign_name,
                           COALESCE(c.spyware_family, 'Spyware CTI') AS spyware_family,
                           COALESCE(r.organization, 'Public CTI') AS organization,
                           COALESCE(r.source_url, '') AS source_url,
                           COALESCE(i.context, '') AS context
                    FROM public.iocs i
                    LEFT JOIN public.campaigns c ON c.id = i.campaign_id
                    LEFT JOIN public.reports r ON r.id = i.report_id
                    WHERE LOWER(i.ioc_value) IN (:vals)
                    LIMIT :limit
                    """,
                    new MapSqlParameterSource()
                            .addValue("vals", normalized)
                            .addValue("limit", safeLimit - dedup.size()),
                    (rs, rowNum) -> new CtiMatchRecord(
                            rs.getString("ioc_type"),
                            rs.getString("ioc_value"),
                            rs.getString("campaign_name"),
                            rs.getString("spyware_family"),
                            rs.getString("organization"),
                            rs.getString("source_url"),
                            rs.getString("context")
                    )
            );
            for (CtiMatchRecord rec : publicMatches) {
                dedup.putIfAbsent(rec.iocType() + "|" + rec.iocValue().toLowerCase(Locale.ROOT), rec);
            }
        }

        return new ArrayList<>(dedup.values());
    }

    public record CtiMatchRecord(
            @com.fasterxml.jackson.annotation.JsonProperty("ioc_type") String iocType,
            @com.fasterxml.jackson.annotation.JsonProperty("ioc_value") String iocValue,
            String campaign,
            @com.fasterxml.jackson.annotation.JsonProperty("spyware_family") String spywareFamily,
            String organization,
            @com.fasterxml.jackson.annotation.JsonProperty("source_url") String sourceUrl,
            String context
    ) {
    }
}
