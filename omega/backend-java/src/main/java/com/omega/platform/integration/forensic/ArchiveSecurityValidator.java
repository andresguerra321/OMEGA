package com.omega.platform.integration.forensic;

import com.omega.platform.ingest.InvalidDocumentException;
import com.omega.platform.ingest.UnsafeDocumentException;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.zip.GZIPInputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.apache.commons.compress.archivers.zip.ZipFile;
import org.apache.commons.compress.utils.SeekableInMemoryByteChannel;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

/**
 * Guardia anti-Zip-Slip y anti-Bomba-de-Descompresión antes de reenviar artefactos
 * forenses en RAM al microservicio interno `omega/api`.
 */
@Component
public class ArchiveSecurityValidator {

    static final long MAX_SINGLE_FILE_BYTES = 64L * 1024 * 1024;
    static final long MAX_BATCH_UPLOAD_BYTES = 128L * 1024 * 1024;
    static final int MAX_ZIP_ENTRIES = 500;
    static final long MAX_SINGLE_UNCOMPRESSED_BYTES = 32L * 1024 * 1024;
    static final long MAX_TOTAL_UNCOMPRESSED_BYTES = 128L * 1024 * 1024;

    private static final Path VIRTUAL_ROOT = Path.of("/safe-root").toAbsolutePath().normalize();

    public void validateUploads(List<MultipartFile> files) {
        if (files == null || files.isEmpty()) {
            throw new InvalidDocumentException("Debe proporcionar al menos un artefacto forense.");
        }

        long batchBytes = 0;
        for (MultipartFile file : files) {
            if (file == null || file.isEmpty()) {
                throw new InvalidDocumentException("Se rechazó un archivo forense vacío.");
            }
            long size = file.getSize();
            if (size > MAX_SINGLE_FILE_BYTES) {
                throw new InvalidDocumentException("Artefacto excede el límite individual en RAM de 64MB.");
            }
            batchBytes += size;
            if (batchBytes > MAX_BATCH_UPLOAD_BYTES) {
                throw new InvalidDocumentException("El lote forense excede el límite agregado en RAM de 128MB.");
            }

            try {
                byte[] bytes = file.getBytes();
                validateArchiveBytes(file.getOriginalFilename(), bytes);
            } catch (IOException ex) {
                throw new InvalidDocumentException("No se pudo leer el artefacto forense en memoria.", ex);
            }
        }
    }

    public void validateArchiveBytes(String filename, byte[] bytes) {
        String lowerName = filename == null ? "" : filename.toLowerCase(Locale.ROOT);
        if (isZip(bytes, lowerName)) {
            validateZipStream(bytes);
        } else if (isGzip(bytes, lowerName)) {
            validateGzipStream(bytes, lowerName.endsWith(".tar.gz") || lowerName.endsWith(".tgz"));
        } else if (lowerName.endsWith(".tar")) {
            validateTarStream(new ByteArrayInputStream(bytes));
        }
    }

    private void validateZipStream(byte[] zipBytes) {
        int entryCount = 0;
        long totalUncompressed = 0;
        byte[] buffer = new byte[8192];

        // Central directory retains UNIX file modes, which ZipInputStream discards.
        try (ZipFile archive = ZipFile.builder().setSeekableByteChannel(new SeekableInMemoryByteChannel(zipBytes)).get()) {
            var entries = archive.getEntries();
            while (entries.hasMoreElements()) {
                var entry = entries.nextElement();
                verifySafeEntryName(entry.getName());
                if (entry.isUnixSymlink() || entry.getGeneralPurposeBit().usesEncryption()
                        || (entry.getUnixMode() & 0170000) != 0 && (entry.getUnixMode() & 0170000) != 0100000
                            && (entry.getUnixMode() & 0170000) != 0040000) {
                    throw new UnsafeDocumentException("Archivo ZIP bloqueado: enlace o entrada especial.");
                }
                if (entry.getSize() > Math.max(1, entry.getCompressedSize()) * 100L) {
                    throw new UnsafeDocumentException("Archivo ZIP bloqueado por bomba de descompresión (ratio).");
                }
            }
        } catch (IOException ex) {
            throw new InvalidDocumentException("Directorio ZIP corrupto.", ex);
        }
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (++entryCount > MAX_ZIP_ENTRIES) {
                    throw new UnsafeDocumentException("Archivo ZIP bloqueado: excede el máximo de " + MAX_ZIP_ENTRIES + " entradas.");
                }

                verifySafeEntryName(entry.getName());

                long entryBytes = 0;
                int read;
                while ((read = zis.read(buffer)) != -1) {
                    entryBytes += read;
                    totalUncompressed += read;
                    if (entryBytes > MAX_SINGLE_UNCOMPRESSED_BYTES || totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES
                            || totalUncompressed > Math.max(1, zipBytes.length) * 100L) {
                        throw new UnsafeDocumentException("Archivo ZIP bloqueado por sospecha de bomba de descompresión.");
                    }
                }
            }
        } catch (UnsafeDocumentException ex) {
            throw ex;
        } catch (IOException ex) {
            throw new InvalidDocumentException("Archivo ZIP corrupto o malformado.", ex);
        }
    }

    private void validateGzipStream(byte[] gzBytes, boolean tar) {
        long totalUncompressed = 0;
        byte[] buffer = new byte[8192];

        try (InputStream gis = new GZIPInputStream(new ByteArrayInputStream(gzBytes))) {
            int read;
            while ((read = gis.read(buffer)) != -1) {
                totalUncompressed += read;
                if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
                    throw new UnsafeDocumentException("Archivo GZIP/TGZ bloqueado por exceder el límite de expansión en RAM.");
                }
                if (totalUncompressed > Math.max(1, gzBytes.length) * 100L) {
                    throw new UnsafeDocumentException("Archivo GZIP bloqueado por ratio de expansión.");
                }
            }
        } catch (UnsafeDocumentException ex) {
            throw ex;
        } catch (IOException ex) {
            throw new InvalidDocumentException("Flujo GZIP corrupto o ilegible.", ex);
        }
        if (tar) {
            try {
                validateTarStream(new GZIPInputStream(new ByteArrayInputStream(gzBytes)));
            } catch (IOException ex) {
                throw new InvalidDocumentException("TAR/GZIP inválido.", ex);
            }
        }
    }

    private void validateTarStream(InputStream input) {
        long total = 0;
        int count = 0;
        byte[] buffer = new byte[8192];
        try (TarArchiveInputStream tar = new TarArchiveInputStream(input)) {
            org.apache.commons.compress.archivers.tar.TarArchiveEntry entry;
            while ((entry = tar.getNextEntry()) != null) {
                verifySafeEntryName(entry.getName());
                if (++count > MAX_ZIP_ENTRIES || !entry.isFile() && !entry.isDirectory()
                        || entry.isSymbolicLink() || entry.isLink() || entry.isSparse()
                        || entry.getSize() < 0 || entry.getSize() > MAX_SINGLE_UNCOMPRESSED_BYTES) {
                    throw new UnsafeDocumentException("Archivo TAR bloqueado: enlace, entrada especial o límite excedido.");
                }
                int read;
                while ((read = tar.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new UnsafeDocumentException("Bomba TAR bloqueada.");
                }
            }
        } catch (IOException ex) {
            throw new InvalidDocumentException("Archivo TAR corrupto.", ex);
        }
    }

    static void verifySafeEntryName(String rawName) {
        if (rawName == null || rawName.isBlank()) {
            throw new UnsafeDocumentException("Entrada ZIP sin nombre detectada.");
        }
        String normalizedSlashes = rawName.replace('\\', '/');
        String[] parts = normalizedSlashes.split("/", -1);
        if (parts.length > 16 || rawName.indexOf(0) >= 0 || java.util.Arrays.asList(parts).contains("..")) {
            throw new UnsafeDocumentException("Zip Slip bloqueado: traversal o profundidad excesiva.");
        }
        if (normalizedSlashes.startsWith("/") || normalizedSlashes.contains(":")) {
            throw new UnsafeDocumentException("Zip Slip bloqueado: ruta absoluta en entrada '" + rawName + "'.");
        }
        Path resolved = VIRTUAL_ROOT.resolve(normalizedSlashes).normalize();
        if (!resolved.startsWith(VIRTUAL_ROOT)) {
            throw new UnsafeDocumentException("Zip Slip bloqueado: escape de directorio detectado en '" + rawName + "'.");
        }
    }

    private static boolean isZip(byte[] bytes, String lowerName) {
        boolean magic = bytes.length >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4B && bytes[2] == 0x03 && bytes[3] == 0x04;
        return magic || lowerName.endsWith(".zip");
    }

    private static boolean isGzip(byte[] bytes, String lowerName) {
        boolean magic = bytes.length >= 2 && bytes[0] == (byte) 0x1F && bytes[1] == (byte) 0x8B;
        return magic || lowerName.endsWith(".gz") || lowerName.endsWith(".tgz");
    }
}
