package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.Statement;
import java.util.UUID;
import java.util.stream.Collectors;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** C7: migra desde V29 con datos sembrados hasta la última versión, valida Flyway y ejecuta las reversas de V36 y V37. */
class FlywayMigrationFromV29Test {

    private static PostgreSQLContainer<?> pg;

    @BeforeAll
    static void start() {
        pg = new PostgreSQLContainer<>(DockerImageName.parse("pgvector/pgvector:pg16").asCompatibleSubstituteFor("postgres"))
                .withDatabaseName("omega_rag_test").withUsername("omega_test").withPassword("omega_test_secret");
        pg.start();
    }

    @AfterAll
    static void stop() { if (pg != null) pg.stop(); }

    private JdbcTemplate freshDb(String name) throws Exception {
        try (Connection c = pg.createConnection(""); Statement s = c.createStatement()) { s.execute("CREATE DATABASE " + name); }
        String base = pg.getJdbcUrl();
        String url = base.substring(0, base.lastIndexOf('/') + 1) + name;
        var ds = DataSourceBuilder.create().url(url + "?currentSchema=omega_rag,public")
                .username(pg.getUsername()).password(pg.getPassword()).build();
        return new JdbcTemplate(ds);
    }

    private static Flyway flyway(JdbcTemplate jdbc, String target) {
        var cfg = Flyway.configure().dataSource(jdbc.getDataSource()).locations("classpath:db/migration").defaultSchema("public");
        if (target != null) cfg.target(target);
        return cfg.load();
    }

    private static String reverseOf(String file) throws Exception {
        String sql = new ClassPathResource("db/migration/" + file).getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        return sql.lines().takeWhile(l -> l.startsWith("--")).filter(l -> !l.trim().equals("-- Reverse:"))
                .map(l -> l.replaceFirst("^--\\s?", "")).collect(Collectors.joining("\n"));
    }

    @Test
    void migratesSeededV29DataToLatestValidatesAndRunsReverses() throws Exception {
        JdbcTemplate jdbc = freshDb("omega_f0_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8));
        flyway(jdbc, "29").migrate();

        UUID tenant = UUID.randomUUID();
        UUID user = UUID.randomUUID();
        UUID expediente = UUID.randomUUID();
        jdbc.update("INSERT INTO omega_rag.tenants (id, slug, name) VALUES (?, 'seed-f0', 'Seed F0')", tenant);
        jdbc.update("INSERT INTO omega_rag.users (id, tenant_id, email, password_hash, full_name, role) VALUES (?, ?, 'seed@f0.invalid', 'h', 'Seed', 'ADMIN')", user, tenant);
        jdbc.update("INSERT INTO omega_rag.expedientes (id, tenant_id, owner_user_id, title, classification) VALUES (?, ?, ?, 'Caso sembrado', 'CONFIDENTIAL')", expediente, tenant, user);

        flyway(jdbc, "36").migrate();
        jdbc.update("UPDATE omega_rag.expedientes SET client_name = 'Óscar Muñoz', counterparty_name = 'Úrsula Pérez' WHERE id = ?", expediente);

        var latest = flyway(jdbc, null);
        latest.migrate();
        latest.validate();

        assertThat(jdbc.queryForObject("SELECT normalized_name FROM omega_rag.legal_case_parties WHERE expediente_id = ? AND party_role = 'CLIENT'", String.class, expediente)).isEqualTo("oscar munoz");
        assertThat(jdbc.queryForObject("SELECT normalized_name FROM omega_rag.legal_case_parties WHERE expediente_id = ? AND party_role = 'COUNTERPARTY'", String.class, expediente)).isEqualTo("ursula perez");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM omega_rag.workspace_memberships WHERE user_id = ? AND tenant_id = ? AND active", Integer.class, user, tenant)).isEqualTo(1);

        // Último ADMIN activo de un espacio activo no puede desactivarse ni degradarse por SQL directo (ni por users.active)
        assertThatThrownBy(() -> jdbc.update("UPDATE omega_rag.workspace_memberships SET active = FALSE WHERE tenant_id = ? AND user_id = ?", tenant, user))
                .hasMessageContaining("último ADMIN");
        assertThatThrownBy(() -> jdbc.update("UPDATE omega_rag.workspace_memberships SET role = 'CLIENT' WHERE tenant_id = ? AND user_id = ?", tenant, user))
                .hasMessageContaining("último ADMIN");
        assertThatThrownBy(() -> jdbc.update("UPDATE omega_rag.users SET active = FALSE WHERE id = ?", user))
                .hasMessageContaining("último ADMIN");

        jdbc.execute(reverseOf("V37__legal_f0_parties_and_membership_guards.sql"));
        assertThat(jdbc.queryForObject("SELECT to_regclass('omega_rag.legal_case_parties') IS NULL", Boolean.class)).isTrue();
        jdbc.update("UPDATE omega_rag.workspace_memberships SET active = FALSE WHERE tenant_id = ? AND user_id = ?", tenant, user);

        jdbc.execute(reverseOf("V36__legal_case_sheet.sql"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='omega_rag' AND table_name='expedientes' AND column_name='client_name'", Integer.class)).isZero();
    }
}
