package com.omega.platform.rag;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.omega.platform.config.OmegaProperties;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

class CorpusScopeFilterTest {

    @Test
    void migrationV12AddsCorpusScopeWithGeneralDefault() throws Exception {
        Path migration = Path.of("src/main/resources/db/migration/V12__corpus_scope.sql");
        assertTrue(Files.exists(migration));
        String sql = Files.readString(migration);
        assertTrue(sql.contains("DEFAULT 'GENERAL'"));
        assertTrue(sql.contains("'GENERAL', 'LEGAL', 'DEVELOPER'"));
        assertTrue(sql.contains("omega_rag.documents"));
        assertTrue(sql.contains("omega_rag.campaigns"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void searchHybridEnforcesTenantExpedienteAndCorpusScope() {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        when(jdbc.query(anyString(), any(MapSqlParameterSource.class), any(RowMapper.class)))
                .thenReturn(List.of());

        OmegaProperties props = mock(OmegaProperties.class);
        OmegaProperties.Rag rag = mock(OmegaProperties.Rag.class);
        when(rag.rrfK()).thenReturn(60);
        when(rag.vectorWeight()).thenReturn(0.5);
        when(rag.lexicalWeight()).thenReturn(0.5);
        when(props.rag()).thenReturn(rag);

        HybridRagSearchRepository repo = new HybridRagSearchRepository(jdbc, props);
        UUID tenantId = UUID.randomUUID();
        UUID expId = UUID.randomUUID();

        repo.searchHybrid(tenantId, expId, "supply chain", new float[] {0.1f, 0.2f}, "text-embedding-3-small", 5, "DEVELOPER");

        ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<MapSqlParameterSource> paramsCaptor = ArgumentCaptor.forClass(MapSqlParameterSource.class);
        verify(jdbc).query(sqlCaptor.capture(), paramsCaptor.capture(), any(RowMapper.class));

        assertTrue(sqlCaptor.getValue().contains("c.tenant_id = :tenantId"));
        assertTrue(sqlCaptor.getValue().contains("c.expediente_id = :expedienteId"));
        assertTrue(sqlCaptor.getValue().contains("d.corpus_scope = :corpusScope"));
        assertEquals("DEVELOPER", paramsCaptor.getValue().getValue("corpusScope"));
        assertEquals(tenantId, paramsCaptor.getValue().getValue("tenantId"));
    }
}
