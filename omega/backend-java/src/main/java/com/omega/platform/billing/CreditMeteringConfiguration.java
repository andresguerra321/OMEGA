package com.omega.platform.billing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.config.SovereignModePolicy;
import com.omega.platform.security.TenantContext;
import com.omega.platform.security.OmegaPrincipal;
import java.lang.reflect.Method;
import java.util.*;
import org.aopalliance.intercept.MethodInterceptor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.aop.Advisor;
import org.springframework.aop.support.DefaultPointcutAdvisor;
import org.springframework.aop.support.StaticMethodMatcherPointcut;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Role;
import org.springframework.core.Ordered;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@Configuration
public class CreditMeteringConfiguration {
    private static final Logger log = LoggerFactory.getLogger(CreditMeteringConfiguration.class);

    @Bean
    @Role(BeanDefinition.ROLE_INFRASTRUCTURE)
    public static Advisor creditMeteringAdvisor(
            org.springframework.beans.factory.ObjectProvider<CreditService> creditProvider,
            org.springframework.beans.factory.ObjectProvider<ObjectMapper> mapperProvider,
            org.springframework.beans.factory.ObjectProvider<JdbcTemplate> jdbcProvider,
            org.springframework.beans.factory.ObjectProvider<SovereignModePolicy> sovereignProvider,
            org.springframework.core.env.Environment environment) {
        var pointcut = new StaticMethodMatcherPointcut() {
            @Override public boolean matches(Method method,Class<?> targetClass) { return method.isAnnotationPresent(Metered.class); }
        };
        MethodInterceptor interceptor = call -> {
            CreditService credits=creditProvider.getObject();
            if (!credits.enforced()) return call.proceed();
            ObjectMapper mapper=mapperProvider.getObject();
            JdbcTemplate jdbc=jdbcProvider.getObject();
            SovereignModePolicy sovereign=sovereignProvider.getObject();
            CreditOperation operation=call.getMethod().getAnnotation(Metered.class).value();
            UUID tenant=null,actor=null;
            for(Object arg:call.getArguments()) if(arg instanceof OmegaPrincipal p) { tenant=p.tenantId();actor=p.userId();break; }
            if(tenant==null) { var scope=TenantContext.get().orElseThrow(() -> new IllegalStateException("Falta contexto de cuenta para consumo"));tenant=scope.tenantId();actor=scope.userId(); }
            int amount=operation.credits;
            if (operation.paidOnly) credits.requirePaid(tenant);
            if(operation==CreditOperation.AI_QUERY && call.getMethod().getName().equals("queryExpediente")
                    && Boolean.TRUE.equals(jdbc.queryForObject("SELECT profile='LEGAL' FROM omega_rag.tenants WHERE id=?",Boolean.class,tenant))) {
                credits.requirePaid(tenant); amount=2;
            }
            if (operation==CreditOperation.LEGAL_INDEX) {
                UUID document=null;
                for (Object arg:call.getArguments()) if(arg instanceof UUID id) document=id;
                if(document==null) throw new IllegalStateException("Falta documento para reindexar");
                List<Integer> pages=jdbc.queryForList("SELECT total_pages FROM omega_rag.documents WHERE id=? AND tenant_id=?",Integer.class,document,tenant);
                if(pages.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Documento no encontrado");
                amount=CreditOperation.pageCredits(pages.getFirst(),false);
            }
            boolean clientLocal = sovereign.enabled() && "SELF_HOSTED".equals(environment.getProperty("OMEGA_DEPLOYMENT_MODE"));
            if (clientLocal && (operation==CreditOperation.AI_QUERY || operation==CreditOperation.AI_IMAGE)) return call.proceed();
            long uploadBytes=0;int uploadFiles=0;
            for(Object arg:call.getArguments()) {
                if(arg instanceof MultipartFile f) { uploadBytes+=f.getSize();uploadFiles++; }
                if(arg instanceof List<?> items) for(Object item:items) if(item instanceof MultipartFile f) { uploadBytes+=f.getSize();uploadFiles++; }
            }
            if(uploadBytes>25L*1024*1024 || uploadFiles>20) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,"Esta operación admite hasta 20 archivos y 25 MB en total.");
            UUID reservation=credits.reserve(tenant,actor,operation,amount,null);
            long startedNanos=System.nanoTime();
            Object result;
            try { result=call.proceed(); }
            catch(Throwable ex) {
                long durationMs=(System.nanoTime()-startedNanos)/1_000_000L;
                log.info("billing.credit_usage operation={} credits=0 reserved={} durationMs={} uploadBytes={} uploadFiles={} outcome=EXCEPTION",
                        operation.name(), amount, durationMs, uploadBytes, uploadFiles);
                credits.settle(tenant,reservation,0);
                throw ex;
            }
            JsonNode node=mapper.valueToTree(result);
            String status=node.path("status").asText("").toUpperCase(Locale.ROOT);
            boolean failed=result==null || status.contains("ERROR") || status.contains("FAIL") || status.contains("UNAVAILABLE") || status.endsWith("_EMPTY");
            int settled=failed?0:amount;
            credits.settle(tenant,reservation,settled);
            long durationMs=(System.nanoTime()-startedNanos)/1_000_000L;
            log.info("billing.credit_usage operation={} credits={} reserved={} durationMs={} uploadBytes={} uploadFiles={} outcome={}",
                    operation.name(), settled, amount, durationMs, uploadBytes, uploadFiles, failed ? "RELEASED" : "CONSUMED");
            return result;
        };
        var advisor=new DefaultPointcutAdvisor(pointcut,interceptor);
        // Reserve before opening service transactions, after method authorization.
        advisor.setOrder(Ordered.LOWEST_PRECEDENCE-100);
        return advisor;
    }
}
