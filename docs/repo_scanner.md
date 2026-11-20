# OMEGA Repo Scanner (Análisis Estático y Contexto de Cadena de Suministro)

## Alcance y Principios
- **Solo análisis estático en RAM/tmpfs:** OMEGA nunca ejecuta `npm install`, `pip install`, `setup.py`, ni scripts de repositorios analizados.
- **Validación de archivos:** todo `.zip`, `.tar`, `.tgz` o `.tar.gz` pasa antes por `omega/api/archive_safety.py` (bloqueo de Zip-Slip, symlinks y bombas de descompresión).
- **Zero-Retention:** el contenido fuente no se guarda en PostgreSQL ni en disco persistente; los resultados en RAM expiran tras 10 minutos (`SCAN_TTL_SECONDS = 600`).

## Señales Implementadas (v1 + Contexto)
| Regla | Peso | Qué detecta |
|---|---|---|
| `NPM-POSTINSTALL-EXEC-01` | 35 | Scripts `preinstall`/`install`/`postinstall` con descarga o shell remoto. |
| `PYPI-SETUP-EXEC-01` | 35 | Llamadas a `subprocess`, `os.system`, `urlopen` o `exec` en `setup.py`. |
| `SECRET-EXFIL-01` | 25 | Referencias a webhooks o túneles externos de exfiltración. |
| `PKG-NEW-OR-RECENT-01` | 15 | Paquete publicado por primera vez hace menos de 14 días. |
| `PKG-MAINTAINER-CHANGE-01` | 25 | Cambio reciente de mantenedor/publicador en metadatos de registry. |
| `PKG-MALICIOUS-ADVISORY-01` | 50 | Coincidencia con advisory de paquete malicioso (`MAL-`). |
| `PKG-TEMPORAL-CHAIN-01` | 30 | Correlación temporal: cambio de mantenedor + script de instalación. |

## Qué NO detecta y Límites Conocidos
- **Nunca certifica seguridad absoluta:** un puntaje `0/100` se reporta como *"Sin señales detectadas con las reglas actuales"*, nunca como *"repo seguro"*.
- **No analiza binarios compilados ni ejecución dinámica en sandbox.**
- **Falsos positivos conocidos:** paquetes legítimos recién publicados (`< 14` días) o compiladores nativos que usan `postinstall`/`setup.py` con `subprocess` para compilar extensiones.
- **Límites de APIs externas:** las consultas de metadatos a npm/PyPI usan timeout (`5s`), caché en RAM (`300s`) y degradan de forma elegante si no hay red (`None`).
