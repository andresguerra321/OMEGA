package com.omega.platform.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;

class TransactionalMailTransportTest {
    @Test void deliversThroughRealLocalSmtpToRegisteredRecipientAndClearsQueuedBody() throws Exception {
        try (var server = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
             var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            server.setSoTimeout(5000);
            var jdbc = mock(JdbcTemplate.class);
            var id = UUID.randomUUID();
            when(jdbc.queryForList(anyString())).thenReturn(List.of(Map.of(
                    "id", id,
                    "active", true,
                    "email", "registered@example.invalid",
                    "subject", "OMEGA · Prueba del diseño de correo",
                    "body", "Este es un correo de prueba del diseño de OMEGA.\n\nPlan: Pro Mensual\nMonto: $59.900 COP\n\nLos avisos de pagos e informes usarán esta presentación. Esta prueba no genera pagos ni modifica tu suscripción."
            )), List.of());
            var smtp = new JavaMailSenderImpl();
            smtp.setHost("127.0.0.1");
            smtp.setPort(server.getLocalPort());
            smtp.setDefaultEncoding("UTF-8");
            smtp.getJavaMailProperties().setProperty("mail.smtp.connectiontimeout", "3000");
            smtp.getJavaMailProperties().setProperty("mail.smtp.timeout", "3000");
            @SuppressWarnings("unchecked") ObjectProvider<JavaMailSender> provider = mock(ObjectProvider.class);
            when(provider.getIfAvailable()).thenReturn(smtp);
            when(provider.getObject()).thenReturn(smtp);
            var manager = mock(org.springframework.transaction.PlatformTransactionManager.class);
            when(manager.getTransaction(any())).thenReturn(new org.springframework.transaction.support.SimpleTransactionStatus());
            var received = executor.submit(() -> {
                try (var socket = server.accept()) {
                    socket.setSoTimeout(5000);
                    var input = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                    var output = new PrintWriter(socket.getOutputStream(), true, StandardCharsets.US_ASCII);
                    output.print("220 localhost QA\r\n");
                    output.flush();
                    var message = new StringBuilder();
                    String recipient = "";
                    for (String line; (line = input.readLine()) != null; ) {
                        if (line.startsWith("DATA")) {
                            output.print("354 End with dot\r\n");
                            output.flush();
                            while ((line = input.readLine()) != null && !line.equals(".")) {
                                message.append(line.startsWith("..") ? line.substring(1) : line).append("\r\n");
                            }
                            output.print("250 Accepted\r\n");
                        } else if (line.startsWith("QUIT")) {
                            output.print("221 Bye\r\n");
                            output.flush();
                            break;
                        } else {
                            if (line.startsWith("RCPT TO:")) recipient = line;
                            output.print("250 localhost\r\n");
                        }
                        output.flush();
                    }
                    return Map.of("recipient", recipient, "message", message.toString());
                }
            });
            new TransactionalMailService(jdbc, provider, manager, true, "sender@example.invalid").deliver();
            var result = received.get(6, TimeUnit.SECONDS);
            assertThat(result.get("recipient")).contains("registered@example.invalid");
            var mime = new MimeMessage(Session.getInstance(new Properties()), new ByteArrayInputStream(result.get("message").getBytes(StandardCharsets.US_ASCII)));
            assertThat(mime.getSubject()).isEqualTo("OMEGA · Prueba del diseño de correo");
            assertThat(part(mime, "text/plain")).contains("Este es un correo de prueba del diseño de OMEGA.");
            String html = part(mime, "text/html");
            assertThat(html)
                    .contains("color-scheme", "prefers-color-scheme: dark", "#F6F8FA", "#FFFFFF", "#090B10", "#11151E", "max-width:540px")
                    .contains("Pro Mensual", "$59.900 COP", "Los avisos de pagos e informes", "registered@example.invalid", "cid:omegaMark")
                    .doesNotContain("cid:omegaBanner", "#0A0A0C", "OMEGA SECURITY · TU CUENTA");
            assertThat(mime.getFrom()[0].toString()).contains("OMEGA Security");
            assertThat(part(mime, "image/jpeg")).isEmpty();
            assertThat(part(mime, "image/png")).isEqualTo("image/png");
            assertThat(mime.getAllRecipients()[0].toString()).isEqualTo("registered@example.invalid");
            verify(jdbc).update(contains("status='SENT'"), eq(id));
            verify(jdbc).update(contains("body=''"), eq(id));
            String preview = System.getProperty("omega.mail.preview.dir");
            if (preview != null) {
                var directory = java.nio.file.Path.of(preview);
                java.nio.file.Files.createDirectories(directory);
                try (var output = java.nio.file.Files.newOutputStream(directory.resolve("omega-email-preview.eml"))) {
                    mime.writeTo(output);
                }
            }
        }
    }

    @Test void escapesQueuedContentAndHasNoRemoteImageDependency() {
        String html = TransactionalMailService.renderHtml(
                "OMEGA · <script>test</script>",
                "<img src=x onerror=alert(1)> & datos\n\nSegunda línea",
                "user@example.invalid"
        );
        assertThat(html)
                .contains("&lt;script&gt;", "&lt;img", "&amp; datos", "user@example.invalid")
                .doesNotContain("<script>", "<img src=x", "cid:omegaBanner", "https://");
        assertThat(org.springframework.web.util.HtmlUtils.htmlUnescape(html)).contains("Segunda línea");
    }

    @Test void rendersOtpAndCtaSlotsCleanly() {
        String html = OmegaEmailTemplate.Spec.builder("Código de verificación")
                .preheader("Tu código OMEGA es 482910")
                .addParagraph("Usa este código en los próximos 5 minutos.")
                .verificationCode("482910", "Válido por 5 minutos")
                .addMetadata("Dispositivo", "Windows · Chrome")
                .cta("Abrir cuenta OMEGA", "https://omega.example/cuenta")
                .recipientEmail("andres@example.org")
                .render();
        assertThat(html)
                .contains("482910", "letter-spacing:0.25em", "font-size:28px", "Windows &middot; Chrome")
                .contains("background-color:#2F6FED", "Abrir cuenta OMEGA", "https://omega.example/cuenta", "andres@example.org");
    }

    private static String part(jakarta.mail.Part part, String type) throws Exception {
        if (part.isMimeType(type)) return type.startsWith("text/") ? part.getContent().toString() : type;
        if (part.isMimeType("multipart/*")) {
            var multipart = (jakarta.mail.Multipart) part.getContent();
            for (int i = 0; i < multipart.getCount(); i++) {
                String value = part(multipart.getBodyPart(i), type);
                if (!value.isEmpty()) return value;
            }
        }
        return "";
    }
}
