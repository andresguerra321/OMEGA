package com.omega.platform.service;

import static org.assertj.core.api.Assertions.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class OmegaEmailTemplateTest {
    @Test void reusableSlotsRenderAllMessageTypesAndExportReviewSamples() throws Exception {
        var samples=new LinkedHashMap<String,OmegaEmailTemplate.Spec>();
        samples.put("pago",OmegaEmailTemplate.Spec.builder("Tu pago está confirmado")
            .preheader("Tu membresía de OMEGA está activa. Consulta los detalles del pago.")
            .addParagraph("Recibimos tu pago. Tu membresía ya está activa y puedes continuar trabajando en OMEGA.")
            .addMetadata("Plan","Pro mensual").addMetadata("Monto","59.900 COP").addMetadata("Fecha","25 nov 2026")
            .addMetadata("Referencia","QA-PAGO-2026-001")
            .addParagraph("Consulta el comprobante desde Documentos y facturación. La factura fiscal se gestiona por separado.")
            .recipientEmail("persona@example.invalid").supportEmail("soporte@example.invalid").build());
        samples.put("2fa",OmegaEmailTemplate.Spec.builder("Confirma tu acceso")
            .preheader("Tu código de verificación caduca en 5 minutos.")
            .addParagraph("Usa este código para confirmar tu acceso a OMEGA.")
            .verificationCode("482913","Válido por 5 minutos · Uso único")
            .addParagraph("Si no solicitaste este acceso, cambia tu contraseña desde tu cuenta.")
            .recipientEmail("persona@example.invalid").supportEmail("soporte@example.invalid").build());
        samples.put("seguridad",OmegaEmailTemplate.Spec.builder("Revisa la actividad de tu cuenta")
            .preheader("Tienes una actividad de seguridad pendiente de revisión.")
            .addParagraph("Revisa el evento registrado en tu cuenta y comprueba si reconoces esta actividad.")
            .addMetadata("Evento","QA-SEGURIDAD-001").addMetadata("Fecha","25 nov 2026")
            .recipientEmail("persona@example.invalid").supportEmail("soporte@example.invalid").build());
        samples.put("informe",OmegaEmailTemplate.Spec.builder("Tu informe está disponible")
            .preheader("Consulta la nueva versión de tu informe desde OMEGA.")
            .addParagraph("Tu informe está disponible en Cuenta → Informes. Inicia sesión para revisar los resultados y sus fuentes.")
            .addMetadata("Informe","QA-INFORME-001").addMetadata("Fecha","25 nov 2026")
            .recipientEmail("persona@example.invalid").supportEmail("soporte@example.invalid").build());
        String preview=System.getProperty("omega.mail.preview.dir");
        for(var sample:samples.entrySet()) {
            String html=OmegaEmailTemplate.render(sample.getValue());
            assertThat(html).contains("role=\"presentation\"","color-scheme","prefers-color-scheme: dark","#F6F8FA","#FFFFFF","#090B10","#11151E","max-width:540px","cid:omegaMark","mailto:soporte@example.invalid","persona@example.invalid","<!--[if mso]>");
            assertThat(html).doesNotContain("omegaBanner","OMEGA SECURITY · TU CUENTA","#000000","#0A0A0C");
            if(preview!=null) {
                var folder=Path.of(preview);Files.createDirectories(folder);
                byte[] png=new org.springframework.core.io.ClassPathResource("mail/omega-mark.png").getInputStream().readAllBytes();
                html=html.replace("cid:omegaMark","data:image/png;base64,"+Base64.getEncoder().encodeToString(png));
                Files.writeString(folder.resolve(sample.getKey()+".html"),html);
            }
        }
    }

    @Test void escapesSlotsAndRestrictsActionsToInspectableHttpsUrls() {
        String html=OmegaEmailTemplate.Spec.builder("<script>titulo</script>").addParagraph("<img src=x> & datos")
            .addMetadata("<label>","<value>").recipientEmail("<persona>").supportEmail("not-an-email")
            .cta("Continuar","javascript:alert(1)").render();
        assertThat(html).contains("&lt;script&gt;","&lt;img","&lt;label&gt;","&lt;value&gt;","&lt;persona&gt;")
            .doesNotContain("<script>","<img src=x>","javascript:","mailto:");
        for(String target:List.of("http://example.invalid","https://user@example.invalid","https://","https://example.invalid/\r\nHeader"))
            assertThat(OmegaEmailTemplate.Spec.builder("Enlace").cta("Abrir",target).render()).doesNotContain("target=\"_blank\"");
        String action=OmegaEmailTemplate.Spec.builder("Informe").cta("Ver informe","https://example.invalid/informes?id=1&view=2").render();
        assertThat(action).contains("#2F6FED","https://example.invalid/informes?id=1&amp;view=2","Ver informe");
    }

    @Test void longIdsRemainWrappableAndOtpStaysInItsOwnSlot() {
        String html=OmegaEmailTemplate.Spec.builder("Confirma tu acceso").preheader("Tu código caduca en 5 minutos.")
            .verificationCode("482913","Uso único").addMetadata("Evento","x".repeat(160)).render();
        assertThat(html).contains("font-size:28px","letter-spacing:0.25em","font-variant-numeric:tabular-nums","word-break:break-word");
        String preheader=html.substring(html.indexOf("<div style=\"display:none"),html.indexOf("</div>",html.indexOf("<div style=\"display:none")));
        assertThat(preheader).doesNotContain("482913");
    }
}
