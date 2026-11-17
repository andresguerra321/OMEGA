# Fase 3: contención y cuarentena

## Activación

Se usa el sensor nativo descrito en `HOST_SENSOR.md`, vinculado a un único tenant.
El worker en Docker no ejecuta contención sobre el equipo anfitrión.

- Instalar las dependencias actualizadas de `api/requirements.txt` en el entorno
  del sensor. `keyring` debe seleccionar Windows Credential Manager, macOS
  Keychain, Secret Service o KWallet. Se rechazan backends en texto plano y no
  existe una clave de fallback en variables de entorno.
- El administrador del despliegue debe configurar `OMEGA_CONTAINMENT_ENABLED=true`
  en el proceso nativo. Por defecto solo se admite previsualización.
- Ejecutar con permisos del SO suficientes para la acción solicitada; la app no
  eleva privilegios ni instala un servicio administrativo automáticamente.
- Configurar `OMEGA_PROTECTED_HOSTS` con los nombres/IP de todos los servidores
  de OMEGA que deban quedar fuera del bloqueo. Se incorporan las interfaces,
  servidores DNS configurados y hosts definidos en las variables del backend,
  worker y PostgreSQL. Una resolución fallida de un servidor protegido cancela
  la operación. Las variables deben describir direcciones alcanzables desde el
  sensor nativo, no nombres exclusivos de la red interna Docker.
- `OMEGA_PROTECTED_PIDS` permite añadir PIDs que nunca deben suspenderse. Los
  procesos críticos, el propio runtime y su cadena de ejecución ya están excluidos.

El cliente llama a Java con sesión autenticada ADMIN. Aplicar y restaurar requiere
contraseña actual y un desafío nuevo si la cuenta tiene 2FA. El sensor requiere
además token interno, tenant propietario y un plan previo vinculado al actor.
Usar loopback o una conexión TLS autenticada; nunca exponer el sensor a Internet.

## Operaciones

1. **Previsualizar** (`dryRun=true`): solo lectura del objetivo y del estado del SO;
   no crea reglas, no suspende procesos ni modifica archivos. El token de plan
   caduca en tres minutos y deja de ser válido al reiniciar el sensor.
2. **Aplicar**: se revalida la identidad y el plan. Una copia autenticada del diario
   se escribe antes de cada efecto. Si algo falla se intenta compensar; si no se
   puede, se informa `RECOVERY_REQUIRED`.
3. **Restaurar**: se autentica el diario, se comprueba la evidencia y se intenta
   recuperar el estado previo. No se sobrescribe un archivo diferente ni se
   reanuda un PID que pertenece ahora a otro proceso.

El nombre de contrato `SUSPEND_OR_TERMINATE_PROCESS` se conserva, pero solo admite
`mode=suspend`. Terminar un proceso destruye su estado y no es reversible. Si un
proceso suspendido termina por otra causa, no se puede resucitar su memoria.

El bloqueo de dominios congela las IP públicas resueltas y aprobadas en el plan;
no sigue rotaciones DNS y una IP compartida puede afectar otros servicios. No se
admiten rangos, loopback, direcciones privadas, multicast o direcciones especiales.
Las reglas se etiquetan `OMEGA_SHIELD_<action_id>` y se retiran individualmente.

Windows usa `netsh`, Linux usa una tabla `inet omega_shield` en nft o reglas
etiquetadas iptables como fallback IPv4. No se vacía el ruleset del sistema.
Para macOS, un administrador debe preparar y validar previamente en su `pf.conf`
un punto `anchor "com.omega.shield/*"` y la carga del archivo dedicado:

```text
load anchor "com.omega.shield" from "/etc/pf.anchors/com.omega.shield"
```

El archivo dedicado debe existir inicialmente con el encabezado
`# OMEGA managed containment anchors`. PF debe estar activo. OMEGA conserva allí
las referencias a sus archivos de acción y manipula solo el ancla correspondiente;
no habilita PF ni recarga el firewall global. La posición y evaluación del ancla
deben validarse contra las reglas y estados existentes del equipo antes de usarlo.

Las reglas de nft/iptables pueden perderse al reiniciar el SO o recargar un
firewall externo; no se instala persistencia global. El historial distingue la
acción registrada de `observedState` (`VERIFIED_ACTIVE`, `DRIFTED`, `UNKNOWN` o
`NOT_CHECKED`). Se comprueban como máximo cinco acciones de red por consulta,
con dos segundos por comprobación. Una regla cargada no garantiza que todos los
flujos existentes hayan quedado cortados: la política y el estado del firewall
también influyen. No se envía una afirmación de «conexión cortada» sin esa medición.

## Evidencia y recuperación

La bóveda predeterminada es `~/.omega/quarantine`. Tanto los manifiestos como los
archivos `.quar` usan AES-256-GCM; las claves derivan mediante HKDF de material
aleatorio conservado en el almacén seguro del SO. Se vinculan al tenant y a la ruta
de la bóveda. No mover esa ruta ni cambiar de cuenta/tenant sin un procedimiento
de migración de claves. Perder la clave impide descifrar: conservar un respaldo
administrado de la bóveda y del almacén seguro antes de depender de la restauración.

Se conservan SHA-256, ruta, momento de la acción, datos de rollback y metadatos
del archivo. Solo se retira el original después de autenticar la copia cifrada y
deshabilitar el arranque. Se rechazan enlaces y archivos mayores de 64 MiB.
La captura conserva un identificador abierto del archivo y comprueba su identidad.
Windows impide escrituras y cambios de nombre durante la captura, y retira el
objeto por ese identificador. Unix ancla la operación al directorio abierto y
rechaza directorios modificables por otras cuentas; un archivo directamente en
`/tmp` necesita primero una captura especializada. Una sustitución detectada
cancela el retiro y conserva la evidencia disponible.
Archivos NTFS con flujos alternativos requieren una captura especializada y no
se retiran. Se preserva el descriptor de seguridad Windows o propietario y
atributos extendidos Unix cuando corresponda. No se promete conservar el mismo
inode/file ID al restaurar una copia: la identidad original queda en el manifiesto.

Se admiten Run/RunOnce, tareas programadas, LaunchAgents/Daemons y unidades systemd
habilitables. No se deshabilitan WMI, extensiones, unidades estáticas o mecanismos
no soportados. Deshabilitar arranque no termina procesos ya ejecutándose.
La restauración no reactiva configuraciones modificadas por terceros.

Los archivos cifrados se conservan después de restaurar. Las operaciones y sus
resultados se registran también en la cadena de auditoría Java. No existe una
transacción distribuida atómica entre el SO, el disco y PostgreSQL: ante un corte,
un error de permisos o una modificación externa, consultar el diario/historial y
resolver `RECOVERY_REQUIRED` antes de declarar una restauración completa.

## Infraestructura fresca y evasión

RDAP y Certificate Transparency son consultas a terceros con caché y tiempos
acotados. El dominio registrable se obtiene de una copia local de Public Suffix
List. CT se pagina de forma acotada; una respuesta incompleta o indisponible se
representa como desconocida, no como certificado inexistente o sitio seguro.

La comparación móvil/genérica requiere marcar la opción del cliente. Contacta al
sitio desde el servicio, sin cookies, credenciales, JavaScript ni imágenes. Cada
redirección vuelve a validar y fijar una dirección pública para evitar SSRF y
rebinding. Se limitan saltos, tamaño y presupuesto de lectura, incluso para
respuestas lentas. No se contacta automáticamente un enlace extraído de una captura.

Dominios nuevos, certificados recientes/gratuitos, IDN y diferencias de respuesta
son señales heurísticas. No atribuyen por sí solas una campaña de spyware. Una
combinación de señales puede elevar HIGH/CRITICAL sin coincidencias STIX; la
explicación conserva las razones y las fuentes/limitaciones disponibles.

Referencias de implementación: [CT Search API v1](https://sslmate.com/help/reference/ct_search_api_v1),
[anclas PF](https://man.openbsd.org/man5/pf.conf.5) y
[Modo de aislamiento de Apple](https://support.apple.com/es-es/105120).
