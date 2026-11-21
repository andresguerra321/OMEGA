package com.omega.platform.ingest;

import com.omega.platform.config.OmegaProperties;
import jakarta.annotation.PostConstruct;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class IngestTemporaryFiles {
    private static final Logger log = LoggerFactory.getLogger(IngestTemporaryFiles.class);
    private final Path ingestDir;
    private final Path multipartDir;
    private final Set<Path> active = ConcurrentHashMap.newKeySet();
    private final Set<Path> retry = ConcurrentHashMap.newKeySet();

    public IngestTemporaryFiles(OmegaProperties properties,
            @Value("${spring.servlet.multipart.location:${omega.ingest.temp-dir}/multipart}") String multipartDir) {
        this.ingestDir = Path.of(properties.ingest().tempDir()).toAbsolutePath().normalize();
        this.multipartDir = Path.of(multipartDir).toAbsolutePath().normalize();
    }

    @PostConstruct
    public void prepare() {
        try {
            Files.createDirectories(ingestDir);
            Files.createDirectories(multipartDir);
        } catch (Exception ex) {
            throw new IllegalStateException("INGEST_TEMP_UNAVAILABLE");
        }
    }

    public void register(Path path) { active.add(path.toAbsolutePath().normalize()); }

    public Instant purge(Path path) {
        Path normalized = path.toAbsolutePath().normalize();
        if (!normalized.getParent().equals(ingestDir) && !normalized.getParent().equals(multipartDir)) {
            throw new IllegalArgumentException("TEMP_PATH_OUTSIDE_MANAGED_DIRECTORY");
        }
        active.remove(normalized);
        try {
            Files.deleteIfExists(normalized);
            retry.remove(normalized);
            return Instant.now();
        } catch (Exception ex) {
            retry.add(normalized);
            log.error("INGEST_TEMP_DELETE_FAILED pending={}", retry.size());
            return null;
        }
    }

    @Scheduled(fixedDelay = 60000, initialDelay = 60000)
    public void sweep() {
        retry.stream().filter(path -> !active.contains(path)).forEach(this::purge);
        Instant cutoff = Instant.now().minus(24, ChronoUnit.HOURS);
        for (Path directory : java.util.List.of(ingestDir, multipartDir)) {
            try (var paths = Files.list(directory)) {
                paths.filter(path -> Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS))
                        .filter(path -> !active.contains(path.toAbsolutePath().normalize()))
                        .filter(path -> path.getFileName().toString().matches("[0-9a-fA-F-]{36}\\.pdf|upload_.*\\.tmp"))
                        .forEach(path -> {
                            try {
                                if (Files.getLastModifiedTime(path).toInstant().isBefore(cutoff)) purge(path);
                            } catch (Exception ex) { log.error("INGEST_TEMP_INSPECTION_FAILED"); }
                        });
            } catch (Exception ex) { log.error("INGEST_TEMP_SWEEP_FAILED"); }
        }
    }
}
