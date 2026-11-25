package com.omega.platform.service;

import java.util.ArrayList;
import java.util.List;
import java.net.URI;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.web.util.HtmlUtils;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mail.javamail.MimeMessageHelper;

/**
 * Plantilla HTML transaccional unificada de OMEGA (nivel Stripe / Linear / Apple).
 * - Layout basado en tablas con CSS inline para compatibilidad en Gmail, Apple Mail y Outlook.
 * - Modo claro por defecto (#F6F8FA / #FFFFFF) con soporte nativo de modo oscuro vía
 *   {@code @media (prefers-color-scheme: dark)} (#090B10 / #11151E).
 * - Sin banner 3D, sin imágenes remotas y con escape HTML estricto en todos los campos.
 */
public final class OmegaEmailTemplate {

    private static final String DEFAULT_SECURITY_NOTE =
            "Consulta el detalle directamente desde tu cuenta en OMEGA. "
                    + "Nunca compartas tus códigos de verificación ni tu contraseña.";

    private static final String FONT_SANS =
            "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";
    private static final String FONT_MONO =
            "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

    private static final Pattern METADATA_LINE_PATTERN =
            Pattern.compile("^([\\p{L}0-9][\\p{L}0-9\\s/().-]{1,32}):\\s+(.+)$");

    private OmegaEmailTemplate() {
    }

    public record MetadataRow(String label, String value) {
    }

    public record Spec(
            String title,
            String preheader,
            List<String> paragraphs,
            List<MetadataRow> metadataRows,
            String verificationCode,
            String codeCaption,
            String ctaLabel,
            String ctaUrl,
            String securityNote,
            String recipientEmail,
            String supportEmail
    ) {
        public static Builder builder(String title) {
            return new Builder(title);
        }
    }

    public static final class Builder {
        private final String title;
        private String preheader;
        private final List<String> paragraphs = new ArrayList<>();
        private final List<MetadataRow> metadataRows = new ArrayList<>();
        private String verificationCode;
        private String codeCaption;
        private String ctaLabel;
        private String ctaUrl;
        private String securityNote = DEFAULT_SECURITY_NOTE;
        private String recipientEmail;
        private String supportEmail;

        private Builder(String title) {
            this.title = title == null ? "" : title.trim();
        }

        public Builder preheader(String preheader) {
            this.preheader = preheader;
            return this;
        }

        public Builder addParagraph(String paragraph) {
            if (paragraph != null && !paragraph.isBlank()) {
                this.paragraphs.add(paragraph.trim());
            }
            return this;
        }

        public Builder addMetadata(String label, String value) {
            if (label != null && !label.isBlank() && value != null && !value.isBlank()) {
                this.metadataRows.add(new MetadataRow(label.trim(), value.trim()));
            }
            return this;
        }

        public Builder verificationCode(String code, String caption) {
            this.verificationCode = code;
            this.codeCaption = caption;
            return this;
        }

        public Builder cta(String label, String url) {
            this.ctaLabel = label;
            this.ctaUrl = url;
            return this;
        }

        public Builder securityNote(String note) {
            if (note != null && !note.isBlank()) {
                this.securityNote = note.trim();
            }
            return this;
        }

        public Builder recipientEmail(String email) {
            this.recipientEmail = email;
            return this;
        }

        public Builder supportEmail(String email) {
            this.supportEmail = email;
            return this;
        }

        public Spec build() {
            return new Spec(
                    title,
                    preheader,
                    List.copyOf(paragraphs),
                    List.copyOf(metadataRows),
                    verificationCode,
                    codeCaption,
                    ctaLabel,
                    ctaUrl,
                    securityNote,
                    recipientEmail,
                    supportEmail
            );
        }

        public String render() {
            return OmegaEmailTemplate.render(build());
        }
    }

    /**
     * Renderiza un correo genérico en cola (subject + texto plano con párrafos y posibles filas "Clave: Valor").
     */
    public static String renderPlainBody(String subject, String body, String recipientEmail) {
        return renderPlainBody(subject,body,recipientEmail,null);
    }

    public static String renderPlainBody(String subject,String body,String recipientEmail,String supportEmail) {
        String cleanTitle = stripBrandPrefix(subject);
        Builder builder = Spec.builder(cleanTitle).recipientEmail(recipientEmail).supportEmail(supportEmail);
        String safeBody = body == null ? "" : body.trim();
        if (!safeBody.isEmpty()) {
            String[] blocks = safeBody.split("\\R\\s*\\R");
            for (String block : blocks) {
                String trimmedBlock = block.trim();
                if (trimmedBlock.isEmpty()) continue;
                String[] lines = trimmedBlock.split("\\R");
                List<MetadataRow> detectedRows = new ArrayList<>();
                boolean allMetadata = lines.length >= 2;
                if (allMetadata) {
                    for (String line : lines) {
                        Matcher m = METADATA_LINE_PATTERN.matcher(line.trim());
                        if (m.matches() && !m.group(2).startsWith("//")) {
                            detectedRows.add(new MetadataRow(m.group(1).trim(), m.group(2).trim()));
                        } else {
                            allMetadata = false;
                            break;
                        }
                    }
                }
                if (allMetadata && !detectedRows.isEmpty()) {
                    for (MetadataRow row : detectedRows) {
                        builder.addMetadata(row.label(), row.value());
                    }
                } else {
                    builder.addParagraph(trimmedBlock);
                }
            }
        }
        return builder.render();
    }

    public static String stripBrandPrefix(String subject) {
        if (subject == null) return "";
        return subject.replaceFirst("^OMEGA\\s*[·—-]\\s*", "").trim();
    }

    public static void attachMark(MimeMessageHelper helper) throws jakarta.mail.MessagingException {
        helper.addInline("omegaMark",new ClassPathResource("mail/omega-mark.png"),"image/png");
    }

    public static String render(Spec spec) {
        String safeTitle = HtmlUtils.htmlEscape(spec.title() == null ? "" : spec.title());
        String preheaderRaw = spec.preheader() != null && !spec.preheader().isBlank()
                ? spec.preheader().trim()
                : (!spec.paragraphs().isEmpty() ? spec.paragraphs().getFirst() : spec.title());
        String safePreheader = HtmlUtils.htmlEscape(truncate(preheaderRaw, 140));

        StringBuilder paragraphsHtml = new StringBuilder();
        for (String p : spec.paragraphs()) {
            String escaped = HtmlUtils.htmlEscape(p).replace("\r\n", "\n").replace("\n", "<br>");
            paragraphsHtml.append(
                    "<p class=\"omega-text-secondary\" style=\"margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#475569;overflow-wrap:anywhere;\">"
            ).append(escaped).append("</p>");
        }

        String summarySlot = renderSummarySlot(spec);
        String ctaSlot = renderCtaSlot(spec);
        String safeSecurityNote = HtmlUtils.htmlEscape(
                spec.securityNote() == null || spec.securityNote().isBlank()
                        ? DEFAULT_SECURITY_NOTE
                        : spec.securityNote()
        );

        String reasonLine = (spec.recipientEmail() != null && !spec.recipientEmail().isBlank())
                ? "Recibes este correo por actividad en tu cuenta " + HtmlUtils.htmlEscape(spec.recipientEmail().trim()) + "."
                : "Recibes este correo por actividad en tu cuenta de OMEGA.";

        String supportLink="";
        try {
            var contact=new jakarta.mail.internet.InternetAddress(spec.supportEmail(),true);
            contact.validate();
            supportLink="<a class=\"omega-text-muted\" href=\"mailto:"+HtmlUtils.htmlEscape(contact.getAddress())+"\" style=\"color:#64748B;text-decoration:underline;\">Soporte y seguridad</a>";
        } catch(Exception ignored) { /* A missing contact must not create a broken email link. */ }

        return """
                <!DOCTYPE html>
                <html lang="es" xmlns="http://www.w3.org/1999/xhtml">
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width,initial-scale=1.0">
                  <meta name="color-scheme" content="light dark">
                  <meta name="supported-color-schemes" content="light dark">
                  <title>%s</title>
                  <style>
                    :root { color-scheme: light dark; supported-color-schemes: light dark; }
                    @media only screen and (max-width: 600px) {
                      .omega-card-pad { padding: 24px 20px !important; }
                    }
                    @media (prefers-color-scheme: dark) {
                      body, .omega-bg { background-color: #090B10 !important; color: #F1F5F9 !important; }
                      .omega-card { background-color: #11151E !important; border-color: #1F2633 !important; }
                      .omega-brand-mark { background-color: #161B26 !important; border-color: #273042 !important; color: #F1F5F9 !important; }
                      .omega-text-primary { color: #F1F5F9 !important; }
                      .omega-text-secondary { color: #94A3B8 !important; }
                      .omega-text-muted { color: #94A3B8 !important; }
                      .omega-divider { border-top-color: #1F2633 !important; }
                      .omega-box { background-color: #161B26 !important; border-color: #1F2633 !important; }
                      .omega-row-sep { border-bottom-color: #1F2633 !important; }
                    }
                    [data-ogsc] .omega-bg { background-color:#090B10!important; }
                    [data-ogsc] .omega-card { background-color:#11151E!important;border-color:#1F2633!important; }
                    [data-ogsc] .omega-text-primary { color:#F1F5F9!important; }
                    [data-ogsc] .omega-text-secondary,[data-ogsc] .omega-text-muted { color:#94A3B8!important; }
                    [data-ogsc] .omega-divider { border-top-color:#1F2633!important; }
                    [data-ogsc] .omega-box { background-color:#161B26!important;border-color:#1F2633!important; }
                  </style>
                </head>
                <body class="omega-bg" style="margin:0;padding:0;background-color:#F6F8FA;font-family:%s;color:#0F172A;-webkit-font-smoothing:antialiased;">
                  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:transparent;">%s&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
                  <table role="presentation" class="omega-bg" width="100%%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F6F8FA;table-layout:fixed;">
                    <tr>
                      <td class="omega-outer-pad" align="center" style="padding:32px 16px;">
                        <!--[if mso]><table role="presentation" width="540" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
                        <table role="presentation" class="omega-card" width="540" cellpadding="0" cellspacing="0" border="0" style="width:100%%;max-width:540px;background-color:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;table-layout:fixed;">
                          <tr>
                            <td class="omega-card-pad" style="padding:32px 36px;">
                              <!-- Cabecera minimalista alineada a la izquierda -->
                              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                  <td valign="middle" width="24" height="24" style="width:24px;height:24px;font-family:%s;"><img src="cid:omegaMark" alt="Ω" width="24" height="24" style="display:block;width:24px;height:24px;border:0;"></td>
                                  <td style="padding-left:10px;font-size:14px;font-weight:600;letter-spacing:0.08em;line-height:24px;color:#0F172A;" class="omega-text-primary">OMEGA</td>
                                </tr>
                              </table>
                              <!-- Divisor hairline cabecera (margin: 20px 0 28px) -->
                              <div style="height:20px;line-height:20px;font-size:1px;">&nbsp;</div>
                              <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0">
                                <tr><td class="omega-divider" style="padding:0;height:1px;line-height:1px;font-size:1px;border-top:1px solid #E5E7EB;">&nbsp;</td></tr>
                              </table>
                              <div style="height:28px;line-height:28px;font-size:1px;">&nbsp;</div>
                              <!-- Título y cuerpo -->
                              <h1 class="omega-text-primary" style="margin:0 0 14px 0;font-size:20px;font-weight:600;letter-spacing:-0.02em;line-height:1.3;color:#0F172A;overflow-wrap:anywhere;">%s</h1>
                              %s
                              %s
                              %s
                              <!-- Separador y nota de seguridad -->
                              <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
                                <tr><td class="omega-divider omega-text-secondary" style="padding-top:18px;border-top:1px solid #E5E7EB;font-size:12px;line-height:1.5;color:#475569;">%s</td></tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                        <!--[if mso]></td></tr></table><![endif]-->
                        <!-- Footer discreto al pie de la tarjeta -->
                        <table role="presentation" width="540" cellpadding="0" cellspacing="0" border="0" style="width:100%%;max-width:540px;">
                          <tr>
                            <td class="omega-text-muted" style="padding:18px 8px 0 8px;font-size:11px;line-height:1.6;color:#64748B;text-align:left;overflow-wrap:anywhere;word-break:break-word;">
                              <strong class="omega-text-muted" style="font-weight:600;color:#64748B;">OMEGA</strong> · Análisis, evidencia e informes<br>
                              %s<br>
                              %s
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </body>
                </html>
                """.formatted(
                safeTitle,
                FONT_SANS,
                safePreheader,
                FONT_SANS,
                safeTitle,
                paragraphsHtml.toString(),
                summarySlot,
                ctaSlot,
                safeSecurityNote,
                reasonLine,
                supportLink
        );
    }

    private static String renderSummarySlot(Spec spec) {
        boolean hasCode = spec.verificationCode() != null && !spec.verificationCode().isBlank();
        boolean hasRows = spec.metadataRows() != null && !spec.metadataRows().isEmpty();
        if (!hasCode && !hasRows) return "";

        StringBuilder inner = new StringBuilder();
        if (hasCode) {
            String safeCode = HtmlUtils.htmlEscape(spec.verificationCode().trim());
            boolean isShortOtp = safeCode.length() <= 10;
            String codeFontSize = isShortOtp ? "28px" : "15px";
            String codeSpacing = isShortOtp ? "0.25em" : "0.04em";
            inner.append("<div class=\"omega-text-primary\" style=\"text-align:center;font-family:")
                    .append(FONT_MONO)
                    .append(";font-size:")
                    .append(codeFontSize)
                    .append(";font-weight:600;letter-spacing:")
                    .append(codeSpacing)
                    .append(";line-height:1.3;color:#0F172A;word-break:break-all;\">")
                    .append(safeCode)
                    .append("</div>");
            if (spec.codeCaption() != null && !spec.codeCaption().isBlank()) {
                inner.append("<div class=\"omega-text-muted\" style=\"margin-top:8px;text-align:center;font-size:12px;line-height:1.4;color:#64748B;\">")
                        .append(HtmlUtils.htmlEscape(spec.codeCaption().trim()))
                        .append("</div>");
            }
        }

        if (hasRows) {
            if (hasCode) {
                inner.append("<div style=\"height:14px;line-height:14px;font-size:1px;\">&nbsp;</div>");
            }
            inner.append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"table-layout:fixed;\">");
            int total = spec.metadataRows().size();
            for (int i = 0; i < total; i++) {
                MetadataRow row = spec.metadataRows().get(i);
                String borderBottom = (i < total - 1) ? "border-bottom:1px solid #E5E7EB;" : "";
                String rowClass = (i < total - 1) ? " class=\"omega-row-sep omega-text-secondary\"" : " class=\"omega-text-secondary\"";
                inner.append("<tr>")
                        .append("<td").append(rowClass)
                        .append(" style=\"padding:6px 8px 6px 0;font-size:12px;line-height:1.5;color:#64748B;vertical-align:top;").append(borderBottom).append("\">")
                        .append(HtmlUtils.htmlEscape(row.label()))
                        .append("</td>")
                        .append("<td").append(rowClass)
                        .append(" align=\"right\" style=\"padding:6px 0 6px 8px;font-family:").append(FONT_MONO)
                        .append(";font-size:13px;line-height:1.5;font-variant-numeric:tabular-nums;color:#0F172A;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;").append(borderBottom).append("\">")
                        .append("<span class=\"omega-text-primary\">")
                        .append(HtmlUtils.htmlEscape(row.value()))
                        .append("</span></td>")
                        .append("</tr>");
            }
            inner.append("</table>");
        }

        return """
                <table role="presentation" class="omega-box" width="100%%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;background-color:#F8FAFC;border:1px solid #E5E7EB;border-radius:8px;">
                  <tr>
                    <td style="padding:16px 20px;">
                      %s
                    </td>
                  </tr>
                </table>
                """.formatted(inner.toString());
    }

    private static String renderCtaSlot(Spec spec) {
        if (spec.ctaLabel() == null || spec.ctaLabel().isBlank() || spec.ctaUrl() == null || spec.ctaUrl().isBlank()) {
            return "";
        }
        String url = spec.ctaUrl().trim();
        try {
            URI target=URI.create(url);
            if(!"https".equalsIgnoreCase(target.getScheme()) || target.getHost()==null || target.getUserInfo()!=null || url.contains("\r") || url.contains("\n")) return "";
        } catch(IllegalArgumentException ex) { return ""; }
        String safeLabel = HtmlUtils.htmlEscape(spec.ctaLabel().trim());
        String safeUrl = HtmlUtils.htmlEscape(url);
        return """
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 8px 0;">
                  <tr>
                    <td align="left" bgcolor="#2F6FED" style="border-radius:8px;background-color:#2F6FED;mso-padding-alt:11px 20px;">
                      <a href="%s" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#2F6FED;color:#FFFFFF;font-size:13px;font-weight:500;line-height:1.2;padding:11px 20px;border-radius:8px;text-decoration:none;">%s</a>
                    </td>
                  </tr>
                </table>
                <p class="omega-text-muted" style="margin:8px 0 0 0;font-size:11px;line-height:1.5;color:#64748B;word-break:break-all;">
                  O abre este enlace directamente: <a class="omega-text-secondary" href="%s" style="font-family:%s;color:#475569;text-decoration:underline;">%s</a>
                </p>
                """.formatted(safeUrl, safeLabel, safeUrl, FONT_MONO, safeUrl);
    }

    private static String truncate(String value, int maxLen) {
        if (value == null) return "";
        String singleLine = value.replaceAll("\\s+", " ").trim();
        if (singleLine.length() <= maxLen) return singleLine;
        return singleLine.substring(0, maxLen).trim() + "…";
    }
}
