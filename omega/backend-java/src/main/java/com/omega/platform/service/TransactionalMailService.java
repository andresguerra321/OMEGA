package com.omega.platform.service;

import java.util.Map;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class TransactionalMailService {
    private final JdbcTemplate jdbc;
    private final ObjectProvider<JavaMailSender> sender;
    private final TransactionTemplate tx;
    private final boolean enabled;
    private final String from;
    @Value("${OMEGA_SUPPORT_EMAIL:}")
    private String supportEmail;

    public TransactionalMailService(
            JdbcTemplate jdbc,
            ObjectProvider<JavaMailSender> sender,
            PlatformTransactionManager manager,
            @Value("${OMEGA_TRANSACTIONAL_MAIL_ENABLED:false}") boolean enabled,
            @Value("${OMEGA_SMTP_FROM:${OMEGA_SMTP_USERNAME:}}") String from
    ) {
        this.jdbc = jdbc;
        this.sender = sender;
        this.tx = new TransactionTemplate(manager);
        this.enabled = enabled;
        this.from = from;
    }

    @Scheduled(fixedDelayString = "${omega.mail.delivery-delay-ms:30000}")
    public void deliver() {
        if (!enabled || from.isBlank() || sender.getIfAvailable() == null) return;
        for (int i = 0; i < 20; i++) {
            Boolean worked = tx.execute(status -> {
                var rows = jdbc.queryForList("""
                    SELECT m.*,u.email,u.active FROM omega_rag.transactional_mail m
                    LEFT JOIN omega_rag.users u ON u.id=m.actor_user_id AND u.tenant_id=m.tenant_id
                    WHERE m.status='PENDING' AND m.next_attempt_at<=now() ORDER BY m.created_at
                    LIMIT 1 FOR UPDATE OF m SKIP LOCKED
                    """);
                if (rows.isEmpty()) return false;
                Map<String, Object> row = rows.getFirst();
                if (!Boolean.TRUE.equals(row.get("active")) || row.get("email") == null) {
                    jdbc.update("UPDATE omega_rag.transactional_mail SET status='SKIPPED' WHERE id=?", row.get("id"));
                    return true;
                }
                try {
                    var mailSender = sender.getObject();
                    var message = mailSender.createMimeMessage();
                    var helper = new MimeMessageHelper(message, true, "UTF-8");
                    String recipient = row.get("email").toString();
                    String subject = row.get("subject").toString();
                    String body = row.get("body").toString();
                    helper.setFrom(from, "OMEGA Security");
                    helper.setTo(recipient);
                    helper.setSubject(subject);
                    helper.setText(body, OmegaEmailTemplate.renderPlainBody(subject,body,recipient,
                            supportEmail==null || supportEmail.isBlank()?from:supportEmail));
                    OmegaEmailTemplate.attachMark(helper);
                    mailSender.send(message);
                    jdbc.update(
                            "UPDATE omega_rag.transactional_mail SET status='SENT',sent_at=now(),attempts=attempts+1,body='' WHERE id=?",
                            row.get("id")
                    );
                } catch (org.springframework.mail.MailException
                         | jakarta.mail.MessagingException
                         | java.io.UnsupportedEncodingException ex) {
                    // Do not store SMTP errors: they can contain credentials, addresses or message contents.
                    jdbc.update(
                            "UPDATE omega_rag.transactional_mail SET attempts=attempts+1,status=CASE WHEN attempts>=4 THEN 'FAILED' ELSE 'PENDING' END,next_attempt_at=now()+interval '5 minutes' WHERE id=?",
                            row.get("id")
                    );
                }
                return true;
            });
            if (!Boolean.TRUE.equals(worked)) break;
        }
    }

    static String renderHtml(String subject, String body, String recipientEmail) {
        return OmegaEmailTemplate.renderPlainBody(subject, body, recipientEmail);
    }

    static String renderHtml(String subject, String body, boolean ignoredLegacyBannerFlag) {
        return OmegaEmailTemplate.renderPlainBody(subject, body, null);
    }
}
