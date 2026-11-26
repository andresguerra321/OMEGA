package com.omega.platform.billing;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * Guardia arquitectónica de código de producción para asegurar que
 * {@link AccountSeatService#assignWorkspaceMembership} nunca se invoque sin verificación previa
 * de permisos y que ningún código de producción ejecute DELETE físico sobre workspace_memberships.
 */
class WorkspaceMembershipAuthorizationArchitectureTest {

    private static final Path MAIN_JAVA = Path.of("src/main/java");
    private static final Pattern EXPLICIT_AUTH_GUARD = Pattern.compile(
            "@PreAuthorize\\s*\\(|\\b(requireAdmin|requireManager|requireBillingManager|requireOrgAdmin|requireWorkspaceAdmin|verifyWorkspaceAdmin|authorizeWorkspaceMembership)\\s*\\(");
    private static final Pattern PHYSICAL_DELETE_MEMBERSHIP = Pattern.compile(
            "(?i)DELETE\\s+FROM\\s+(omega_rag\\.)?workspace_memberships");

    @Test
    void assignWorkspaceMembershipJavadocDocumentsNonAuthorizingContract() throws IOException {
        Path seatServicePath = MAIN_JAVA.resolve("com/omega/platform/billing/AccountSeatService.java");
        String source = Files.readString(seatServicePath, StandardCharsets.UTF_8);
        assertThat(source)
                .contains("CONTRATO DE SEGURIDAD (NO AUTORIZA)")
                .contains("NO valida permisos del actor invocador");
    }

    @Test
    void productionCallersOfAssignWorkspaceMembershipMustEnforceExplicitAuthorization() throws IOException {
        List<String> violations = new ArrayList<>();
        try (Stream<Path> files = Files.walk(MAIN_JAVA)) {
            files.filter(p -> p.toString().endsWith(".java"))
                    .filter(p -> !p.getFileName().toString().equals("AccountSeatService.java"))
                    .forEach(path -> {
                        try {
                            String content = Files.readString(path, StandardCharsets.UTF_8);
                            violations.addAll(findUnguardedCallsInSource(path.toString(), content));
                        } catch (IOException ex) {
                            throw new RuntimeException(ex);
                        }
                    });
        }
        assertThat(violations)
                .as("Ningún archivo de producción puede llamar assignWorkspaceMembership sin verificar permisos antes")
                .isEmpty();
    }

    @Test
    void architectureScannerDetectsUnguardedCallsAndAllowsExplicitlyGuardedCalls() {
        String unguarded = """
                public class UnsafeController {
                    private AccountSeatService seats;
                    public void addMember(UUID tenantId, UUID userId) {
                        seats.assignWorkspaceMembership(tenantId, userId, Role.ANALYST, userId);
                    }
                }
                """;
        assertThat(findUnguardedCallsInSource("UnsafeController.java", unguarded)).hasSize(1);

        String guarded = """
                public class SafeOrganizationService {
                    private AccountAccessService access;
                    private AccountSeatService seats;
                    public void addMember(OmegaPrincipal actor, UUID tenantId, UUID userId) {
                        access.requireManager(actor);
                        seats.assignWorkspaceMembership(tenantId, userId, Role.ANALYST, actor.userId());
                    }
                }
                """;
        assertThat(findUnguardedCallsInSource("SafeOrganizationService.java", guarded)).isEmpty();
    }

    @Test
    void noProductionCodeDeletesRowsFromWorkspaceMemberships() throws IOException {
        List<String> violations = new ArrayList<>();
        try (Stream<Path> files = Files.walk(Path.of("src/main"))) {
            files.filter(Files::isRegularFile)
                    .filter(path -> {
                        String name = path.getFileName().toString().toLowerCase();
                        return name.endsWith(".java") || name.endsWith(".sql") || name.endsWith(".xml")
                                || name.endsWith(".yml") || name.endsWith(".yaml") || name.endsWith(".properties");
                    })
                    .forEach(path -> {
                        try {
                            String content = Files.readString(path, StandardCharsets.UTF_8);
                            if (PHYSICAL_DELETE_MEMBERSHIP.matcher(content).find()) {
                                violations.add(path.toString());
                            }
                        } catch (IOException ex) {
                            throw new RuntimeException(ex);
                        }
                    });
        }
        assertThat(violations).isEmpty();
    }

    static List<String> findUnguardedCallsInSource(String fileName, String source) {
        List<String> violations = new ArrayList<>();
        String targetCall = ".assignWorkspaceMembership(";
        int idx = source.indexOf(targetCall);
        while (idx >= 0) {
            // Busca el encabezado del método contenedor hacia atrás y verifica que exista guardia explícita antes de la llamada
            int methodStart = Math.max(0, source.lastIndexOf("public ", idx));
            int protectedStart = source.lastIndexOf("protected ", idx);
            int privateStart = source.lastIndexOf("private ", idx);
            int blockStart = Math.max(methodStart, Math.max(protectedStart, privateStart));
            int annotationWindowStart = Math.max(0, blockStart - 220);
            String prefixBeforeCall = source.substring(annotationWindowStart, idx);
            if (!EXPLICIT_AUTH_GUARD.matcher(prefixBeforeCall).find()) {
                violations.add(fileName + "@" + idx + ": llamada a assignWorkspaceMembership sin guardia de autorización previa");
            }
            idx = source.indexOf(targetCall, idx + targetCall.length());
        }
        return violations;
    }
}
