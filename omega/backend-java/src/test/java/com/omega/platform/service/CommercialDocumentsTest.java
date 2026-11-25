package com.omega.platform.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.omega.platform.security.*;
import java.nio.file.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.web.server.ResponseStatusException;

class CommercialDocumentsTest {
    @TempDir Path directory;
    @Test void completeIdentityAloneCannotPublishUnreviewedTemplates() {
        var documents=new CommercialDocuments(mock(JdbcTemplate.class),environment());
        assertThat(documents.configuration().get("published")).isEqualTo(false);
        assertThatThrownBy(() -> documents.requireCheckout(actor(),true)).isInstanceOf(ResponseStatusException.class);
    }
    @Test void changedTextInvalidatesPriorVersionAndRequiresExpressAcceptance() throws Exception {
        Files.writeString(directory.resolve("terms.txt"),"Términos revisados de {{name}}");
        Files.writeString(directory.resolve("privacy.txt"),"Política revisada");
        var env=environment().withProperty("OMEGA_COMMERCIAL_DOCUMENTS_DIR",directory.toString());
        var jdbc=mock(JdbcTemplate.class);
        var first=new CommercialDocuments(jdbc,env);
        String version=first.configuration().get("version").toString();
        assertThat(first.configuration().get("published")).isEqualTo(true);
        assertThatThrownBy(() -> first.requireRegistration(null)).isInstanceOf(ResponseStatusException.class);
        first.requireRegistration(version);
        first.accept(actor(),version);
        Files.writeString(directory.resolve("privacy.txt"),"Política revisada con nueva finalidad");
        var second=new CommercialDocuments(jdbc,env);
        assertThat(second.configuration().get("version")).isNotEqualTo(version);
        assertThatThrownBy(() -> second.accept(actor(),version)).isInstanceOf(ResponseStatusException.class);
    }
    private MockEnvironment environment() {
        return new MockEnvironment().withProperty("OMEGA_SELLER_LEGAL_NAME","Persona Pruebas")
            .withProperty("OMEGA_SELLER_NIT","123456-0").withProperty("OMEGA_SELLER_ADDRESS","Dirección de prueba")
            .withProperty("OMEGA_SUPPORT_EMAIL","support@example.invalid").withProperty("OMEGA_PRIVACY_EMAIL","privacy@example.invalid")
            .withProperty("OMEGA_COMMERCIAL_DOCUMENTS_PUBLISHED","true");
    }
    private OmegaPrincipal actor() { return new OmegaPrincipal(UUID.randomUUID(),UUID.randomUUID(),"test@example.invalid",Role.ANALYST,true); }
}
