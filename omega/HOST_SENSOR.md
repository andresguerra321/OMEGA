# Sensor nativo de equipo — Fase 1

El worker forense en Docker sigue analizando artefactos, pero no representa el
equipo anfitrión. La vigilancia y la auditoría de persistencia requieren ejecutar
un worker nativo separado en el equipo que se quiere examinar.

## Windows

1. Instalar Python 3.11+ y las dependencias de `api/requirements.txt` en un entorno
   virtual. Usar el usuario del equipo cuyos perfiles se quieren inspeccionar.
2. Establecer `INTERNAL_SERVICE_TOKEN` en el entorno del sensor con un secreto
   aleatorio exclusivo de al menos 32 caracteres. No pasarlo en la línea de
   comandos ni guardarlo en archivos versionados.
3. Ejecutar `scripts/start_host_sensor.ps1 -TenantId <UUID-del-tenant>`.
   `-EnableRealtime` activa el muestreo al arrancar; también se puede activar
   desde OMEGA. Mantener una sola instancia/proceso Uvicorn.
4. Configurar el backend Java con:
   - `OMEGA_HOST_WORKER_URL`: URL del sensor (por defecto escucha en
     `http://127.0.0.1:8765`).
   - `OMEGA_HOST_INTERNAL_SERVICE_TOKEN`: el mismo secreto exclusivo del sensor.
   - `OMEGA_HOST_OWNER_TENANT_ID`: el UUID del tenant propietario.
5. Reiniciar el backend y acceder con una cuenta ADMIN del tenant propietario.

Si Java está en Docker, su `localhost` no es el equipo. En Docker Desktop usar
una dirección del host alcanzable desde ese contenedor, por ejemplo
`http://host.docker.internal:8765`, y comprobar la conectividad. Si es necesario
usar `-BindAddress`, limitar el acceso con el firewall a la interfaz/red privada
del backend. No exponer este worker a Internet; no sirve una interfaz pública y
no tiene TLS incorporado. Fuera de una red local confiable utilizar un transporte
TLS autenticado. El token y el vínculo al tenant son obligatorios incluso en red
privada. No habilitar `privileged: true` ni montar todo el host en Docker.

El servicio de Windows/Task Scheduler o el supervisor del despliegue puede
mantener este proceso activo y reiniciarlo. El script no instala una tarea,
no eleva permisos ni modifica el arranque del equipo. Ejecutarlo con permisos
administrativos amplía la visibilidad de procesos, tareas y WMI; los permisos
denegados se devuelven como limitaciones, nunca como ausencia de amenazas.

## macOS y Linux

Configurar las mismas variables y ejecutar desde `api/`:

```sh
python -m uvicorn main:app --host 127.0.0.1 --port 8765 --workers 1
```

Establecer `OMEGA_HOST_IOC_SOURCE=gateway` y, opcionalmente,
`OMEGA_REALTIME_ENABLED=true`. Usar un supervisor del sistema según el despliegue.
Los perfiles inspeccionados pertenecen al usuario del servicio: ejecutarlo como
root/SYSTEM no permite inferir automáticamente qué perfiles interactivos revisar.

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
- La auditoría es de solo lectura: no suspende procesos, elimina persistencia ni
  crea reglas de firewall. Esta fase no implementa cuarentena.

Los endpoints `/api/host/*` requieren el token interno y `X-Host-Tenant`. El cliente
usa `/api/v1/forensics/host/*` a través de Java, con autenticación y rol ADMIN.
