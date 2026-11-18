package com.omega.platform.integration.forensic;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import com.omega.platform.ingest.UnsafeDocumentException;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.apache.commons.compress.archivers.zip.ZipArchiveEntry;
import org.apache.commons.compress.archivers.zip.ZipArchiveOutputStream;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream;
import org.apache.commons.compress.archivers.tar.TarConstants;
import org.junit.jupiter.api.Test;

class ArchiveSecurityValidatorTest {
    final ArchiveSecurityValidator validator = new ArchiveSecurityValidator();

    byte[] zip(String name, byte[] content, int mode) throws Exception {
        var output = new ByteArrayOutputStream();
        try (var zip = new ZipArchiveOutputStream(output)) {
            var entry = new ZipArchiveEntry(name);
            entry.setUnixMode(mode);
            zip.putArchiveEntry(entry);
            zip.write(content);
            zip.closeArchiveEntry();
        }
        return output.toByteArray();
    }

    @Test void rejectsSymlinksBombsAndTraversalIncludingNormalizedTraversal() throws Exception {
        for (String name : new String[] { "../history.json", "a/../history.json", "/etc/passwd", "C:\\history.json", "a/".repeat(17) + "history.json" }) {
            byte[] bytes = zip(name, "{}".getBytes(StandardCharsets.UTF_8), 0100644);
            assertThatThrownBy(() -> validator.validateArchiveBytes("evil.zip", bytes)).isInstanceOf(UnsafeDocumentException.class);
        }
        byte[] link = zip("link", "/etc/passwd".getBytes(StandardCharsets.UTF_8), 0120777);
        assertThatThrownBy(() -> validator.validateArchiveBytes("link.zip", link)).isInstanceOf(UnsafeDocumentException.class);
        byte[] bomb = zip("history.json", new byte[1_000_000], 0100644);
        assertThatThrownBy(() -> validator.validateArchiveBytes("bomb.zip", bomb)).isInstanceOf(UnsafeDocumentException.class);
        byte[] safe = zip("history.json", "{}".getBytes(StandardCharsets.UTF_8), 0100644);
        assertThatCode(() -> validator.validateArchiveBytes("safe.zip", safe)).doesNotThrowAnyException();
    }

    @Test void rejectsTarLinksBeforeForwarding() throws Exception {
        var output = new ByteArrayOutputStream();
        try (var tar = new TarArchiveOutputStream(output)) {
            var entry = new TarArchiveEntry("link", TarConstants.LF_SYMLINK);
            entry.setLinkName("/etc/passwd");
            tar.putArchiveEntry(entry);
            tar.closeArchiveEntry();
        }
        assertThatThrownBy(() -> validator.validateArchiveBytes("link.tar", output.toByteArray())).isInstanceOf(UnsafeDocumentException.class);
    }
}
