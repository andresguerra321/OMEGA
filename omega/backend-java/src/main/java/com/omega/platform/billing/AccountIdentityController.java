package com.omega.platform.billing;

import com.omega.platform.repository.TenantRepository;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.security.*;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/account")
public class AccountIdentityController {
    private final TenantRepository tenants;
    private final UserRepository users;
    private final com.omega.platform.service.AuditLogService audit;
    public AccountIdentityController(TenantRepository tenants,UserRepository users,com.omega.platform.service.AuditLogService audit) { this.tenants=tenants;this.users=users;this.audit=audit; }
    public record Classification(String accountType) {}

    @PostMapping("/type")
    @Transactional
    public Map<String,Object> classify(@AuthenticationPrincipal OmegaPrincipal actor,@RequestBody Classification request) {
        var tenant=tenants.findActiveForUpdate(actor.tenantId()).orElseThrow();
        if(actor.role()!=Role.ADMIN && !actor.userId().equals(tenant.getOwnerUserId()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Solo el titular puede confirmar el tipo de cuenta.");
        if(!"UNCLASSIFIED".equals(tenant.getAccountType()))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Esta cuenta ya tiene un tipo confirmado.");
        if(!java.util.Set.of("INDIVIDUAL","ORGANIZATION").contains(request.accountType()==null?"":request.accountType()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Selecciona cuenta individual u organización.");
        var user=users.findByIdAndTenantId(actor.userId(),actor.tenantId()).orElseThrow();
        if("INDIVIDUAL".equals(request.accountType())) {
            if(users.findAllByTenantIdOrderByCreatedAtAsc(actor.tenantId()).size()!=1)
                throw new ResponseStatusException(HttpStatus.CONFLICT,"Este espacio tiene miembros; debe conservarse como organización.");
            user.setRole(Role.ANALYST);
            users.save(user);
        }
        tenant.setAccountType(request.accountType());
        tenant.setOwnerUserId(actor.userId());
        tenants.save(tenant);
        audit.record(actor.tenantId(),actor.userId(),"ACCOUNT_TYPE_CONFIRMED","TENANT",actor.tenantId().toString(),Map.of("accountType",tenant.getAccountType(),"role",user.getRole().name()));
        return Map.of("accountType",tenant.getAccountType(),"role",user.getRole());
    }
}
