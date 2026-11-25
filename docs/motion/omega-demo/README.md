# OMEGA · Demo one-take · etapa 1

Escena editable: **25 s / 1920 × 1080 / 16:9 / 60 fps / 1500 fotogramas**. Un artefacto recorre cuatro estaciones fijas; la cámara no corta. Tipografía Geist local, iconos Lucide, fondo OMEGA a 15 %, superficies `#111216`, borde blanco a 8 % y azul `#2F6FED` para estados activos. No hay audio ni máster final.

## Abrir Motion Studio

Desde la raíz del repositorio, en PowerShell:

```powershell
cd docs/motion/omega-demo
npm.cmd ci
npm.cmd run dev
```

Abre **http://127.0.0.1:5178/**. El botón de timeline de Motion Studio abre las diez animaciones nativas `animate()` de `scene.js`. La reproducción propia empieza pausada: puedes usar el editor sin un reloj externo sobrescribiendo tus ajustes. Pausa «Reproducir» antes de editar en Studio. Cada pista tiene 25 s salvo el resorte del cierre, que empieza en 18,7 s. Los valores y curvas están escritos como literales para que el editor los pueda modificar.

- `camera`: posición y zoom de todo el mundo.
- `artifact`: el único artefacto, su recorrido y transformación en referencia.
- `scan`, `vector`, `lexical`: reacción de los motores al paso del artefacto.
- `tenant`, `containment`, `vault`, `lock`: aislamiento, autorización y custodia.
- `brand`: cierre dentro del mismo mundo.

`lock` usa un resorte sobreamortiguado (`stiffness: 260`, `damping: 34`, `mass: 1`), sin rebote. Las curvas restantes desaceleran por tramo; no se aplica una curva al reloj completo de 25 s. Conserva esa separación al editar para evitar adelantar la aparición de elementos.

La [documentación de Motion Studio](https://motion.dev/docs/studio) indica que editar visualmente es gratuito y aplicar al código requiere Motion+ o Motion Cloud. No se configuraron cuentas, agentes ni suscripciones. Las skills solicitadas están instaladas en `.agents/skills/` y fijadas en `skills-lock.json`; el catálogo de skills las reconocerá en el próximo turno. Esta escena ya aplica sus instrucciones leídas desde disco.

## Guion visual

| Tiempo | Fotogramas a 60 fps | Acción y reacción |
| --- | --- | --- |
| 0–4 s | 0–239 | «El riesgo entra contigo». Artefacto IOC frente al riesgo de spyware y exposición durante el análisis. El paneo comienza en 3,5 s. |
| 4–10 s | 240–599 | Entrada al escritorio OMEGA; el archivo recorre el carril MVT/YARA, activa la lectura de triaje y pasa por sensores HMAC. |
| 10–17 s | 600–1019 | Descenso al RAG híbrido: se completan los carriles vectorial y léxico; aparece el sello de tenant, la correlación con citas y la contención autorizada. |
| 17–22 s | 1020–1319 | El archivo llega al centro de la bóveda y se transforma en referencia SHA-256. El original se elimina; se explica la retención opcional de MinIO. |
| 22–25 s | 1320–1499 | Apertura de cámara iniciada en 21,5 s: revela todas las estaciones y el wordmark con la URL real del repositorio. |

El guion también vive como comentario al comienzo de `scene.js`. Es una explicación editorial con UI reconstruida a partir de los componentes reales, no una ejecución ni una lectura de telemetría en vivo.

## Evidencia y métricas

`evidence.json` relaciona cada afirmación con el código local. Se revisaron `README.md`, `PRODUCT.md`, navegación, escritorio, panel MVT, contención y ambos JPG solicitados. Se reutilizaron el fondo real y el showcase; el isotipo de cierre conserva el trazado de `OmegaBrandMark.jsx`. No se cambió el frontend ni sus hooks/API/IPC.

**Zero-Retention y guardar el original en MinIO son políticas distintas.** El escenario principal representa el original convertido en referencia verificable. MinIO local retiene el original solo si se habilita retención. El aislamiento físico depende también de la configuración de red; la película representa el modo soberano local.

**`0 Critical` y `392+ tests passing` quedan pendientes de evidencia.** No se encontró un informe que pruebe ambas métricas para este commit. No se muestran como resultados verificados ni se sustituyen por una auditoría de las dependencias de esta demo. Para incorporarlas en el cierre hacen falta el informe de seguridad y la salida de CI con alcance y commit.

## Comprobar y regenerar el borrador

```powershell
npm.cmd run build
npm.cmd run serve:render
```

En otra terminal, desde la misma carpeta:

```powershell
npm.cmd run check
npm.cmd run preview:mute
```

La captura usa **http://127.0.0.1:5179/**, la compilación de producción, para excluir el panel de Studio. `?render` fija el lienzo a 1920 × 1080 y oculta los controles. `window.VIDEO` y `window.seek(t)` permiten capturar cualquier instante, fuera de orden. En Windows la comprobación reutiliza Edge con Playwright; en otros sistemas instala Chromium mediante `npx playwright install chromium`. Se necesita FFmpeg en PATH.

`preview/omega-draft-muted.mp4` es una **copia de revisión 960 × 540 / 60 fps**, sin audio y sin motion blur. El código de composición conserva resolución completa. `preview/checks.json` registra configuración, encuadre muestreado cada tres fotogramas, fuente, artefacto único y comparación de una captura repetida tras navegar fuera de orden. Las imágenes `preview/frame-*.jpg` se capturan a 1920 × 1080.

## Etapa 2 pendiente

No ejecutar el pase sonoro hasta recibir la indicación del usuario. `cues.json` deja eventos propuestos para `sound-effects`, sin archivos sonoros ni mezcla. Recalcular sus tiempos después de ajustar las curvas y aplicar los cambios al código. Entonces se eligen música y SFX reales, se comprueban licencias y se mide el MP4 exportado. No sintetizar pitidos.

Skills: [Barty-Bart/motion-graphics](https://github.com/Barty-Bart/motion-graphics), `explainer-engaging` y `sound-effects`. El enfoque del pase sonoro de la skill acredita a [Voxyz_ai](https://x.com/Voxyz_ai/status/2109358372873183564). Geist: SIL OFL, licencia junto al WOFF2. Lucide: ISC. Los assets de OMEGA proceden de este repositorio.
