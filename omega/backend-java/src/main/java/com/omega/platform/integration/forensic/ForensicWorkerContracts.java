package com.omega.platform.integration.forensic;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.Map;

/**
 * Contratos DTO alineados 1:1 con los esquemas FastAPI de `omega/api/`
 * (`schemas.py`, `triage_orchestrator.py`, `link_verifier.py`, `detection_engineering.py`)
 * para ser consumidos por el controlador puente de Spring Boot en Fase 5 vía RestClient interno.
 */
public final class ForensicWorkerContracts {

    private ForensicWorkerContracts() {
    }

    public record RealtimeToggleRequest(@jakarta.validation.constraints.NotNull Boolean enabled) {}

    public record HostIndicator(String ioc_type, String ioc_value, String source) {}

    public record PersistenceFinding(
            String id, String category, String persistenceType, String location, String targetPath,
            String sha256, String signatureStatus, String publisher, String severity,
            String userFriendlyTitle, String userFriendlyExplanation, String recommendedAction,
            Map<String, Object> evidence, List<Map<String, Object>> ctiMatches
    ) {}

    public record PersistenceAuditResponse(
            String scope, String platform, String hostname, String collectedAt,
            List<PersistenceFinding> findings, List<Map<String, Object>> processes,
            List<Map<String, Object>> processFindings, List<String> limitations, boolean complete, String notice
    ) {}

    public record RealtimeStatus(
            boolean enabled, boolean running, boolean active, String state, String scope, String hostname,
            String platform, double intervalSeconds, String lastCheck, int indicatorCount,
            boolean catalogLoaded, String catalogVersion, String catalogError, String sensorError,
            String dnsCoverage, List<Map<String, Object>> alerts, int alertCount,
            Map<String, Object> capabilities, String notice
    ) {}

    public record LinkCheckRequest(String url, boolean activeProbe) {
        public LinkCheckRequest(String url) { this(url, false); }
    }

    public record CtiLinkMatch(
            @JsonProperty("ioc_type") String iocType,
            @JsonProperty("ioc_value") String iocValue,
            String context,
            String campaign,
            @JsonProperty("spyware_family") String spywareFamily,
            @JsonProperty("source_report") String sourceReport,
            String organization,
            @JsonProperty("source_url") String sourceUrl
    ) {
    }

    public record LinkVerifyResponse(
            @JsonProperty("normalized_url") String normalizedUrl,
            String host,
            @JsonProperty("root_domain") String rootDomain,
            String scheme,
            String path,
            @JsonProperty("risk_level") String riskLevel,
            String verdict,
            String recommendation,
            List<String> heuristics,
            @JsonProperty("passive_ct_certificates") Integer passiveCtCertificates,
            @JsonProperty("cti_matches") List<CtiLinkMatch> ctiMatches,
            @JsonProperty("privacy_notice") String privacyNotice,
            Integer domainAgeDays, Boolean freshTlsCertificate, Boolean cloakingDetected,
            Integer evasionRiskScore, List<String> evasionReasons,
            @JsonProperty("infrastructure_intelligence") Map<String, Object> infrastructureIntelligence
    ) {
        public LinkVerifyResponse(String normalizedUrl, String host, String rootDomain, String scheme, String path,
                String riskLevel, String verdict, String recommendation, List<String> heuristics,
                Integer passiveCtCertificates, List<CtiLinkMatch> ctiMatches, String privacyNotice) {
            this(normalizedUrl, host, rootDomain, scheme, path, riskLevel, verdict, recommendation, heuristics,
                    passiveCtCertificates, ctiMatches, privacyNotice, null, null, null, null, List.of(), Map.of());
        }
    }

    public record ContainmentRequest(
            @jakarta.validation.constraints.NotBlank String actionType,
            @jakarta.validation.constraints.NotNull Map<String, Object> target,
            @jakarta.validation.constraints.NotNull Boolean dryRun,
            String previewToken, String currentPassword, String challengeToken, String code, java.util.UUID expedienteId
    ) {}

    public record ContainmentCredentials(
            @jakarta.validation.constraints.NotBlank String currentPassword, String challengeToken, String code, java.util.UUID expedienteId
    ) {}

    public record YaraRuleResponse(
            @JsonProperty("campaign_id") String campaignId,
            @JsonProperty("campaign_name") String campaignName,
            @JsonProperty("rule_name") String ruleName,
            String filename,
            @JsonProperty("ioc_count") int iocCount,
            @JsonProperty("yara_rule") String yaraRule
    ) {
    }

    public record TriageDiagnosis(
            @JsonProperty("verdict_code") String verdictCode,
            @JsonProperty("verdict_label") String verdictLabel,
            String confidence,
            @JsonProperty("is_likely_false_positive") boolean isLikelyFalsePositive,
            String rationale,
            @JsonProperty("recommended_actions") List<String> recommendedActions
    ) {
    }

    public record ParallelTriageResponse(
            @JsonProperty("pipeline_mode") String pipelineMode,
            @JsonProperty("total_files") int totalFiles,
            @JsonProperty("total_indicators_analyzed") int totalIndicatorsAnalyzed,
            @JsonProperty("total_matches") int totalMatches,
            @JsonProperty("crash_anomalies") List<String> crashAnomalies,
            @JsonProperty("behavioral_anomalies") List<Map<String, Object>> behavioralAnomalies,
            @JsonProperty("manifest_findings") List<Map<String, Object>> manifestFindings,
            @JsonProperty("yara_hits") List<Map<String, Object>> yaraHits,
            @JsonProperty("device_summary") Map<String, Object> deviceSummary,
            @JsonProperty("hardening_checks") List<Map<String, Object>> hardeningChecks,
            @JsonProperty("abuse_alerts") List<Map<String, Object>> abuseAlerts,
            @JsonProperty("live_sockets") List<Map<String, Object>> liveSockets,
            @JsonProperty("live_sockets_total") int liveSocketsTotal,
            @JsonProperty("cached_dns_count") int cachedDnsCount,
            @JsonProperty("cached_dns_sample") List<String> cachedDnsSample,
            List<Map<String, Object>> timeline,
            @JsonProperty("timeline_summary") Map<String, Object> timelineSummary,
            @JsonProperty("yara_engine") Map<String, Object> yaraEngine,
            TriageDiagnosis diagnosis,
            List<Map<String, Object>> subagents,
            @JsonProperty("ephemeral_notice") String ephemeralNotice,
            @JsonProperty("catalog_freshness") Map<String, Object> catalogFreshness,
            @JsonProperty("os_scope_notice") String osScopeNotice,
            @JsonProperty("platform_mitigations") List<Map<String, Object>> platformMitigations
    ) {
    }

    public record YaraScanResponse(
            @JsonProperty("scan_mode") String scanMode,
            @JsonProperty("files_scanned") int filesScanned,
            @JsonProperty("hits_count") int hitsCount,
            List<Map<String, Object>> hits,
            @JsonProperty("yara_engine") Map<String, Object> yaraEngine
    ) {
    }

    public record MobileUsbAuditWorkerRequest(
            String platform,
            @JsonProperty("device_id") String deviceId,
            @JsonProperty("backup_password") String backupPassword,
            @JsonProperty("async_mode") boolean asyncMode
    ) {
    }
}
