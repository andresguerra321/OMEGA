import { animate } from 'motion';
import { createIcons, FileWarning, Laptop, Smartphone, ShieldCheck, Fingerprint, LockKeyhole, ListFilter, Vault, Check } from 'lucide';

/* GUION / 25 s / 1500 frames / 60 fps. Sin cortes, rebotes ni sonido en etapa 1.
  00–04  El IOC ocupa el ingreso. Riesgo de spyware y exposición durante el análisis.
  04–10  Se desliza al escritorio; activa triaje MVT/YARA y sensores HMAC.
  10–17  Baja al RAG; activa vector + léxico, sello tenant y contención autorizada.
  17–22  Llega a bóveda. Se convierte en referencia: el original se purga.
  22–25  Cámara revela las cuatro estaciones; marca y repositorio en el mismo mundo.
  SFX reservados (sin reproducir): 3.5 movement, 5.5 click, 8.3 tick,
  9.5 movement, 12.2 tick, 14.5 success, 16 click, 16.25 movement, 19 success, 21.5 reveal.
*/
createIcons({ icons: { FileWarning, Laptop, Smartphone, ShieldCheck, Fingerprint, LockKeyhole, ListFilter, Vault, Check }, attrs: { 'stroke-width': 1.75 } });
window.VIDEO = { w: 1920, h: 1080, duration: 25, fps: 60 };
const renderMode = new URLSearchParams(location.search).has('render');
document.documentElement.classList.toggle('render', renderMode);
document.documentElement.classList.toggle('editor', import.meta.env.DEV && !renderMode);

// Literal keyframes let Motion Studio edit source. All transforms are Motion-owned.
const camera = animate('#world', {
  x: [0, 0, -1395, -1395, -1395, -1395, 0, 0, -372, -372],
  y: [0, 0, 0, 0, -945, -945, -945, -945, -252, -252],
  scale: [1.05, 1.05, .9, .9, .9, .9, .9, .9, .48, .48],
}, { duration: 25, times: [0, .14, .22, .38, .45, .65, .73, .86, .94, 1], ease: ['easeOut', 'easeOut', 'easeOut', 'easeOut', 'easeOut', 'easeOut', 'easeOut', 'easeOut', 'easeOut'], autoplay: false });
const artifact = animate('#artifact', {
  x: [0, 0, 1090, 2010, 2010, 1820, 1990, 1990, -415, -415, -415],
  y: [115, 115, 180, 180, 180, 1050, 1150, 1150, 1082, 1082, 1082],
  rotate: [-5, -5, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  scale: [1, 1, 1, 1, 1, 1, 1, 1, .75, .75, .75],
  borderRadius: ['8px', '8px', '8px', '8px', '8px', '8px', '8px', '8px', '36px', '36px', '36px'],
}, { duration: 25, times: [0, .14, .22, .332, .38, .46, .56, .65, .73, .88, 1], ease: ['easeOut', 'easeOut', 'easeOut', 'easeOut', 'easeOut', 'easeOut', 'easeOut', 'easeOut', 'easeOut', 'easeOut'], autoplay: false });
const scan = animate('#scan-fill', { scaleX: [0, 0, 1, 1] }, { duration: 25, times: [0, .22, .332, 1], ease: ['linear', 'linear', 'linear'], autoplay: false });
const vector = animate('#vector-fill', { scaleX: [0, 0, 1, 1] }, { duration: 25, times: [0, .46, .51, 1], ease: ['easeOut', 'easeOut', 'easeOut'], autoplay: false });
const lexical = animate('#lexical-fill', { scaleX: [0, 0, 1, 1] }, { duration: 25, times: [0, .49, .55, 1], ease: ['easeOut', 'easeOut', 'easeOut'], autoplay: false });
const tenant = animate('#tenant-seal', { opacity: [0, 0, 1, 1] }, { duration: 25, times: [0, .46, .49, 1], ease: ['linear', 'linear', 'linear'], autoplay: false });
const containment = animate('#containment', { opacity: [0, 0, 1, 1], y: [8, 8, 0, 0] }, { duration: 25, times: [0, .628, .652, 1], ease: ['easeOut', 'easeOut', 'easeOut'], autoplay: false });
const vault = animate('#vault-result', { opacity: [0, 0, 1, 1] }, { duration: 25, times: [0, .748, .78, 1], ease: ['linear', 'linear', 'linear'], autoplay: false });
// Overdamped spring: editable in Studio, without overshoot or a bouncing seal.
const lock = animate('#vault-lock', { opacity: [0, 1], scale: [.85, 1] }, { delay: 18.7, type: 'spring', stiffness: 260, damping: 34, mass: 1, autoplay: false });
const brand = animate('#end-brand', { opacity: [0, 0, 1, 1], y: [12, 12, 0, 0] }, { duration: 25, times: [0, .89, .94, 1], ease: ['easeOut', 'easeOut', 'easeOut'], autoplay: false });
const tracks = [camera, artifact, scan, vector, lexical, tenant, containment, vault, lock, brand];
const iocIcon = document.querySelector('#artifact svg').outerHTML;
const referenceIcon = document.querySelector('.tenant-heading>svg').outerHTML;
window.omegaTracks = tracks;
window.seek = (time) => {
  const t = Math.max(0, Math.min(25, Number(time) || 0));
  tracks.forEach(track => { track.time = t; });
  document.querySelector('#triage-state').textContent = t < 5.5 ? 'Esperando artefacto' : t < 8.3 ? 'Inspección en RAM' : 'Triaje completado';
  document.querySelector('#rag-state').textContent = t < 14.5 ? 'Correlación en curso' : 'Correlación con citas';
  document.querySelector('#artifact-tag').textContent = t < 19 ? 'IOC' : 'SHA-256';
  document.querySelector('#artifact svg').outerHTML = t < 19 ? iocIcon : referenceIcon;
  document.querySelector('#scrub').value = t;
  document.querySelector('#time').textContent = `${t.toFixed(2).padStart(5, '0')} / 25.00`;
  window.omegaTime = t;
};

// The player clock never owns scene state: exports use the same seek(t), in any order.
let playing = false, origin = 0, offset = 0;
const playButton = document.querySelector('#play');
function pause() { playing = false; offset = window.omegaTime; playButton.textContent = 'Reproducir'; }
playButton.addEventListener('click', () => {
  if (playing) return pause();
  offset = window.omegaTime >= 25 ? 0 : window.omegaTime;
  origin = performance.now(); playing = true; playButton.textContent = 'Pausar';
});
document.querySelector('#scrub').addEventListener('input', event => { pause(); offset = +event.target.value; window.seek(offset); });
function resize() {
  if (renderMode) return;
  const scale = Math.max(.1, Math.min(innerWidth / 1920, (innerHeight - (import.meta.env.DEV ? 490 : 110)) / 1080));
  document.querySelector('#preview').style.width = `${1920 * scale}px`;
  document.querySelector('#preview').style.height = `${1080 * scale}px`;
  document.querySelector('#stage').style.transform = `scale(${scale})`;
}
addEventListener('resize', resize);
resize(); window.seek(0);
if (!renderMode) requestAnimationFrame(function tick(now) {
  if (playing) { window.seek(offset + (now - origin) / 1000); if (window.omegaTime >= 25) pause(); }
  requestAnimationFrame(tick);
});
