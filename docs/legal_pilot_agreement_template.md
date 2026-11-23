# Plantilla Base: Acuerdo de Piloto, Confidencialidad y Encargo de Tratamiento de Datos — OMEGA

> **Nota de uso:** Este documento es una plantilla técnica-jurídica base alineada con la arquitectura real de **OMEGA** (`Zero-Retention`, aislamiento multi-tenant en PostgreSQL, bóveda `omega-vault` y modo local soberano). Debe ser revisada y adaptada por un abogado colegiado en la jurisdicción aplicable (p. ej., Ley 1581 de 2012 y Decreto 1377 de 2013 en Colombia, RGPD en la UE o LFPDPPP en México) antes de su firma con un despacho o empresa piloto.

---

**Fecha:** `[DD/MM/2026]`  
**Entre:**  
1. **EL PROVEEDOR:** `[Nombre / Razón Social del Equipo OMEGA]`, identificado con `[NIT / Documento]`, domiciliado en `[Ciudad]`.  
2. **EL CLIENTE PILOTO (Socios de Diseño):** `[Nombre del Despacho Jurídico / Empresa]`, identificado con `[NIT / Documento]`, representado por `[Nombre del Representante]`, domiciliado en `[Ciudad]`.

---

## 1. Objeto y Duración del Piloto
El presente acuerdo regula el acceso y uso en fase piloto del software **OMEGA** (perfil `[LEGAL / DEVELOPER]`, plan `[PERSONAL / PRO / ENTERPRISE]`) durante un plazo inicial de **`[14 / 30]` días calendario** contados a partir de la activación del espacio (`@[slug-del-tenant]`).

## 2. Titularidad Exclusiva y Secreto Profesional
1. **Propiedad de los datos:** **EL CLIENTE PILOTO** conserva en todo momento la titularidad exclusiva, derechos de autor y control sobre todos los expedientes, documentos PDF/DOCX, imágenes, fragmentos indexados, repositorios y consultas cargados en su espacio.
2. **Reserva y secreto profesional:** **EL PROVEEDOR** reconoce que la información procesada en el perfil `LEGAL` puede estar amparada por el secreto profesional abogado-cliente y reserva legal, obligándose a no acceder, divulgar, ceder ni inspeccionar manualmente el contenido de los expedientes de **EL CLIENTE PILOTO**.

## 3. Arquitectura Técnica, Custodia y Política *Zero-Retention*
El tratamiento técnico dentro de **OMEGA** se sujeta estrictamente a las siguientes garantías verificables en código:
1. **Aislamiento criptográfico y lógico por organización (`tenant_id`):** Cada consulta, documento, vector y registro de auditoría lleva asociado el identificador único del espacio de **EL CLIENTE PILOTO**, impidiendo cruces entre distintos clientes.
2. **Modalidad de almacenamiento seleccionada para el piloto** *(marcar una)*:
   - [ ] **Opción A — *Zero-Retention* Estricto (Por defecto):** El archivo binario original se procesa en memoria temporal para validar su integridad (sello SHA-256) y extraer fragmentos de búsqueda, eliminándose el archivo fuente tras la indexación.
   - [ ] **Opción B — Custodia en Bóveda Dedicada (`omega-vault`) Local / On-Premise:** El archivo original sanitizado se conserva en el bucket aislado `tenants/<tenant_id>/expedientes/<expediente_id>/` con retención máxima de `[90]` días, descargable únicamente por usuarios autorizados del despacho cuando su estado es `INDEXED`.
3. **Prohibición de entrenamiento de modelos:** Ningún documento, fragmento ni consulta de **EL CLIENTE PILOTO** se utiliza para entrenar, ajustar (*fine-tuning*) ni alimentar modelos públicos o de terceros. En instalaciones con **Modo Soberano Local (`Ollama`)**, la inferencia y los embeddings se ejecutan 100 % dentro de la infraestructura local sin tráfico hacia APIs externas.
4. **Telemetría de producto libre de PII:** La analítica del piloto registra exclusivamente contadores numéricos de activación (p. ej. número de documentos indexados o consultas con cita), sin almacenar nombres de archivos, textos de preguntas ni correos electrónicos.

## 4. Naturaleza de Asistencia Técnica y Limitación de Responsabilidad
1. **Apoyo probatorio, no asesoría jurídica:** Las respuestas, líneas de tiempo y hallazgos generados por **OMEGA** son herramientas de apoyo documental con citas verificables por página (`[1]`, `[2]`) y sello SHA-256. **No constituyen asesoría legal ni sustituyen el criterio profesional del abogado responsable**, quien debe verificar siempre el pasaje citado antes de presentar cualquier escrito judicial o contractual.
2. **Nivel de servicio en fase piloto:** Durante el piloto, el software se entrega *"tal cual"* (*as-is*), con soporte directo a través del canal integrado **Reportar problema** (que adjunta únicamente metadatos técnicos saneados). La responsabilidad total acumulada de **EL PROVEEDOR** durante el piloto se limita al monto efectivamente pagado por **EL CLIENTE PILOTO** en dicho periodo (o `[USD $0 / COP $0]` en pilotos gratuitos de validación).

## 5. Terminación y Destrucción Certificada de Datos (Derecho de Supresión)
En cualquier momento, o al concluir el plazo del piloto sin renovación comercial:
1. **EL CLIENTE PILOTO** podrá exportar sus informes e historial de auditoría desde la interfaz de **OMEGA**.
2. A solicitud de **EL CLIENTE PILOTO** (o dentro de los **5 días hábiles** siguientes al cierre del piloto), **EL PROVEEDOR** ejecutará la **purga definitiva en cascada** del espacio en PostgreSQL y en `omega-vault`, emitiendo constancia escrita de destrucción con la huella SHA-256 de cierre.

---

**Firmas de Conformidad:**

| Por EL PROVEEDOR (OMEGA) | Por EL CLIENTE PILOTO |
|---|---|
| Firma: ___________________________ | Firma: ___________________________ |
| Nombre: `[Nombre]` | Nombre: `[Nombre]` |
| Cargo: `[Cargo]` | Cargo: `[Socio / Representante Legal]` |
