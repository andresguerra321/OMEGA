# Inicio y recuperación local

El instalador Windows incluye las imágenes de PostgreSQL, el worker y el backend.
El equipo receptor necesita Docker Desktop instalado con soporte para contenedores Linux.
OMEGA intenta iniciarlo si está detenido. No requiere Maven, Python ni un archivo `.env` del usuario.
La autenticación y recuperación local no requieren SMTP. Las funciones que utilizan proveedores externos siguen necesitando su configuración y conexión.

El acceso a la aplicación exige registro o inicio de sesión con credenciales. No existe un modo de entrada anónimo, operador predeterminado ni un ajuste que lo habilite.
La actualización v2.0.7 invalida las sesiones anteriores y desactiva la antigua identidad sintética sin borrar sus documentos.
El remitente SMTP pertenece a la instalación y puede ser distinto del destinatario registrado. Las credenciales SMTP no se empaquetan en el instalador.

En el primer inicio se generan secretos propios de la instalación y una configuración en el directorio de datos de Tauri (`com.omega.security.desktop`).
Si existe una instalación Compose del proyecto `omega`, se importan sus credenciales y el volumen PostgreSQL existente.
Los inicios siguientes utilizan `bootstrap.env` en ese directorio, sin buscar archivos en carpetas ajenas.
La configuración guardada en la interfaz tiene prioridad. `OMEGA_ENV_FILE` permite un override explícito para desarrollo.

- Misma versión, configuración e imágenes y todos los servicios sanos: reutilizar.
- Contenedores detenidos: iniciar y esperar la salud de PostgreSQL, worker y backend.
- Nueva versión o contenido de paquete diferente: respaldar PostgreSQL en `backups/*.dump`, cargar las imágenes incluidas y actualizar los servicios. Flyway aplica las migraciones pendientes.
- Versión anterior a la instalada: detener el arranque con un mensaje de incompatibilidad.
- Contenedores con nombres reservados que pertenecen a otro proyecto: detenerse sin reemplazarlos.
- Dos ejecutables a la vez: serializar el arranque y los cambios de configuración mediante un bloqueo del sistema operativo.

El flujo no elimina los volúmenes. Si falla el respaldo se detiene la actualización. Un respaldo permite restauración manual mediante `pg_restore`; no se aplica una restauración automática sobre los datos del usuario.

Al registrar una cuenta se genera una clave de recuperación de un solo uso. Se muestra antes de entrar y debe guardarse fuera de OMEGA.
La base solo conserva SHA-256 de la clave. Recuperar la contraseña consume la clave dentro de la misma transacción.
Las cuentas existentes pueden generar o reemplazar su clave desde Seguridad, validando su contraseña actual.
Si se pierde la contraseña y nunca se guardó una clave, no se habilita una puerta de acceso automática a los datos.
El correo es opcional; un fallo de envío se informa y los códigos no se escriben en logs.

Para generar el instalador: `npm run tauri:build` en `omega/frontend`. La máquina de empaquetado construye y exporta las imágenes Docker; necesita Docker y acceso a las dependencias de compilación.
Se debe distribuir el instalador generado en `src-tauri/target/release/bundle/nsis/`, que incluye los recursos, no solo el binario suelto de `target/release`.

Validación:

```powershell
npm test
cargo test --lib --manifest-path src-tauri/Cargo.toml
python -m unittest discover -s ../scripts -p test_stage_desktop_resources.py
# Tras construir las imágenes, prueba aislada; no utiliza la base del usuario:
python ../scripts/smoke_local_recovery.py
```
