import { useEffect, useId, useRef } from 'react';
import { OmegaLogo } from './OmegaLogo';

/**
 * OmegaReflexEmblem — Halo gravitacional y órbita fotónica estilo Reflex
 * alrededor del escudo OMEGA en azul noche / cobalto contenido.
 */
export function OmegaReflexEmblem({
  variant = 'hero',
  size = 64,
  isThinking = false,
  className = '',
}) {
  const uid = useId().replace(/:/g, '');

  if (variant === 'mini') {
    const ringSpan = Math.round(size * 1.45);
    const orbitId = `omegaReflexMini-${uid}`;
    return (
      <div
        style={{ width: ringSpan, height: Math.round(size * 1.15) }}
        className={`relative inline-flex items-center justify-center select-none shrink-0 ${className}`}
        aria-hidden="true"
      >
        <div
          className={`absolute inset-0 rounded-full blur-md transition-opacity duration-300 ${
            isThinking ? 'bg-[#2563EB]/45 opacity-95' : 'bg-[#1D4ED8]/25 opacity-70'
          }`}
        />

        {/* Anillo orbital trasero */}
        <svg
          viewBox="0 0 120 88"
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        >
          <defs>
            <linearGradient id={orbitId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(59, 130, 246, 0.08)" />
              <stop offset="48%" stopColor="rgba(147, 197, 253, 0.85)" />
              <stop offset="100%" stopColor="rgba(29, 78, 216, 0.14)" />
            </linearGradient>
          </defs>
          <g transform="rotate(-20 60 44)">
            <path
              d="M 10 44 A 50 18 0 0 1 110 44"
              fill="none"
              stroke={`url(#${orbitId})`}
              strokeWidth="1.35"
              strokeLinecap="round"
              opacity="0.72"
            />
          </g>
        </svg>

        <div className="relative z-10">
          <OmegaLogo size={size} isThinking={isThinking} />
        </div>

        {/* Arco orbital frontal + destello de cruce */}
        <svg
          viewBox="0 0 120 88"
          className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible"
        >
          <g transform="rotate(-20 60 44)">
            <path
              d="M 10 44 A 50 18 0 0 0 110 44"
              fill="none"
              stroke={`url(#${orbitId})`}
              strokeWidth="1.65"
              strokeLinecap="round"
            />
            <circle
              cx="96"
              cy="55"
              r={isThinking ? '2.6' : '2.1'}
              fill="#DBEAFE"
              className={isThinking ? 'omega-core-pulse' : ''}
            />
          </g>
        </svg>
      </div>
    );
  }

  return <HeroReflexHorizonCanvas size={size} isThinking={isThinking} className={className} />;
}

function HeroReflexHorizonCanvas({ size = 64, isThinking = false, className = '' }) {
  const canvasRef = useRef(null);
  const thinkingRef = useRef(isThinking);
  const pointerRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    thinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const width = 480;
    const height = 248;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const motes = Array.from({ length: 42 }, (_, idx) => {
      const s1 = Math.sin(idx * 17.31) * 43758.5453;
      const s2 = Math.sin(idx * 91.17) * 19341.731;
      const r1 = s1 - Math.floor(s1);
      const r2 = s2 - Math.floor(s2);
      return {
        angle: r1 * Math.PI * 2,
        radius: 58 + r2 * 86,
        speed: (0.14 + r1 * 0.24) * (idx % 2 === 0 ? 1 : -0.6),
        size: 0.7 + r2 * 1.15,
        phase: r1 * 6.28,
        flatten: 0.56 + r2 * 0.36,
      };
    });

    const smooth = { px: 0, py: 0, energy: thinkingRef.current ? 1 : 0 };
    let elapsed = 0;
    let lastTs = performance.now();
    let rafId = 0;

    const drawStage = (t, energy) => {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const cx = width * 0.5;
      const cy = height * 0.52;
      const nx = cx + smooth.px * 8;
      const ny = cy + smooth.py * 5;
      const boost = 1 + energy * 0.32;

      // 1. Halo atmosférico profundo azul rey / cobalto contenido (decae a 0 dentro del canvas)
      ctx.globalCompositeOperation = 'lighter';
      ctx.save();
      ctx.translate(nx, ny - 4);
      ctx.scale(1.42, 0.85);
      const nebulaGrad = ctx.createRadialGradient(0, 0, 12, 0, 0, 128);
      nebulaGrad.addColorStop(0, `rgba(29, 78, 216, ${(0.24 * boost).toFixed(3)})`);
      nebulaGrad.addColorStop(0.4, `rgba(37, 99, 235, ${(0.12 * boost).toFixed(3)})`);
      nebulaGrad.addColorStop(0.74, 'rgba(13, 36, 88, 0.04)');
      nebulaGrad.addColorStop(1, 'rgba(3, 5, 11, 0)');
      ctx.fillStyle = nebulaGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 128, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 2. Resplandor horizontal suave en el horizonte (escalado para decaer a alfa 0 sin borde)
      const flareY = cy + 54;
      ctx.save();
      ctx.translate(nx, flareY);
      ctx.scale(1, 32 / 204);
      const flareGrad = ctx.createRadialGradient(0, 0, 6, 0, 0, 204);
      flareGrad.addColorStop(0, `rgba(147, 197, 253, ${(0.21 * boost).toFixed(3)})`);
      flareGrad.addColorStop(0.32, `rgba(37, 99, 235, ${(0.13 * boost).toFixed(3)})`);
      flareGrad.addColorStop(0.68, 'rgba(15, 42, 102, 0.04)');
      flareGrad.addColorStop(1, 'rgba(3, 5, 11, 0)');
      ctx.fillStyle = flareGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 204, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Filamento estrecho horizontal que besa el horizonte inferior
      const lipGrad = ctx.createLinearGradient(cx - 186, flareY, cx + 186, flareY);
      lipGrad.addColorStop(0, 'rgba(59, 130, 246, 0)');
      lipGrad.addColorStop(0.24, `rgba(59, 130, 246, ${(0.16 * boost).toFixed(3)})`);
      lipGrad.addColorStop(0.5, `rgba(219, 234, 254, ${(0.32 * boost).toFixed(3)})`);
      lipGrad.addColorStop(0.76, `rgba(59, 130, 246, ${(0.16 * boost).toFixed(3)})`);
      lipGrad.addColorStop(1, 'rgba(59, 130, 246, 0)');
      ctx.strokeStyle = lipGrad;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(cx - 186, flareY);
      ctx.bezierCurveTo(cx - 84, flareY - 7, cx + 84, flareY - 7, cx + 186, flareY);
      ctx.stroke();

      // 3. Arcos de lente gravitacional (corona superior curva estilo agujero negro Reflex)
      const lensingLayers = [
        { rx: 86, ry: 82, width: 10, color: [59, 130, 246], alpha: 0.14 * boost, phase: 0 },
        { rx: 72, ry: 69, width: 6.5, color: [96, 165, 250], alpha: 0.24 * boost, phase: 1.4 },
        { rx: 60, ry: 58, width: 3.2, color: [191, 219, 254], alpha: 0.34 * boost, phase: 2.7 },
      ];

      for (const layer of lensingLayers) {
        const segs = 68;
        ctx.lineCap = 'round';
        for (let i = 0; i < segs; i += 1) {
          const u0 = i / segs;
          const u1 = (i + 1) / segs;
          // Arco principal sobre la cúpula (-1.12π a +0.12π)
          const a0 = -Math.PI * 1.08 + u0 * Math.PI * 1.16;
          const a1 = -Math.PI * 1.08 + u1 * Math.PI * 1.16;
          const midA = (a0 + a1) * 0.5;

          const wave =
            0.72 +
            0.28 * Math.sin(midA * 3 + t * 1.05 + layer.phase) +
            0.16 * Math.cos(midA * 5 - t * 1.45);
          const domeWeight = Math.max(0.15, Math.sin(u0 * Math.PI));
          const segAlpha = Math.min(0.68, layer.alpha * wave * domeWeight);

          ctx.strokeStyle = `rgba(${layer.color[0]}, ${layer.color[1]}, ${layer.color[2]}, ${segAlpha.toFixed(3)})`;
          ctx.lineWidth = layer.width * (0.82 + 0.22 * domeWeight);
          ctx.beginPath();
          ctx.ellipse(cx, cy + 4, layer.rx, layer.ry, 0, a0, a1);
          ctx.stroke();
        }
      }

      // 4. Sombra de horizonte de eventos en el núcleo (mantiene alto contraste detrás de Ω)
      ctx.globalCompositeOperation = 'source-over';
      const coreVoid = ctx.createRadialGradient(cx, cy, 12, cx, cy, 56);
      coreVoid.addColorStop(0, 'rgba(3, 5, 11, 0.94)');
      coreVoid.addColorStop(0.66, 'rgba(3, 5, 11, 0.82)');
      coreVoid.addColorStop(1, 'rgba(3, 5, 11, 0)');
      ctx.fillStyle = coreVoid;
      ctx.beginPath();
      ctx.arc(cx, cy, 56, 0, Math.PI * 2);
      ctx.fill();

      // 5. Anillo fotónico interior fino alrededor del núcleo oscuro
      ctx.globalCompositeOperation = 'lighter';
      const photonGrad = ctx.createLinearGradient(cx - 56, cy - 52, cx + 56, cy + 52);
      photonGrad.addColorStop(0, 'rgba(224, 242, 254, 0.55)');
      photonGrad.addColorStop(0.45, `rgba(96, 165, 250, ${(0.38 * boost).toFixed(3)})`);
      photonGrad.addColorStop(0.75, 'rgba(29, 78, 216, 0.16)');
      photonGrad.addColorStop(1, 'rgba(147, 197, 253, 0.42)');
      ctx.strokeStyle = photonGrad;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(cx, cy + 2, 51, 0, Math.PI * 2);
      ctx.stroke();

      // 6. Órbita inclinada con partícula luminosa (mitad trasera + mitad delantera)
      const tilt = -0.34; // ~ -19.5°
      const orbRx = 84;
      const orbRy = 27;
      const cosT = Math.cos(tilt);
      const sinT = Math.sin(tilt);

      const drawOrbitArc = (startA, endA, alphaScale) => {
        const g = ctx.createLinearGradient(cx - orbRx, cy, cx + orbRx, cy);
        g.addColorStop(0, `rgba(37, 99, 235, ${(0.18 * alphaScale).toFixed(3)})`);
        g.addColorStop(0.5, `rgba(191, 219, 254, ${(0.65 * alphaScale * boost).toFixed(3)})`);
        g.addColorStop(1, `rgba(37, 99, 235, ${(0.22 * alphaScale).toFixed(3)})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.45;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 2, orbRx, orbRy, tilt, startA, endA);
        ctx.stroke();
      };

      drawOrbitArc(Math.PI, Math.PI * 2, 0.65);

      // Motas cósmicas sutiles en deriva orbital
      for (const m of motes) {
        const a = m.angle + t * m.speed * (1 + energy * 0.9);
        const lx = Math.cos(a) * m.radius * 1.18;
        const ly = Math.sin(a) * m.radius * m.flatten * 0.62 - 6;
        const x = nx + lx;
        const y = ny + ly;
        const distCenter = Math.hypot(x - cx, y - cy);
        if (distCenter < 48) continue;

        const twinkle = 0.28 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.1 + m.phase));
        ctx.fillStyle = `rgba(191, 219, 254, ${(twinkle * 0.62).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, m.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // Destello orbital viajero (el arco frontal nítido se dibuja en el SVG z-20 sobre el escudo)
      const satTheta = t * (0.82 + energy * 1.15);
      const ux = Math.cos(satTheta) * orbRx;
      const uy = Math.sin(satTheta) * orbRy;
      const sx = cx + ux * cosT - uy * sinT;
      const sy = cy + 2 + ux * sinT + uy * cosT;
      const isFront = Math.sin(satTheta) >= -0.08;

      if (isFront || distFromShield(sx - cx, sy - cy)) {
        const glowR = isFront ? 12 : 7;
        const dotGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
        dotGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        dotGrad.addColorStop(0.35, 'rgba(147, 197, 253, 0.72)');
        dotGrad.addColorStop(1, 'rgba(37, 99, 235, 0)');
        ctx.fillStyle = dotGrad;
        ctx.beginPath();
        ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    };

    const distFromShield = (dx, dy) => Math.hypot(dx, dy) > 40;

    const onPointerMove = (e) => {
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      pointerRef.current.x = (e.clientX / vw - 0.5) * 2;
      pointerRef.current.y = (e.clientY / vh - 0.5) * 2;
    };

    const onPointerLeave = () => {
      pointerRef.current.x = 0;
      pointerRef.current.y = 0;
    };

    const tick = (now) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;

      const damp = 1 - Math.exp(-dt * 6);
      smooth.px += (pointerRef.current.x - smooth.px) * damp;
      smooth.py += (pointerRef.current.y - smooth.py) * damp;
      const targetEnergy = thinkingRef.current ? 1 : 0;
      smooth.energy += (targetEnergy - smooth.energy) * damp;

      elapsed += dt * (1 + smooth.energy * 0.95);
      drawStage(elapsed, smooth.energy);

      if (!document.hidden && !reduceMotion) {
        rafId = requestAnimationFrame(tick);
      }
    };

    const onVisibility = () => {
      cancelAnimationFrame(rafId);
      if (!document.hidden && !reduceMotion) {
        lastTs = performance.now();
        rafId = requestAnimationFrame(tick);
      }
    };

    if (reduceMotion) {
      drawStage(1.2, thinkingRef.current ? 1 : 0);
      return undefined;
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('mouseleave', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibility);

    drawStage(0, smooth.energy);
    if (!document.hidden) {
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('mouseleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const frontUid = useId().replace(/:/g, '');
  const frontGradId = `omegaFrontArc-${frontUid}`;

  return (
    <div
      className={`relative inline-flex items-center justify-center w-[132px] h-[104px] sm:w-[152px] sm:h-[116px] select-none pointer-events-none ${className}`}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 w-[min(368px,94vw)] sm:w-[480px] aspect-[480/248] -translate-x-1/2 -translate-y-[48%]"
      />
      <div className="relative z-10">
        <OmegaLogo size={size} isThinking={isThinking} />
      </div>
      {/* Cruce frontal del anillo inclinado por delante de la base del escudo */}
      <svg
        viewBox="0 0 480 248"
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 z-20 w-[min(368px,94vw)] sm:w-[480px] aspect-[480/248] -translate-x-1/2 -translate-y-[48%]"
      >
        <defs>
          <linearGradient id={frontGradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(37, 99, 235, 0.08)" />
            <stop offset="32%" stopColor="rgba(147, 197, 253, 0.55)" />
            <stop offset="50%" stopColor="rgba(239, 246, 255, 0.9)" />
            <stop offset="68%" stopColor="rgba(96, 165, 250, 0.58)" />
            <stop offset="100%" stopColor="rgba(37, 99, 235, 0.08)" />
          </linearGradient>
        </defs>
        <g transform="rotate(-19.5 240 131)">
          <path
            d="M 156 131 A 84 27 0 0 0 324 131"
            fill="none"
            stroke={`url(#${frontGradId})`}
            strokeWidth="1.65"
            strokeLinecap="round"
          />
        </g>
      </svg>
    </div>
  );
}
