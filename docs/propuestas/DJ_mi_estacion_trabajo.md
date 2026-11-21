# Propuesta Técnica — Bloque DJ (`[PAUSA]`): Mi Estación de Trabajo (Postura de Desarrollo Local)

## 1. Objetivo
En la versión de escritorio de OMEGA (Tauri / Electron), permitir al desarrollador auditar en **solo lectura y bajo consentimiento explícito** si su estación de trabajo local presenta vectores de robo de credenciales de desarrollo (archivos de tokens en texto plano sin permisos restrictivos, agentes SSH expuestos, helpers de credenciales de Git sin cifrar o extensiones/procesos sospechosos).

## 2. Principios no negociables (Zero-Retention & Privacidad)
1. **Consentimiento explícito por ejecución:**
   - Nunca se ejecuta en segundo plano ni al arrancar la aplicación. El usuario debe pulsar *"Auditar postura local (solo lectura)"* tras ver exactamente qué rutas de metadatos se comprobarán.
2. **Solo metadatos de permisos y presencia, NUNCA lectura de secretos:**
   - El inspector local verifica únicamente **existencia de archivo y máscara de permisos POSIX/ACL** (`stat` / `icacls`), sin abrir ni leer el contenido de `~/.ssh/id_*`, `~/.npmrc`, `~/.pypirc`, `~/.aws/credentials`, `~/.git-credentials` o `.env`.
3. **Procesamiento local sin persistencia de rutas personales:**
   - Los nombres de usuario del sistema operativo se normalizan a `~/` o `%USERPROFILE%` antes de mostrarse en pantalla. Si el usuario decide adjuntar el resumen de postura a un reporte, solo se registran códigos de control (`DEV-WS-SSH-PERMS`, `DEV-WS-NPMRC-PLAINTEXT`, `DEV-WS-GIT-CREDSTORE`) y su estado (`PASS` / `WARN`).

## 3. Controles propuestos (para aprobación antes de implementar)
- `DEV-WS-01`: Permisos demasiado abiertos en llaves privadas SSH (`~/.ssh/id_rsa`, `id_ed25519`).
- `DEV-WS-02`: Presencia de `.git-credentials` o `.npmrc` / `.pypirc` en el directorio home sin almacén de credenciales del sistema (Keychain / Credential Manager / libsecret).
- `DEV-WS-03`: Configuración global de Git (`core.hooksPath` apuntando a directorios escribibles por terceros o `credential.helper=store`).
- `DEV-WS-04`: Variables de entorno globales persistentes con prefijos de tokens de producción (`GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `NPM_TOKEN`) expuestas a cualquier proceso hijo.
