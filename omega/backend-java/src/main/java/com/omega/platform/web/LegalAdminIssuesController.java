package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.LegalQuotaService;
import com.omega.platform.service.LegalQuotaService.AdminDocumentIssueView;
import com.omega.platform.service.LegalQuotaService.QuotaSummaryView;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/legal")
public class LegalAdminIssuesController {

    private final LegalQuotaService quotaService;

    public LegalAdminIssuesController(LegalQuotaService quotaService) {
        this.quotaService = quotaService;
    }

    @GetMapping("/quotas")
    public QuotaSummaryView quotas(@AuthenticationPrincipal OmegaPrincipal actor) {
        return quotaService.currentPlanSummary(actor);
    }

    @GetMapping("/admin/documents/issues")
    @PreAuthorize("hasRole('ADMIN')")
    public List<AdminDocumentIssueView> issues(@AuthenticationPrincipal OmegaPrincipal actor) {
        return quotaService.listAdminDocumentIssues(actor);
    }
}
