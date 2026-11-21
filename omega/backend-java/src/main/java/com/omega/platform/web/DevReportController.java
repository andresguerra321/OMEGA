package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.DevReportService;
import com.omega.platform.service.DevReportService.ExecutiveReportDto;
import java.util.UUID;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/dev/reports")
public class DevReportController {

    private final DevReportService devReportService;

    public DevReportController(DevReportService devReportService) {
        this.devReportService = devReportService;
    }

    @GetMapping("/export/json")
    public ExecutiveReportDto exportJson(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestParam(name = "projectId", required = false) UUID projectId
    ) {
        requireAuth(principal);
        return devReportService.exportJsonReport(principal, projectId);
    }

    @GetMapping(value = "/export/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> exportPdf(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestParam(name = "projectId", required = false) UUID projectId
    ) {
        requireAuth(principal);
        byte[] pdfBytes = devReportService.exportPdfReport(principal, projectId);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentDisposition(
                ContentDisposition.attachment().filename("omega-dev-security-report.pdf").build()
        );
        return new ResponseEntity<>(pdfBytes, headers, HttpStatus.OK);
    }

    private static void requireAuth(OmegaPrincipal principal) {
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Autenticación requerida");
        }
    }
}
