package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.ProfessionalReportService;
import java.util.*;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/reports")
public class ProfessionalReportController {
    private final ProfessionalReportService service;
    public ProfessionalReportController(ProfessionalReportService service) { this.service=service; }
    public record CreateReport(String profile,UUID expedienteId,UUID projectId) {}
    @GetMapping public List<Map<String,Object>> list(@AuthenticationPrincipal OmegaPrincipal actor) { return service.list(actor); }
    @PostMapping @ResponseStatus(HttpStatus.CREATED)
    public Map<String,Object> create(@AuthenticationPrincipal OmegaPrincipal actor,@RequestBody CreateReport request) {
        return service.create(actor,request.profile(),request.expedienteId(),request.projectId());
    }
    @DeleteMapping("/{id}") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal OmegaPrincipal actor,@PathVariable UUID id) { service.delete(actor,id); }
    @GetMapping("/{id}/{format}")
    public ResponseEntity<byte[]> download(@AuthenticationPrincipal OmegaPrincipal actor,@PathVariable UUID id,@PathVariable String format) {
        byte[] bytes=service.download(actor,id,format);
        return ResponseEntity.ok().contentType("pdf".equals(format)?MediaType.APPLICATION_PDF:MediaType.APPLICATION_JSON)
            .cacheControl(CacheControl.noStore()).header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=\"omega-report-"+id+"."+format+"\"").body(bytes);
    }
}
