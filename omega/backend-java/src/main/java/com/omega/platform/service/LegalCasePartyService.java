package com.omega.platform.service;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class LegalCasePartyService {

    public static final Set<String> ALLOWED_PARTY_ROLES = Set.of("CLIENT", "COUNTERPARTY", "OTHER");

    private final JdbcTemplate jdbc;

    public LegalCasePartyService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record CasePartyView(
            UUID id,
            String partyRole,
            String displayName,
            String normalizedName,
            boolean primary
    ) {
    }

    @Transactional
    public void syncPrimaryParties(UUID tenantId, UUID expedienteId, String clientName, String counterpartyName) {
        upsertOrDeletePrimaryParty(tenantId, expedienteId, "CLIENT", clientName);
        upsertOrDeletePrimaryParty(tenantId, expedienteId, "COUNTERPARTY", counterpartyName);
    }

    @Transactional
    public CasePartyView addAdditionalParty(UUID tenantId, UUID expedienteId, String partyRole, String displayName) {
        String cleanRole = partyRole == null ? "" : partyRole.strip().toUpperCase(java.util.Locale.ROOT);
        if (!ALLOWED_PARTY_ROLES.contains(cleanRole)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Rol de parte inválido.");
        }
        String cleanDisplay = LegalCaseService.normalizeOptional(displayName);
        if (cleanDisplay == null || cleanDisplay.length() > 200) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El nombre de la parte debe tener entre 1 y 200 caracteres.");
        }
        String normalized = LegalNameNormalizer.normalize(cleanDisplay);
        UUID partyId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO omega_rag.legal_case_parties
                    (id, tenant_id, expediente_id, party_role, display_name, normalized_name, is_primary, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, FALSE, NOW(), NOW())
                """,
                partyId, tenantId, expedienteId, cleanRole, cleanDisplay, normalized
        );
        return new CasePartyView(partyId, cleanRole, cleanDisplay, normalized, false);
    }

    @Transactional(readOnly = true)
    public List<CasePartyView> listParties(UUID tenantId, UUID expedienteId) {
        return jdbc.query("""
                SELECT id, party_role, display_name, normalized_name, is_primary
                  FROM omega_rag.legal_case_parties
                 WHERE tenant_id = ? AND expediente_id = ?
                 ORDER BY is_primary DESC, created_at ASC, id ASC
                """,
                (rs, rowNum) -> new CasePartyView(
                        rs.getObject("id", UUID.class),
                        rs.getString("party_role"),
                        rs.getString("display_name"),
                        rs.getString("normalized_name"),
                        rs.getBoolean("is_primary")
                ),
                tenantId,
                expedienteId
        );
    }

    private void upsertOrDeletePrimaryParty(UUID tenantId, UUID expedienteId, String partyRole, String rawDisplayName) {
        String cleanDisplay = LegalCaseService.normalizeOptional(rawDisplayName);
        if (cleanDisplay == null) {
            jdbc.update("""
                    DELETE FROM omega_rag.legal_case_parties
                     WHERE tenant_id = ? AND expediente_id = ? AND party_role = ? AND is_primary = TRUE
                    """,
                    tenantId, expedienteId, partyRole
            );
            return;
        }
        String normalized = LegalNameNormalizer.normalize(cleanDisplay);
        jdbc.update("""
                INSERT INTO omega_rag.legal_case_parties
                    (id, tenant_id, expediente_id, party_role, display_name, normalized_name, is_primary, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, TRUE, NOW(), NOW())
                ON CONFLICT (tenant_id, expediente_id, party_role)
                    WHERE is_primary = TRUE AND party_role IN ('CLIENT', 'COUNTERPARTY')
                DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    normalized_name = EXCLUDED.normalized_name,
                    updated_at = NOW()
                """,
                UUID.randomUUID(),
                tenantId,
                expedienteId,
                partyRole,
                cleanDisplay,
                normalized
        );
    }
}
