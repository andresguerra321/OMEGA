# Sensor nativo de equipo — Fase 5

## Experiencia del cliente Windows

El cliente mantiene Docker Desktop abierto, descarga y abre el `.exe` de OMEGA
e inicia sesión. La aplicación inicia sus servicios y prepara automáticamente la
protección de esa computadora. Windows puede pedir autorización una vez para
instalar el componente de protección; la interfaz de OMEGA permanece sin elevación.
Si se cancela, OMEGA ofrece **Reintentar preparación** dentro de la aplicación.

No se pide instalar Python, ejecutar comandos, copiar claves, configurar variables,
introducir un UUID/SID ni leer este documento. La cuenta propietaria se obtiene de
la sesión ADMIN verificada por el backend y la identidad Windows se detecta localmente.
Un equipo ya vinculado no se reasigna silenciosamente a otro tenant.

El instalador contiene el motor completo del sensor. Reutiliza una instalación
válida y actualiza versiones anteriores automáticamente, conservando la bóveda en
`ProgramData\OMEGA\quarantine` y su clave del almacén seguro. Docker accede al sensor
mediante un puente limitado a loopback, autenticado con HMAC por petición/respuesta;
Electron traduce al pipe con ACL. Las acciones continúan pasando por RBAC, vista
previa y desafío de contraseña/MFA del gateway.

Las instrucciones siguientes son para desarrollo, distribución y administración;
no forman parte del onboarding del cliente.

La implementación del flujo automático se comprobó con 53 pruebas frontend, 146
pruebas Python y 4 del script de firma. Se compiló el sensor autónomo, se verificó
el inventario del paquete Electron usando su clave pública embebida y se completó
una petición autenticada desde Docker Desktop hasta ese sensor por el puente y el
pipe. Se generaron instaladores NSIS y portable de prueba sin firma comercial.
La instalación como LocalSystem/UAC todavía requiere una prueba en Windows limpio;
estas comprobaciones no instalaron servicios en la estación de desarrollo.

## Instalación endurecida

Electron se ejecuta como usuario normal. `omega-agent` se instala explícitamente
como LocalSystem en Windows o root en Linux/macOS; la UI nunca solicita elevación
para sí misma. En el `.exe` Windows el servicio se prepara al entrar como ADMIN,
con autorización de Windows cuando sea necesaria.

El sensor nativo usa un pipe `\\.\pipe\omega-agent-<tenant-UUID>` con DACL que
permite únicamente al SID configurado y SYSTEM, rechaza clientes remotos y exige
ser la primera instancia del pipe. En Unix usa un socket `0600`, propiedad del
UID autorizado, dentro de un directorio administrado por root. No abre TCP.
El bootstrap de servicio entrega una clave nueva de 256 bits exclusivamente por
ese transporte protegido; cada petición y respuesta lleva HMAC-SHA256, hash del
cuerpo, método/estado, ruta, timestamp y nonce. Los nonces caducan y no se reutilizan.
Un hijo iniciado por Electron recibe su clave por stdin, que se cierra después de
leer exactamente 64 caracteres hexadecimales; no usa argumentos ni archivos de claves.

Los procesos autorizados del mismo usuario comparten la confianza del usuario.
La ACL y el HMAC no aíslan procesos maliciosos que ya controlan esa identidad,
ni detienen a un administrador que puede sustituir el intérprete o el verificador.
El código, Python, sus dependencias y las claves públicas deben estar protegidos
por permisos administrativos y la distribución debe autenticarse fuera del propio
manifiesto (firma del instalador). Conservar las comprobaciones de tenant, ADMIN,
desafío y confirmación de contención en Java: no exponer la API del sensor al renderer.

### Preparar y firmar una release

El hook `electron/packageDesktop.cjs` ejecuta este trabajo al empaquetar: prepara
un árbol limpio, compila el sensor con PyInstaller, firma el inventario completo
(incluyendo runtime y scripts) y comprueba el ejecutable con IPC real antes de
incluirlo. La clave pública de Electron se inserta en el package.json del bundle;
la del sensor se compila en su propio ejecutable. El cliente recibe todo preparado.
En CI, los tags de publicación requieren `OMEGA_INTEGRITY_SIGNING_KEY`. Los builds
locales de prueba generan una clave efímera en memoria; no son una release comercial.

Para preparar manualmente un árbol de distribución:

1. Preparar un árbol `omega/` que contenga exactamente los archivos que se van a
   instalar: `api/`, `rag_engine/`, `corpus_mvp/` y `frontend/electron/`.
2. Suministrar una clave privada Ed25519 PEM de CI/offline mediante
   `OMEGA_INTEGRITY_SIGNING_KEY` en el entorno del proceso de firma. Ejecutar
   `python scripts/release_integrity.py --source-tree <árbol-preparado>`.
   El comando incrusta únicamente la clave pública en Python y Electron, y genera
   `integrity-manifest.json` y `integrity-manifest.sig`. No escribe la clave privada.
   La clave privada no se genera automáticamente ni se incluye en este repositorio.
3. Empaquetar ese árbol sin modificar sus `.py`, `.pth` ni el corpus después de
   firmar. Incluir ambos archivos de manifiesto. No sustituir la clave pública en
   tiempo de ejecución: su ancla forma parte del código distribuido.

La clave pública está vacía en el código fuente de desarrollo hasta firmar una
release. Electron empaquetado y el sensor rechazan un manifiesto ausente, inválido,
con archivos modificados, faltantes o inyectados. En desarrollo, Electron muestra
la alerta crítica y permite trabajar sin sensor privilegiado. FastAPI comprueba
la integridad durante su lifespan y no activa vigilancia con integridad inválida.

El intérprete del servicio se inicia con `-I -S`: ignora rutas Python del entorno
y evita ejecutar `.pth` antes de verificar. Se requiere un entorno dedicado,
administrado y sin `.pth`; revisar y retirar los archivos `.pth` del entorno
dedicado durante su preparación, nunca del Python general del equipo. Las rutas
de dependencias se incorporan explícitamente sin ejecutar sus instrucciones.
Windows requiere `pywin32`, incluido de forma condicional en requirements.

### Windows Service

Preparar Python y sus dependencias bajo `Program Files` con permisos de escritura
solo para Administradores/SYSTEM. Desde PowerShell elevado:

```powershell
.\scripts\install_host_sensor.ps1 -TenantId <UUID> -UserSid <SID-del-usuario> -PythonPath 'C:\Program Files\OMEGA-Python\python.exe'
```

`-WhatIf` permite revisar el destino. El instalador copia el árbol a
`Program Files\OMEGA-Sensor` (o un directorio versionado en la preparación automática), verifica la release, compila el pequeño wrapper SCM
auditable `host_sensor_service.cs` y registra `omega-agent` como LocalSystem.
Rechaza destinos existentes para que una actualización no sobrescriba evidencia
ni ejecute código modificado. `-Uninstall` detiene y elimina el servicio, conservando
archivos y bóveda. No se usan tareas programadas ni un Python corriente registrado
como servicio sin implementar el protocolo SCM.

### Linux / macOS

```sh
sudo sh scripts/install_host_sensor.sh <TENANT_UUID> <usuario-UI> /ruta/administrada/python3
```

Instala en `/opt/omega-agent`. En Linux crea `omega-agent.service`, utiliza
`/run/omega-agent/sensor.sock` y mantiene el directorio con `RuntimeDirectory`.
En macOS crea `com.omega.agent` en LaunchDaemons y utiliza
`/var/run/omega-agent/sensor.sock`. `--uninstall` retira el servicio y conserva datos.
Los instaladores no descargan paquetes ni crean una clave de firma. El arranque
permanece bloqueado si la release o el entorno Python no cumplen los requisitos.

### Conectar el gateway y Electron

Ejecutar Java nativamente con `OMEGA_HOST_SOCKET` apuntando al pipe/socket anterior
y `OMEGA_HOST_OWNER_TENANT_ID` configurado. Su RestClient nativo obtiene la clave
por el canal autorizado y autentica cada respuesta. Las rutas del navegador siguen
pasando por el gateway y mantienen RBAC y la validación del tenant.

Electron puede verificar/conectar el servicio con `OMEGA_HOST_SOCKET`, o iniciar
un hijo sin elevación con `OMEGA_START_HOST_SENSOR=1`,
`OMEGA_HOST_OWNER_TENANT_ID` y opcionalmente `OMEGA_SENSOR_PYTHON`.
El hijo sirve para acceso de su proceso padre; no transforma un gateway Docker
en un cliente de pipes del host. No publicar un puente TCP de privilegios abierto.

Docker conserva únicamente su worker sin privilegios, con HMAC mutuo obligatorio
en `docker-compose.yml`; ambos peers reciben `INTERNAL_SERVICE_TOKEN` desde el
entorno en RAM, sin valor estático por defecto. Para ejecución manual generar una
clave nueva en el proceso supervisor y suministrarla a ambos servicios. El sensor
nativo no hereda esa clave. Docker necesita red interna entre contenedores; si se
publica un puerto para diagnóstico, limitarlo a `127.0.0.1`, nunca a todas las interfaces.
El daemon Docker puede conservar variables de contenedores en sus propios metadatos;
la garantía de secreto solo en memoria se aplica al sensor nativo y al cliente desktop,
no al almacenamiento interno de un daemon externo.

Electron migra las claves duraderas de su archivo de secretos y las credenciales
de `.env` a archivos cifrados por `safeStorage`. No persiste la clave IPC efímera.
Si el sistema no ofrece cifrado o Linux selecciona `basic_text`, falla sin guardar
secretos en texto claro. El JWT del renderer sigue exclusivamente en RAM; no se
añade persistencia de sesión ni almacenamiento local del bearer.

## Alcance comprobable

- Muestreo diferencial de conexiones con psutil, intervalo configurable por
  `OMEGA_REALTIME_INTERVAL_SECONDS` (2–300 segundos, 5 por defecto). Puede perder
  conexiones breves; no es un sensor de eventos del kernel ni bloquea tráfico.
- Windows: caché DNS mediante `Get-DnsClientCache`. macOS/Linux: lectura limitada
  de logs de mDNSResponder/systemd-resolved cuando están disponibles. No se activa
  logging adicional ni se atribuye una entrada de caché a un PID. DNS cifrado y
  consultas no registradas pueden quedar fuera de cobertura.
- Java sincroniza el catálogo cada minuto, incluso con la interfaz cerrada. El
  índice se reemplaza atómicamente y reevalúa destinos ya presentes al cambiar.
  El esquema CTI actual no contiene expiración/revocación de indicadores: no se
  presenta una coincidencia histórica como confirmación de C2 activo.
- Firmas Authenticode/codesign y comprobación de integridad dpkg/rpm; esta última
  no constituye una firma del fabricante. `Unknown` y `Unmanaged` no equivalen a
  código alterado. Se mantiene una caché por ruta, mtime y tamaño durante 5 minutos.
- Inventario de persistencia, hashes y perfiles accesibles. Límites: 1500 entradas,
  250 procesos por auditoría (prioridad a nombres críticos), 256 MiB de hash de
  persistencia y 128 MiB de hash de procesos por auditoría, y 512 MiB por archivo.
  Se informan los límites alcanzados.
- La revisión SSH detecta permisos/propietario inseguros; no atribuye una
  modificación a un atacante sin una línea base anterior. Las extensiones con
  permisos sensibles o instalación externa requieren revisión, no son malware
  confirmado. Las firmas de Windows verificadas por catálogo no son una garantía
  sobre la memoria de un proceso.
- Las alertas se deduplican durante 5 minutos y conservan hasta 200 registros en
  RAM hasta el reinicio. La auditoría de Java registra ejecuciones y cambios de
  estado; no conserva automáticamente todos los bytes ni cada alerta del sensor.
- La auditoría es de solo lectura. La contención es una operación separada,
  deshabilitada por defecto y sujeta a autorización, vista previa y desafío en Java.

Los endpoints `/api/host/*` requieren HMAC válido y `X-Host-Tenant`. El cliente
usa `/api/v1/forensics/host/*` a través de Java, con autenticación y rol ADMIN.

## Validación de esta implementación

- Windows: 141 pruebas Python, incluida comunicación real entre Node y el pipe
  con ACL del usuario actual; pywin32 se cargó desde un directorio temporal del proyecto.
- Frontend: 35 pruebas Node y build Vite correctos; se ejercitan DOMPurify con
  jsdom, canales del preload, navegación, firma Ed25519 y cifrado de credenciales.
- Java: 64 pruebas en JDK 21, incluidas integración PostgreSQL/pgvector y pruebas
  nuevas de archivos y HMAC. Se usó una base efímera dedicada y ningún contenedor
  de pruebas recibió acceso al socket Docker.
- Firma: 4 pruebas del script de integridad. Instaladores: sintaxis PowerShell/sh
  comprobada y wrapper SCM compilado; no se instalaron servicios en el equipo.

La instalación efectiva en launchd/systemd y el arranque con una clave privada de
distribución real requieren validación en esos entornos. El perfil systemd restringe
la escritura fuera de sus directorios autorizados; ampliar permisos de contención
solo según la política del despliegue.

`npm audit` informa 13 avisos (8 altos, 5 moderados) en dependencias de desarrollo
y empaquetado, entre ellas Vite y electron-builder. No se aplicaron las migraciones
mayores o retrocesos de versiones que propone automáticamente; requieren una revisión
separada de compatibilidad. DOMPurify no aparece entre los paquetes señalados.

### Revisión posterior de dependencias, persistencia y cobertura

Las cifras de tamaño de versiones anteriores no describen el árbol de trabajo
de Fase 5. `requirements.txt` declara psutil, cryptography, keyring y pywin32
(este último solo para Windows). El Dockerfile instala ese archivo antes de copiar
la aplicación; esta revisión no sustituye una construcción limpia de la imagen.

La contención y el rollback rechazan el alcance `container`. No se añadió una
bóveda persistente al worker Docker: los artefactos cifrados y diarios pertenecen
al sensor nativo. La restauración requiere conservar tanto su directorio de bóveda
como la clave del almacén seguro y la identidad del servicio. La prueba existente
reabre un motor nuevo y restaura los mismos bytes; una regresión adicional comprueba
que Docker no crea la bóveda ni lee los diarios de recuperación.

Esta revisión ejecutó 44 pruebas frontend/Electron y las 48 pruebas de contención
e inteligencia de infraestructura. Las nuevas pruebas montan los componentes React
reales en jsdom con el compilador JSX de Vite y simulan solo la API. Cubren ADMIN,
alcance Docker, fallo del sensor, cancelar una previsualización, contraseña/MFA,
respuestas tardías y limpieza de contraseña USB. También se prueba el validador
usado por main para rechazar ventanas ajenas, subframes y documentos no autorizados.

La división de los paneles grandes y de ForensicBridgeService sigue pendiente.
Sus tamaños justifican revisar responsabilidades, pero no demuestran por sí solos
problemas de renderizado. No se midieron renders ni se hizo una refactorización
de esas pantallas durante esta revisión.
