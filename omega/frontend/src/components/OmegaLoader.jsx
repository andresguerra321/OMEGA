import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EASE_OUT, SPRING_SOFT } from '../lib/motion';

const DEFAULT_STEPS = [
  'Verificando sesión',
  'Contactando el servicio local',
  'Preparando la interfaz',
];

const STARS = Array.from({ length: 16 }, (_, idx) => ({
  angle: idx * 2.39996,
  distFrac: 0.72 + ((idx * 17) % 44) / 100,
  speed: 0.04 + (idx % 4) * 0.015,
  size: 0.7 + (idx % 3) * 0.35,
  alpha: 0.25 + (idx % 5) * 0.12,
}));

function drawConicTrailRing(ctx, cx, cy, radius, lineWidth, startAngle, maxAlpha) {
  ctx.save();
  ctx.lineWidth = lineWidth;
  if (typeof ctx.createConicGradient === 'function') {
    const grad = ctx.createConicGradient(startAngle, cx, cy);
    grad.addColorStop(0.0, `rgba(255, 255, 255, ${maxAlpha})`);
    grad.addColorStop(0.22, `rgba(235, 240, 250, ${maxAlpha * 0.55})`);
    grad.addColorStop(0.55, `rgba(210, 220, 238, ${maxAlpha * 0.12})`);
    grad.addColorStop(0.85, 'rgba(255, 255, 255, 0)');
    grad.addColorStop(1.0, `rgba(255, 255, 255, ${maxAlpha * 0.85})`);
    ctx.strokeStyle = grad;
  } else {
    ctx.strokeStyle = `rgba(255, 255, 255, ${maxAlpha * 0.45})`;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawEclipseFrame(ctx, canvas, tSec) {
  const rect = canvas.getBoundingClientRect();
  const cssSize = Math.max(180, Math.min(rect.width || 320, rect.height || 320));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetPx = Math.round(cssSize * dpr);
  if (canvas.width !== targetPx || canvas.height !== targetPx) {
    canvas.width = targetPx;
    canvas.height = targetPx;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);

  const cx = cssSize / 2;
  const cy = cssSize / 2;
  const R = cssSize * 0.43;
  const eclipseAngle = 2.4 + tSec * 0.62;

  const ambient = ctx.createRadialGradient(cx, cy, R * 0.18, cx, cy, R * 1.12);
  ambient.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
  ambient.addColorStop(0.45, 'rgba(225, 232, 244, 0.05)');
  ambient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = ambient;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
  ctx.fill();

  drawConicTrailRing(ctx, cx, cy, R * 0.92, R * 0.11, -tSec * 0.32 + 0.9, 0.13);
  drawConicTrailRing(ctx, cx, cy, R * 0.78, R * 0.065, tSec * 0.48 + 2.2, 0.24);
  drawConicTrailRing(ctx, cx, cy, R * 0.64, R * 0.035, -tSec * 0.65 + 4.1, 0.3);

  ctx.save();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.64, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const comets = [
    { r: R * 0.78, a: tSec * 0.62 + 1.4, span: 0.18, w: 2.0, alpha: 0.9 },
    { r: R * 0.92, a: -tSec * 0.38 + 4.3, span: 0.11, w: 1.5, alpha: 0.75 },
  ];
  comets.forEach((c) => {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.85)';
    ctx.shadowBlur = 7;
    ctx.strokeStyle = `rgba(255, 255, 255, ${c.alpha})`;
    ctx.lineWidth = c.w;
    ctx.beginPath();
    ctx.arc(cx, cy, c.r, c.a, c.a + c.span);
    ctx.stroke();
    ctx.restore();
  });

  const arms = 34;
  const rings = 5;
  const spinOffset = tSec * 0.16;
  for (let i = 0; i < arms; i += 1) {
    const baseA = (i / arms) * Math.PI * 2 + spinOffset;
    for (let j = 0; j < rings; j += 1) {
      const frac = j / (rings - 1);
      const r = R * (0.335 + frac * 0.27);
      const a = baseA + frac * 0.38;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      const align = Math.cos(a - eclipseAngle);
      const radialFade = 1 - frac * 0.55;
      const alpha = Math.max(0.06, Math.min(0.88, (0.36 + 0.34 * align) * radialFade));
      const dotR = j === 0 ? 1.15 : 0.95;
      ctx.fillStyle = `rgba(244, 246, 252, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px, py, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  STARS.forEach((s) => {
    const a = s.angle + tSec * s.speed;
    const r = R * s.distFrac;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha})`;
    ctx.beginPath();
    ctx.arc(px, py, s.size, 0, Math.PI * 2);
    ctx.fill();
  });

  const coreR = R * 0.275;
  const gx = cx + Math.cos(eclipseAngle) * (coreR * 0.14);
  const gy = cy + Math.sin(eclipseAngle) * (coreR * 0.14);
  const rimGlow = ctx.createRadialGradient(gx, gy, coreR * 0.72, gx, gy, coreR * 1.48);
  rimGlow.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
  rimGlow.addColorStop(0.55, 'rgba(232, 238, 248, 0.10)');
  rimGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = rimGlow;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR * 1.48, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(255, 255, 255, 0.95)';
  ctx.shadowBlur = 12;
  const arcSpan = Math.PI * 0.92;
  const arcGrad = ctx.createRadialGradient(
    cx + Math.cos(eclipseAngle) * coreR,
    cy + Math.sin(eclipseAngle) * coreR,
    2,
    cx,
    cy,
    coreR * 1.15,
  );
  arcGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  arcGrad.addColorStop(0.65, 'rgba(242, 245, 252, 0.55)');
  arcGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.strokeStyle = arcGrad;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, eclipseAngle - arcSpan / 2, eclipseAngle + arcSpan / 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Pantalla de carga Eclipse Orbital OMEGA en Canvas 2D (60 FPS) + Framer Motion:
 * disco negro con creciente rotatorio, corona espiral y anillos cónicos difuminados.
 */
export function OmegaLoader({
  steps = DEFAULT_STEPS,
  label = 'Iniciando OMEGA',
  stepIntervalMs = 1400,
}) {
  const [stepIdx, setStepIdx] = useState(0);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (steps.length < 2) return undefined;
    const timer = setInterval(() => {
      setStepIdx((i) => Math.min(i + 1, steps.length - 1));
    }, stepIntervalMs);
    return () => clearInterval(timer);
  }, [steps, stepIntervalMs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    if (prefersReduced) {
      drawEclipseFrame(ctx, canvas, 0);
      return undefined;
    }

    let rafId = 0;
    const start = performance.now();
    const tick = (now) => {
      drawEclipseFrame(ctx, canvas, (now - start) / 1000);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-label={label}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1, transition: SPRING_SOFT }}
      exit={{ opacity: 0, scale: 1.03, transition: { duration: 0.22, ease: EASE_OUT } }}
      className="relative z-10 flex flex-col items-center gap-3"
    >
      <div className="relative h-[300px] w-[300px] sm:h-[340px] sm:w-[340px] flex items-center justify-center">
        <canvas ref={canvasRef} className="h-full w-full block" aria-hidden="true" />
      </div>

      <div className="flex flex-col items-center gap-2">
        <span className="font-display text-[13px] font-semibold tracking-[0.44em] text-[#F2F2F4] pl-[0.44em]">
          OMEGA
        </span>

        <div className="h-[16px] overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.span
              key={stepIdx}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE_OUT } }}
              exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
              className="block font-tech text-[11px] uppercase tracking-[0.14em] text-[#8A8B94]"
            >
              {steps[stepIdx]}…
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
