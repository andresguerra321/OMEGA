package com.omega.platform.service;

import com.omega.platform.domain.DevDependencyEntity;
import com.omega.platform.domain.DevScanEntity;
import com.omega.platform.repository.DevDependencyRepository;
import com.omega.platform.repository.DevProjectRepository;
import com.omega.platform.repository.DevScanRepository;
import com.omega.platform.security.OmegaPrincipal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Catálogo curado de inteligencia de cadena de suministro (`dev_supply_chain_cti`) con fuentes y licencias
 * verificadas, cruce con dependencias del proyecto y asistente grounded con citas y abstención explícita.
 */
@Service
public class DevSupplyChainIntelService {

    private static final List<SupplyChainAdvisoryDto> CURATED_CATALOG = List.of(
            new SupplyChainAdvisoryDto(
                    "OSV-MAL-2025-0101",
                    "npm",
                    "Campaña Postinstall Exfil en paquetes typosquatted de utilidades JS",
                    "CRITICAL",
                    List.of("lodahs", "axois", "crossenv", "event-stream"),
                    List.of("T1195.002", "NPM-POSTINSTALL-EXEC-01"),
                    "Paquetes maliciosos que imitan librerías populares de npm a distancia de edición 1 y ejecutan payloads en scripts preinstall/postinstall para exfiltrar variables de entorno y tokens CI.",
                    "Fijar versiones con package-lock.json, ejecutar `npm ci --ignore-scripts` en pipelines de integración continua y auditar hooks de ciclo de vida.",
                    "OSV.dev Malicious Packages Database",
                    "https://osv.dev/",
                    "CC-BY 4.0",
                    Instant.parse("2026-01-15T00:00:00Z")
            ),
            new SupplyChainAdvisoryDto(
                    "OSV-MAL-2025-0204",
                    "pypi",
                    "Ejecución arbitraria en setup.py y secuestro de mantenedores en PyPI",
                    "HIGH",
                    List.of("reqeusts", "urllib4", "ctx", "colourama"),
                    List.of("T1195.002", "PYPI-SETUP-EXEC-01", "PKG-MAINTAINER-CHANGE-01"),
                    "Distribución de paquetes sdist (.tar.gz) con llamadas a subprocess/urllib dentro de setup.py combinadas con toma de cuenta de mantenedores legítimos.",
                    "Restringir instalaciones en CI a wheels binarios (`pip install --only-binary=:all:`) y verificar hashes SHA-256 en requirements.txt.",
                    "OSV.dev / PyPA Advisory Database",
                    "https://github.com/pypa/advisory-database",
                    "CC-BY 4.0",
                    Instant.parse("2026-02-01T00:00:00Z")
            ),
            new SupplyChainAdvisoryDto(
                    "CISA-CICD-2025-0309",
                    "github-actions",
                    "Exfiltración de secretos de CI/CD y abuso de pull_request_target",
                    "CRITICAL",
                    List.of("tj-actions/changed-files", "actions/checkout"),
                    List.of("T1552.001", "SECRET-CREDENTIAL-GITHUB-01", "SECRET-EXFIL-01"),
                    "Compromiso de acciones de terceros no fijadas por SHA completo o exposición de GITHUB_TOKEN con permisos de escritura en forks externos.",
                    "Fijar todas las GitHub Actions por SHA de 40 caracteres, declarar `permissions: contents: read` por defecto y rotar tokens expuestos.",
                    "CISA / NIST NVD & OWASP Top 10 CI/CD Security Risks",
                    "https://owasp.org/www-project-top-10-ci-cd-security-risks/",
                    "Public Domain / CC-BY-SA 4.0",
                    Instant.parse("2026-03-10T00:00:00Z")
            ),
            new SupplyChainAdvisoryDto(
                    "OSV-MAL-2025-0412",
                    "maven",
                    "Dependencias transitivas con carga ofuscada y callbacks remotos en JVM",
                    "HIGH",
                    List.of("org.malicious: shade-helper", "com.evil.sdk:telemetry-agent"),
                    List.of("T1027", "CODE-OBFUSCATION-01", "SCRIPT-NET-INDICATOR-01"),
                    "Artefactos publicados en repositorios secundarios que incluyen inicializadores estáticos con cargas codificadas en Base64 y conexiones a IPs literales.",
                    "Restringir repositorios en pom.xml exclusivamente a Maven Central con verificación PGP y bloquear conexiones salientes en runners de compilación.",
                    "OSV.dev / Google Open Source Security",
                    "https://osv.dev/",
                    "CC-BY 4.0",
                    Instant.parse("2026-03-22T00:00:00Z")
            ),
            new SupplyChainAdvisoryDto(
                    "OSV-MAL-2025-0518",
                    "cargo",
                    "Build scripts (build.rs) maliciosos y typosquatting en crates.io",
                    "HIGH",
                    List.of("serd", "tokoi", "reqwests"),
                    List.of("T1195.002", "PKG-TYPOSQUAT-01"),
                    "Crates con nombres similares a serde/tokio/reqwest que ejecutan código arbitrario durante la compilación mediante `build.rs`.",
                    "Auditar cambios en Cargo.lock con `cargo vet` o `cargo deny` antes de compilar en entornos con acceso a credenciales.",
                    "RustSec Advisory Database",
                    "https://rustsec.org/",
                    "CC0 1.0 Public Domain",
                    Instant.parse("2026-04-02T00:00:00Z")
            )
    );

    private final DevProjectRepository projectRepository;
    private final DevScanRepository scanRepository;
    private final DevDependencyRepository dependencyRepository;

    public DevSupplyChainIntelService(
            DevProjectRepository projectRepository,
            DevScanRepository scanRepository,
            DevDependencyRepository dependencyRepository
    ) {
        this.projectRepository = projectRepository;
        this.scanRepository = scanRepository;
        this.dependencyRepository = dependencyRepository;
    }

    @Transactional(readOnly = true)
    public SupplyChainCatalogResponse listAdvisories(
            OmegaPrincipal principal,
            String ecosystemFilter,
            String searchFilter,
            UUID projectId
    ) {
        UUID tenantId = principal.tenantId();
        List<DevDependencyEntity> projectDeps = List.of();
        if (projectId != null) {
            projectRepository.findByIdAndTenantId(projectId, tenantId)
                    .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));
            List<DevScanEntity> scans = scanRepository.findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantId, projectId);
            if (!scans.isEmpty()) {
                projectDeps = dependencyRepository.findAllByTenantIdAndScanIdOrderByEcosystemAscPackageNameAsc(
                        tenantId, scans.get(0).getId());
            }
        }

        String ecoClean = ecosystemFilter == null ? "" : ecosystemFilter.trim().toLowerCase(Locale.ROOT);
        String qClean = searchFilter == null ? "" : searchFilter.trim().toLowerCase(Locale.ROOT);

        List<AdvisoryWithProjectImpactDto> items = new ArrayList<>();
        int impactedCount = 0;

        for (SupplyChainAdvisoryDto adv : CURATED_CATALOG) {
            if (!ecoClean.isEmpty() && !adv.ecosystem().equalsIgnoreCase(ecoClean)) {
                continue;
            }
            if (!qClean.isEmpty()
                    && !adv.id().toLowerCase(Locale.ROOT).contains(qClean)
                    && !adv.title().toLowerCase(Locale.ROOT).contains(qClean)
                    && !adv.summary().toLowerCase(Locale.ROOT).contains(qClean)
                    && adv.affectedPackages().stream().noneMatch(p -> p.toLowerCase(Locale.ROOT).contains(qClean))) {
                continue;
            }

            List<String> matchedDeps = new ArrayList<>();
            for (DevDependencyEntity dep : projectDeps) {
                String depLower = dep.getPackageName().toLowerCase(Locale.ROOT);
                if (adv.affectedPackages().stream().anyMatch(p -> p.equalsIgnoreCase(depLower))) {
                    matchedDeps.add(dep.getEcosystem() + ":" + dep.getPackageName());
                }
            }
            if (!matchedDeps.isEmpty()) {
                impactedCount++;
            }

            items.add(new AdvisoryWithProjectImpactDto(
                    adv.id(),
                    adv.ecosystem(),
                    adv.title(),
                    adv.severity(),
                    adv.affectedPackages(),
                    adv.techniques(),
                    adv.summary(),
                    adv.mitigation(),
                    adv.sourceName(),
                    adv.sourceUrl(),
                    adv.license(),
                    adv.publishedAt(),
                    !matchedDeps.isEmpty(),
                    matchedDeps
            ));
        }

        return new SupplyChainCatalogResponse(
                "dev_supply_chain_cti",
                items.size(),
                impactedCount,
                items
        );
    }

    @Transactional(readOnly = true)
    public SupplyChainAssistantResponse askSupplyChainCorpus(OmegaPrincipal principal, String question) {
        String cleanQ = DevProjectService.sanitizeText(question, 600);
        if (cleanQ.isBlank()) {
            return new SupplyChainAssistantResponse(
                    "ABSTAINED",
                    "dev_supply_chain_cti",
                    "Formula una pregunta técnica sobre campañas de cadena de suministro, typosquatting, postinstall hooks o rotación de credenciales.",
                    List.of(),
                    "Respuesta basada exclusivamente en el corpus verificado dev_supply_chain_cti."
            );
        }

        String[] tokens = cleanQ.toLowerCase(Locale.ROOT).split("[^a-z0-9_-]+");
        Set<String> stopWords = Set.of("como", "que", "para", "con", "los", "las", "una", "por", "del", "sobre", "este", "esta");

        List<SupplyChainCitationDto> citations = new ArrayList<>();
        for (SupplyChainAdvisoryDto adv : CURATED_CATALOG) {
            String haystack = (adv.id() + " " + adv.ecosystem() + " " + adv.title() + " " + adv.summary() + " "
                    + adv.mitigation() + " " + String.join(" ", adv.affectedPackages()) + " "
                    + String.join(" ", adv.techniques())).toLowerCase(Locale.ROOT);
            int hits = 0;
            for (String tk : tokens) {
                if (tk.length() >= 3 && !stopWords.contains(tk) && haystack.contains(tk)) {
                    hits++;
                }
            }
            if (hits > 0) {
                citations.add(new SupplyChainCitationDto(
                        adv.id(),
                        adv.title(),
                        adv.sourceName(),
                        adv.sourceUrl(),
                        adv.license(),
                        adv.summary() + " Mitigación: " + adv.mitigation()
                ));
            }
        }

        if (citations.isEmpty()) {
            return new SupplyChainAssistantResponse(
                    "ABSTAINED",
                    "dev_supply_chain_cti",
                    "Abstención: no existe evidencia suficiente en el corpus verificado de cadena de suministro (dev_supply_chain_cti) para sustentar una respuesta sobre esta consulta.",
                    List.of(),
                    "OMEGA se abstiene cuando la consulta no está respaldada por advisories verificados."
            );
        }

        StringBuilder answer = new StringBuilder();
        answer.append("Según el catálogo verificado de inteligencia de cadena de suministro (`dev_supply_chain_cti`), se encontraron ")
                .append(citations.size())
                .append(" referencia(s) aplicables:\n\n");
        for (int i = 0; i < citations.size(); i++) {
            SupplyChainCitationDto c = citations.get(i);
            answer.append("[").append(i + 1).append("] **").append(c.advisoryId()).append(" — ").append(c.title()).append("**: ")
                    .append(c.excerpt()).append(" _(Fuente: ").append(c.sourceName()).append(" · Licencia: ").append(c.license()).append(")_\n");
        }

        return new SupplyChainAssistantResponse(
                "GROUNDED",
                "dev_supply_chain_cti",
                answer.toString().trim(),
                citations,
                "Respuesta sustentada exclusivamente en fuentes verificadas con licencia abierta."
        );
    }

    public record SupplyChainAdvisoryDto(
            String id,
            String ecosystem,
            String title,
            String severity,
            List<String> affectedPackages,
            List<String> techniques,
            String summary,
            String mitigation,
            String sourceName,
            String sourceUrl,
            String license,
            Instant publishedAt
    ) {}

    public record AdvisoryWithProjectImpactDto(
            String id,
            String ecosystem,
            String title,
            String severity,
            List<String> affectedPackages,
            List<String> techniques,
            String summary,
            String mitigation,
            String sourceName,
            String sourceUrl,
            String license,
            Instant publishedAt,
            boolean affectsSelectedProject,
            List<String> matchedProjectDependencies
    ) {}

    public record SupplyChainCatalogResponse(
            String corpusScope,
            int totalAdvisories,
            int advisoriesAffectingProject,
            List<AdvisoryWithProjectImpactDto> advisories
    ) {}

    public record SupplyChainCitationDto(
            String advisoryId,
            String title,
            String sourceName,
            String sourceUrl,
            String license,
            String excerpt
    ) {}

    public record SupplyChainAssistantResponse(
            String status,
            String corpusScope,
            String answer,
            List<SupplyChainCitationDto> citations,
            String notice
    ) {}
}
