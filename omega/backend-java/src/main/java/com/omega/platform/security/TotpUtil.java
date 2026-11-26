package com.omega.platform.security;

import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Pure Java RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30-second step) and Base32 helper.
 */
public final class TotpUtil {

    private static final String BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private static final String BACKUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int TIME_STEP_SECONDS = 30;
    private static final int CODE_DIGITS = 6;

    private TotpUtil() {
    }

    public static String generateSecret() {
        byte[] bytes = new byte[20];
        RANDOM.nextBytes(bytes);
        return encodeBase32(bytes);
    }

    public static String buildOtpAuthUri(String issuer, String accountEmail, String base32Secret) {
        String safeIssuer = urlEncode(issuer);
        String safeAccount = urlEncode(accountEmail);
        return "otpauth://totp/" + safeIssuer + ":" + safeAccount
                + "?secret=" + urlEncode(base32Secret)
                + "&issuer=" + safeIssuer
                + "&algorithm=SHA1&digits=6&period=30";
    }

    public static boolean verifyTotpCode(String base32Secret, String rawCode) {
        return findMatchingTotpBucket(base32Secret, rawCode, Instant.now()).isPresent();
    }

    public static java.util.OptionalLong findMatchingTotpBucket(String base32Secret, String rawCode, Instant now) {
        if (base32Secret == null || base32Secret.isBlank() || rawCode == null || now == null) {
            return java.util.OptionalLong.empty();
        }
        String code = rawCode.trim();
        if (!code.matches("^\\d{6}$")) {
            return java.util.OptionalLong.empty();
        }
        byte[] key = decodeBase32(base32Secret);
        long currentBucket = now.getEpochSecond() / TIME_STEP_SECONDS;
        for (long offset = -1; offset <= 1; offset++) {
            long candidateBucket = currentBucket + offset;
            String candidate = generateCodeForBucket(key, candidateBucket);
            if (MessageDigest.isEqual(
                    candidate.getBytes(StandardCharsets.UTF_8),
                    code.getBytes(StandardCharsets.UTF_8))) {
                return java.util.OptionalLong.of(candidateBucket);
            }
        }
        return java.util.OptionalLong.empty();
    }

    public static String generateTotpCodeAt(String base32Secret, Instant instant) {
        byte[] key = decodeBase32(base32Secret);
        long bucket = instant.getEpochSecond() / TIME_STEP_SECONDS;
        return generateCodeForBucket(key, bucket);
    }

    public static String generateNumericOtp6() {
        int val = RANDOM.nextInt(900_000) + 100_000;
        return String.valueOf(val);
    }

    public static List<String> generateBackupCodes(int count) {
        List<String> codes = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            StringBuilder sb = new StringBuilder(9);
            for (int j = 0; j < 8; j++) {
                if (j == 4) {
                    sb.append('-');
                }
                sb.append(BACKUP_ALPHABET.charAt(RANDOM.nextInt(BACKUP_ALPHABET.length())));
            }
            codes.add(sb.toString());
        }
        return codes;
    }

    private static final String ENC_PREFIX = "enc:v1:";
    private static final int GCM_IV_BYTES = 12;
    private static final int GCM_TAG_BITS = 128;

    public static byte[] deriveAes256Key(String masterSecret) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return md.digest((masterSecret + "|omega:mfa:totp:at-rest:v1").getBytes(StandardCharsets.UTF_8));
        } catch (Exception ex) {
            throw new IllegalStateException("SHA-256 unavailable", ex);
        }
    }

    public static String encryptAtRest(String plaintext, byte[] aesKey256) {
        if (plaintext == null || plaintext.isBlank()) {
            return plaintext;
        }
        try {
            byte[] iv = new byte[GCM_IV_BYTES];
            RANDOM.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(aesKey256, "AES"), new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] combined = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);
            return ENC_PREFIX + Base64.getEncoder().encodeToString(combined);
        } catch (Exception ex) {
            throw new IllegalStateException("Error cifrando secreto TOTP en reposo", ex);
        }
    }

    public static String decryptAtRest(String stored, byte[] aesKey256) {
        if (stored == null || stored.isBlank()) {
            return stored;
        }
        if (!stored.startsWith(ENC_PREFIX)) {
            return stored;
        }
        try {
            byte[] combined = Base64.getDecoder().decode(stored.substring(ENC_PREFIX.length()));
            byte[] iv = new byte[GCM_IV_BYTES];
            byte[] ciphertext = new byte[combined.length - GCM_IV_BYTES];
            System.arraycopy(combined, 0, iv, 0, GCM_IV_BYTES);
            System.arraycopy(combined, GCM_IV_BYTES, ciphertext, 0, ciphertext.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(aesKey256, "AES"), new GCMParameterSpec(GCM_TAG_BITS, iv));
            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (Exception ex) {
            throw new IllegalStateException("Error descifrando secreto TOTP en reposo", ex);
        }
    }

    public static String sha256Hex(String value) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception ex) {
            throw new IllegalStateException("SHA-256 unavailable", ex);
        }
    }

    private static String generateCodeForBucket(byte[] secretKey, long bucket) {
        try {
            byte[] data = ByteBuffer.allocate(8).putLong(bucket).array();
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(secretKey, "HmacSHA1"));
            byte[] hash = mac.doFinal(data);
            int offset = hash[hash.length - 1] & 0x0F;
            int binary = ((hash[offset] & 0x7F) << 24)
                    | ((hash[offset + 1] & 0xFF) << 16)
                    | ((hash[offset + 2] & 0xFF) << 8)
                    | (hash[offset + 3] & 0xFF);
            int otp = binary % (int) Math.pow(10, CODE_DIGITS);
            return String.format(Locale.ROOT, "%06d", otp);
        } catch (Exception ex) {
            throw new IllegalStateException("Failed to compute TOTP", ex);
        }
    }

    private static String encodeBase32(byte[] data) {
        StringBuilder out = new StringBuilder((data.length * 8 + 4) / 5);
        int buffer = data[0];
        int next = 1;
        int bitsLeft = 8;
        while (bitsLeft > 0 || next < data.length) {
            if (bitsLeft < 5) {
                if (next < data.length) {
                    buffer <<= 8;
                    buffer |= (data[next++] & 0xFF);
                    bitsLeft += 8;
                } else {
                    int pad = 5 - bitsLeft;
                    buffer <<= pad;
                    bitsLeft += pad;
                }
            }
            int index = 0x1F & (buffer >> (bitsLeft - 5));
            bitsLeft -= 5;
            out.append(BASE32_ALPHABET.charAt(index));
        }
        return out.toString();
    }

    private static byte[] decodeBase32(String raw) {
        String clean = raw.trim().replace("=", "").replace(" ", "").toUpperCase(Locale.ROOT);
        int byteCount = (clean.length() * 5) / 8;
        byte[] result = new byte[byteCount];
        int buffer = 0;
        int bitsLeft = 0;
        int count = 0;
        for (int i = 0; i < clean.length(); i++) {
            int val = BASE32_ALPHABET.indexOf(clean.charAt(i));
            if (val < 0) {
                throw new IllegalArgumentException("Invalid Base32 character in TOTP secret");
            }
            buffer <<= 5;
            buffer |= val & 0x1F;
            bitsLeft += 5;
            if (bitsLeft >= 8) {
                result[count++] = (byte) ((buffer >> (bitsLeft - 8)) & 0xFF);
                bitsLeft -= 8;
            }
        }
        return result;
    }

    private static String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
