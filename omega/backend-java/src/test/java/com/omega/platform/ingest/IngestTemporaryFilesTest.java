package com.omega.platform.ingest;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.omega.platform.config.OmegaProperties;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class IngestTemporaryFilesTest {
    @TempDir Path directory;

    @Test void sweepsOrphansPreservesActiveAndFreshFilesAndRetriesFailedDeletion() throws Exception {
        var properties = mock(OmegaProperties.class);
        when(properties.ingest()).thenReturn(new OmegaProperties.Ingest(directory.toString(), 1024, directory.toString()));
        var manager = new IngestTemporaryFiles(properties, directory.resolve("multipart").toString());
        manager.prepare();
        Path orphan = Files.writeString(directory.resolve(UUID.randomUUID() + ".pdf"), "synthetic");
        Path active = Files.writeString(directory.resolve(UUID.randomUUID() + ".pdf"), "synthetic");
        Path fresh = Files.writeString(directory.resolve(UUID.randomUUID() + ".pdf"), "synthetic");
        Path other = Files.writeString(directory.resolve("unrelated.txt"), "synthetic");
        Path multipart = Files.writeString(directory.resolve("multipart/upload_synthetic.tmp"), "synthetic");
        for (Path path : java.util.List.of(orphan, active, other, multipart))
            Files.setLastModifiedTime(path, FileTime.from(Instant.now().minus(2, ChronoUnit.DAYS)));
        manager.register(active);
        manager.sweep();
        assertThat(orphan).doesNotExist();
        assertThat(multipart).doesNotExist();
        assertThat(active).exists();
        assertThat(fresh).exists();
        assertThat(other).exists();
        assertThat(manager.purge(active)).isNotNull();
        assertThat(active).doesNotExist();
        Path failure = Files.createDirectory(directory.resolve(UUID.randomUUID() + ".pdf"));
        Path child = Files.writeString(failure.resolve("synthetic.txt"), "synthetic");
        assertThat(manager.purge(failure)).isNull();
        Files.delete(child);
        manager.sweep();
        assertThat(failure).doesNotExist();
        assertThatThrownBy(() -> manager.purge(directory.getParent().resolve("outside.pdf")))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
