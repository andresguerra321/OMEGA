# Propuesta [PAUSA — Q12]: Seguridad del Despacho (Verificación Efímera de Adjuntos y Enlaces)

> **Estado:** Propuesta de diseño (NO implementada; requiere aprobación antes de habilitar el módulo `seguridad_despacho` en `LEGAL`).

## 1. Objetivo
Ofrecer a los abogados del despacho una utilidad directa para **verificar un enlace sospechoso o un adjunto recibido por correo** (phishing, facturas falsas, PDFs con JavaScript/Launch o macros Office) **sin guardar el archivo ni el enlace en ningún expediente** y reutilizando los motores ya existentes en OMEGA (`LinkVerifierPanel`, `PdfSecuritySanitizer`, `OfficeImageExtractor` y worker `omega/api`).

## 2. Arquitectura propuesta
- **Procesamiento 100% efímero (Zero-Retention):**
  - Endpoint dedicado `POST /api/v1/legal/desk-security/inspect-file` y reutilización de `POST /api/v1/links/verify`.
  - El archivo se inspecciona en streaming/temporal RAM con `PdfSecuritySanitizer` y `OfficeImageExtractor` (sin crear fila en `documents`, sin extraer texto a `document_chunks`, sin enviar contenido a proveedores de IA externos).
  - El resultado devuelto al usuario es únicamente un diagnóstico técnico legible: formato real detectado por firma binaria, presencia de macros/JavaScript/enlaces externos/XXE, hash SHA-256 y recomendación práctica en español claro.
  - Purga garantizada del temporal en bloque `finally`.
- **Auditoría mínima:** `DESK_SECURITY_CHECK_EXECUTED` con `checkType` (`LINK` o `FILE`), `verdict` (`CLEAN_RULES` / `SUSPICIOUS` / `BLOCKED`) y `sha256Hash` (nunca URL completa ni nombre de archivo).

## 3. Modelo de amenazas y riesgos

| Amenaza | Riesgo | Mitigación propuesta |
| --- | --- | --- |
| SSRF al analizar un enlace sospechoso | Acceso a red interna / metadatos cloud | Reutilizar la validación SSRF estricta existente en `LinkVerifier` (bloqueo de IPs privadas, loopback, link-local y esquemas no HTTP/HTTPS). |
| Falsa sensación de seguridad ("archivo 100% seguro") | El abogado abre malware zero-day | Lenguaje honesto obligatorio: *"Sin señales maliciosas detectadas con las reglas actuales; no garantiza ausencia de amenazas desconocidas"*. |
| Envío accidental de documentos confidenciales a terceros | Ruptura de secreto profesional | El análisis de adjuntos se ejecuta 100% localmente en el backend/worker de OMEGA sin consultas a LLMs externos ni envío del archivo a VirusTotal u otros servicios sin opt-in explícito. |
| Abuso / DoS mediante archivos gigantes o zip bombs | Saturación del servidor | Reutilizar límites de tamaño, `ArchiveSecurityValidator` y rate limiting por tenant (`LegalQuotaService`). |
