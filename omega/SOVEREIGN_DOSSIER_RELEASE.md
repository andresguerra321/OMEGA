# Fase 4: informe verificable, Ollama local e instaladores

## Exportación de expediente

Con una sesión autorizada, la biblioteca privada y el panel documental del chat
permiten descargar PDF o JSON. Los endpoints son:

- `GET /api/v1/expedientes/{id}/export/pdf`
- `GET /api/v1/expedientes/{id}/export/json`

Se exige `TenantScope` y permiso de lectura del expediente. Las respuestas llevan
`Cache-Control: no-store`. La exportación registra `EXPORT_FORENSIC_DOSSIER` antes
de tomar la secuencia de auditoría, bajo el mismo bloqueo por tenant que serializa
sus escrituras. El snapshot incluye ese evento.

El PDF contiene resumen, inventario de documentos y hashes, eventos forenses
persistidos y comprobación de la cadena. El JSON conserva los campos exactos
necesarios para recalcular los registros autorizados: SHA-256 UTF-8 de
`previousHash|tenantId|actorUserId|action|resourceType|resourceId|metadataJson|createdAt`.
Un actor nulo se representa como `system` y un recurso nulo como cadena vacía;
`createdAt` usa `Instant.toString()` con precisión de microsegundos. La cadena
se verifica por `chain_seq`; los tiempos se muestran en UTC.

`CHAIN_VALID` significa que los hashes coinciden en el momento de exportar.
`CHAIN_COMPROMISED` identifica el primer registro inconsistente. No hay sello de
tiempo de una autoridad externa ni firma profesional del perito. Una reescritura
completa de la base y sus hashes, o la eliminación de la cola de la cadena, exige
un anclaje externo previo para detectarse. Los hashes de documentos son los
medidos al ingreso: los originales purgados no se vuelven a medir al exportar.

La cadena se comprueba completa dentro del tenant, pero los metadatos de otros
casos no se divulgan: esos eslabones aparecen como `proofOnly`. Para verificarlos
de forma independiente hace falta acceso autorizado al registro original. No se
reconstruyen resultados efímeros que nunca se guardaron. Las nuevas acciones de
contención pueden vincularse al expediente activo por selección del usuario;
esa asociación queda identificada como `USER_SELECTED_CASE`, sin atribuir causalidad.

## Activación soberana

Configurar en el entorno del backend, antes de arrancar:

```dotenv
OMEGA_AI_PROVIDER=ollama
OMEGA_OLLAMA_BASE_URL=http://localhost:11434
OMEGA_OLLAMA_EMBED_MODEL=bge-m3
OMEGA_OLLAMA_CHAT_MODEL=qwen2.5:14b
OMEGA_OLLAMA_VISION_MODEL=qwen2.5vl:7b
```

Docker Compose ya transmite estas variables y usa
`http://host.docker.internal:11434` como URL predeterminada para alcanzar Ollama
en el anfitrión. El panel Desktop también activa estas propiedades al guardar
Ollama; volver a un proveedor externo abandona expresamente el modo soberano.
La cuenta que ejecuta Ollama debe deshabilitar sus funciones cloud con
`OLLAMA_NO_CLOUD=1` y reiniciar el daemon. Preparar y descargar previamente los
tres modelos; OMEGA no los descarga automáticamente. Los nombres cloud se
rechazan y no se admiten endpoints Ollama remotos ni redirecciones HTTP.

Los tres contratos de IA cambian conjuntamente. Se mantienen las defensas de
citas e inyección del generador existente. Un fallo local nunca habilita un
proveedor cloud como fallback. La visión usa únicamente la imagen ya sanitizada.

El índice actual usa 1536 dimensiones. Un vector local más pequeño se normaliza
L2 y se completa con ceros, preservando distancias coseno. Un vector mayor, no
finito o nulo se rechaza: no se recorta arbitrariamente. El modelo se registra
como `ollama:<embed-model>` y el flujo RAG existente marca los documentos de otro
modelo como `REINDEX_REQUIRED`. Se deben volver a ingresar los originales para
reindexarlos; Zero-Retention impide recuperarlos del servidor. Si se cambia el
contenido de un modelo bajo la misma etiqueta, usar una etiqueta nueva para
que el cambio de versión sea detectable.

En modo soberano se deshabilitan reputación remota, inspección web, RDAP/CT,
feeds/discovery en línea y OSINT externo. La pasarela rechaza rutas del worker
que pueden consultar Internet. Desktop bloquea navegación externa, inspección
Chromium y descarga de ADB desde sus IPC. Las reglas de contención deben usar
IPs ya medidas, no nombres que requieran resolución externa. El corpus local,
la exportación, los proveedores de IA y las operaciones forenses locales siguen
disponibles.

El backend rechaza PostgreSQL, worker u Ollama remotos y SMTP externo al arrancar.
Se confía en los nombres locales de Compose y `host.docker.internal`: no deben
redirigirse a máquinas externas. Si se usa correo 2FA, el relay debe ser local y
no reenviar a Internet. Un Ollama local que actúe como proxy cloud, un relay que
reenvíe, o un worker modificado pueden violar esa frontera de confianza. La
insignia `airGappedMode` expresa la política de la aplicación, no una certificación
del firewall, del DNS o del SO. Para un aislamiento físico, bloquear egress de
los procesos/contenedores y del daemon Ollama después de preparar dependencias
y modelos. Esto también evita conexiones de herramientas externas al proceso.

## Instaladores y firma

El workflow construye Windows NSIS/portable, macOS DMG y Linux AppImage. El
generador de manifiestos reconoce también MSI y DEB cuando se produzcan.
Sin certificados se permite un build de pruebas y se emite un aviso explícito.
Una firma configurada que falle hace fallar el empaquetado.

- Windows: `WINDOWS_CSC_LINK` y `WINDOWS_CSC_KEY_PASSWORD`; se conservan los alias
  anteriores `WIN_CSC_LINK` y `WIN_CSC_KEY_PASSWORD`.
- macOS: `APPLE_CSC_LINK`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` y
  `APPLE_TEAM_ID`. Si el PKCS#12 requiere contraseña, configurar también
  `APPLE_CSC_KEY_PASSWORD`. Con todas las credenciales se solicita Developer ID
  y notarización; en su ausencia se genera una firma ad hoc de pruebas.
- Firma separada de checksums: `RELEASE_SIGNING_KEY`, clave privada RSA o ECDSA
  PEM sin contraseña, almacenada en GitHub Secrets. Se usa en un archivo temporal
  privado, se borra al terminar y nunca se incorpora a los artefactos.

Cada plataforma exige un manifiesto no vacío. Un job final reúne instaladores,
rechaza nombres duplicados, recalcula un único `SHA256SUMS.txt` y lo firma si hay
clave. Publica `SHA256SUMS.txt.sig` y `RELEASE_SIGNING_PUBLIC_KEY.pem` cuando
corresponde, además de atestación de procedencia GitHub. No se declara firma
comercial basándose solo en esa atestación.

```sh
sha256sum --check SHA256SUMS.txt
openssl dgst -sha256 -verify trusted-release-public-key.pem -signature SHA256SUMS.txt.sig SHA256SUMS.txt
```

La clave pública de confianza debe obtenerse/pinarse por otro canal: aceptar
únicamente la clave incluida en un paquete no autentica al editor. La firma del
manifiesto y Authenticode/Developer ID son comprobaciones diferentes. No se ha
publicado ningún release ni utilizado certificados de producción durante las
pruebas locales.

Referencias: [OpenPDF 3.0.5](https://github.com/LibrePDF/OpenPDF/releases/tag/3.0.5),
[Ollama embed](https://docs.ollama.com/api/embed),
[Ollama chat](https://docs.ollama.com/api/chat),
[Ollama sin cloud](https://docs.ollama.com/faq),
[firma de electron-builder](https://www.electron.build/docs/features/code-signing/),
[notarización v26](https://www.electron.build/v26/docs/features/code-signing/notarization/).
