package com.omega.platform.multimodal;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.ingest.InvalidDocumentException;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import javax.imageio.ImageIO;
import org.springframework.stereotype.Component;

/**
 * Sanitizador de imágenes estrictamente en memoria RAM (Zero-Retention).
 * Valida magic bytes reales (PNG, JPEG, WebP), límites de tamaño/dimensiones,
 * calcula el SHA-256 original y re-codifica sin metadatos EXIF/GPS antes de analizar.
 */
@Component
public class ImageSecuritySanitizer {

    private final long maxImageBytes;
    private final int maxImageDimension;

    public ImageSecuritySanitizer(OmegaProperties properties) {
        this.maxImageBytes = properties.ingest().maxImageBytes();
        this.maxImageDimension = properties.ingest().maxImageDimension();
    }

    public SanitizedImage sanitize(byte[] rawBytes) {
        if (rawBytes == null || rawBytes.length == 0) {
            throw new InvalidDocumentException("La imagen está vacía o no se recibió contenido.");
        }
        if (rawBytes.length > maxImageBytes) {
            throw new InvalidDocumentException(
                    "La imagen excede el límite permitido (" + (maxImageBytes / (1024 * 1024)) + " MB)."
            );
        }

        String detectedFormat = detectMagicFormat(rawBytes);
        if (detectedFormat == null) {
            throw new InvalidDocumentException(
                    "Formato de imagen no válido o magic bytes alterados. Solo se aceptan PNG, JPEG o WebP."
            );
        }

        String sha256Hash = computeSha256Hex(rawBytes);

        if ("webp".equals(detectedFormat)) {
            BufferedImage decoded = tryDecodeImage(rawBytes);
            if (decoded != null) {
                return reencodeCleanPng(sha256Hash, decoded);
            }
            int[] dims = parseWebpDimensions(rawBytes);
            if (dims != null && (dims[0] > maxImageDimension || dims[1] > maxImageDimension)) {
                throw new InvalidDocumentException("Las dimensiones de la imagen superan el máximo permitido.");
            }
            return new SanitizedImage(
                    sha256Hash,
                    "image/webp",
                    dims != null ? dims[0] : 0,
                    dims != null ? dims[1] : 0,
                    rawBytes.clone(),
                    null
            );
        }

        BufferedImage decoded = tryDecodeImage(rawBytes);
        if (decoded == null) {
            throw new InvalidDocumentException("No se pudo decodificar la imagen; el archivo podría estar corrupto.");
        }
        return reencodeCleanPng(sha256Hash, decoded);
    }

    private SanitizedImage reencodeCleanPng(String sha256Hash, BufferedImage source) {
        int width = source.getWidth();
        int height = source.getHeight();
        if (width <= 0 || height <= 0 || width > maxImageDimension || height > maxImageDimension) {
            throw new InvalidDocumentException(
                    "Dimensiones de imagen inválidas o superiores a " + maxImageDimension + " px."
            );
        }

        // Redibuja en un lienzo limpio para eliminar metadatos EXIF/GPS/IPTC y posibles payloads embebidos
        BufferedImage clean = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = clean.createGraphics();
        try {
            g.drawImage(source, 0, 0, null);
        } finally {
            g.dispose();
        }

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try {
            ImageIO.write(clean, "png", baos);
        } catch (IOException ex) {
            throw new InvalidDocumentException("Error al re-codificar la imagen sanitizada en memoria.");
        }
        return new SanitizedImage(sha256Hash, "image/png", width, height, baos.toByteArray(), clean);
    }

    private static BufferedImage tryDecodeImage(byte[] bytes) {
        try {
            return ImageIO.read(new ByteArrayInputStream(bytes));
        } catch (IOException ex) {
            return null;
        }
    }

    static String detectMagicFormat(byte[] b) {
        if (b.length >= 8
                && (b[0] & 0xFF) == 0x89
                && b[1] == 0x50
                && b[2] == 0x4E
                && b[3] == 0x47
                && b[4] == 0x0D
                && b[5] == 0x0A
                && b[6] == 0x1A
                && b[7] == 0x0A) {
            return "png";
        }
        if (b.length >= 3
                && (b[0] & 0xFF) == 0xFF
                && (b[1] & 0xFF) == 0xD8
                && (b[2] & 0xFF) == 0xFF) {
            return "jpeg";
        }
        if (b.length >= 12
                && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') {
            return "webp";
        }
        return null;
    }

    private static int[] parseWebpDimensions(byte[] b) {
        if (b.length >= 30 && b[12] == 'V' && b[13] == 'P' && b[14] == '8' && b[15] == ' ') {
            int w = ((b[26] & 0xFF) | ((b[27] & 0xFF) << 8)) & 0x3FFF;
            int h = ((b[28] & 0xFF) | ((b[29] & 0xFF) << 8)) & 0x3FFF;
            if (w > 0 && h > 0) return new int[]{w, h};
        }
        return null;
    }

    private static String computeSha256Hex(byte[] bytes) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 no disponible", ex);
        }
    }

    public record SanitizedImage(
            String sha256Hash,
            String mimeType,
            int width,
            int height,
            byte[] sanitizedBytes,
            BufferedImage bufferedImage
    ) {
    }
}
