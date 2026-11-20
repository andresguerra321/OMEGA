package com.omega.platform.repository;

import java.sql.Date;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Tope diario persistente y atómico por repositorio en PostgreSQL.
 */
@Repository
public class GitHubRepoDailyUsageRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public GitHubRepoDailyUsageRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean tryReserveDailySlot(String repoFullName, int maxPerDay) {
        Date today = Date.valueOf(LocalDate.now(ZoneOffset.UTC));
        int updated = jdbc.update(
                """
                INSERT INTO omega_rag.github_repo_daily_usage (repo_full_name, usage_date, scans_used)
                VALUES (:repo, :usageDate, 1)
                ON CONFLICT (repo_full_name, usage_date) DO UPDATE
                    SET scans_used = omega_rag.github_repo_daily_usage.scans_used + 1
                    WHERE omega_rag.github_repo_daily_usage.scans_used < :maxPerDay
                """,
                Map.of(
                        "repo", repoFullName.toLowerCase(),
                        "usageDate", today,
                        "maxPerDay", maxPerDay
                )
        );
        return updated == 1;
    }

    public void releaseDailySlot(String repoFullName) {
        Date today = Date.valueOf(LocalDate.now(ZoneOffset.UTC));
        jdbc.update(
                """
                UPDATE omega_rag.github_repo_daily_usage
                SET scans_used = GREATEST(0, scans_used - 1)
                WHERE repo_full_name = :repo AND usage_date = :usageDate
                """,
                Map.of("repo", repoFullName.toLowerCase(), "usageDate", today)
        );
    }
}
