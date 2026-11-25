import { Component, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import {
  abs,
  add,
  atan,
  clamp,
  color,
  cos,
  dot,
  exp,
  float,
  fract,
  length,
  mix,
  mul,
  pow,
  sin,
  smoothstep,
  sub,
  uniform,
  uv,
  vec2,
} from 'three/tsl';
import { SecurityCenterpieceFallback } from './SecurityCenterpieceFallback';

let hasCompletedInitialWarmup = false;

class WebGLErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onError?.();
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/**
 * Quad full-bleed único (WebGPU + TSL, 1 draw call, 60–120 FPS):
 * - Renderiza el eclipse cinematográfico monumental de OMEGA sobre negro absoluto (#040508).
 * - El arco inferior iluminado cruza directamente detrás de las 3 cards del dock para dar
 *   refracción real al glassmorphism.
 * - Micro-dithering (0.008) para cero banding, parallax suave (±18px) y respuesta a coreState.
 * - Warm-up Gate: ejecuta compileAsync + 2 frames reales antes de disparar onWarmupComplete.
 */
function EclipseShaderQuad({
  coreState = 'idle',
  alert = false,
  reducedMotion = false,
  pointerRef,
  logoWrapperRef,
  onWarmupComplete,
}) {
  const { gl, scene, camera, size } = useThree();
  const compiledRef = useRef(false);
  const framesAfterCompileRef = useRef(0);
  const signaledRef = useRef(false);

  const phaseRef = useRef(0.85);
  const speedRef = useRef(0.18);
  const parallaxRef = useRef({ x: 0, y: 0 });

  const uPhase = useMemo(() => uniform(0.85), []);
  const uAspect = useMemo(() => uniform(16 / 9), []);
  const uParallax = useMemo(() => uniform(new THREE.Vector2(0, 0)), []);
  const uBoost = useMemo(() => uniform(1.0), []);
  const uAlert = useMemo(() => uniform(0.0), []);

  const geometry = useMemo(() => new THREE.PlaneGeometry(2, 2), []);

  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
    });

    const st = uv();
    // Centro ligeramente ajustado (y: 0.51) para respirar lejos del dock superior y abrazar la Ω
    const centered = sub(st, vec2(0.5, 0.51));
    const parallaxed = sub(centered, uParallax);
    const p = vec2(mul(parallaxed.x, uAspect), parallaxed.y);

    const r = length(p);
    const angle = atan(p.y, p.x);

    // Radio reducido ~17% (0.335 vs 0.405) para equilibrar la proporción con la Ω y liberar el borde superior
    const eclipseRadius = float(0.335);
    const signedDist = sub(r, eclipseRadius);
    const absDist = abs(signedDist);

    // Interior negro absoluto (#040508) con filo externo nítido
    const outsideMask = smoothstep(float(-0.0045), float(0.004), signedDist);
    // Corte perimetral suave para asegurar negro puro #040508 en las esquinas y el header superior
    const viewportFalloff = smoothstep(float(0.62), float(0.35), r);

    // Decaimiento exponencial cerrado: filo nítido + atmósfera muy contenida (~65% menos bloom)
    const razorEdge = mul(outsideMask, exp(mul(absDist, float(-68.0))));
    const sharpRim = mul(outsideMask, exp(mul(absDist, float(-18.0))));
    const tightAtmo = mul(mul(outsideMask, exp(mul(absDist, float(-4.5)))), float(0.28));

    // Máscara angular direccional (efecto media luna: ~35% activo, ~65% en sombra con filo tenue ~0.08)
    const directionalArc = pow(mul(add(cos(sub(angle, uPhase)), float(1.0)), float(0.5)), float(2.5));
    const directionalTight = pow(mul(add(cos(sub(angle, uPhase)), float(1.0)), float(0.5)), float(4.2));

    // Lado en sombra: filo ultra tenue (0.08) que insinúa la curvatura sin iluminar el fondo
    const rimWeight = add(float(0.08), mul(directionalArc, float(0.7)));
    const atmoWeight = mul(directionalArc, float(0.42));

    // Paleta sobria del Login: azul rey #2563EB -> #60A5FA sin quemarse a blanco puro (pico clamp <= 0.78)
    const cVoid = color('#040508');
    const cRoyal = mix(color('#2563EB'), color('#B91C1C'), mul(uAlert, float(0.75)));
    const cIce = mix(color('#60A5FA'), color('#F87171'), mul(uAlert, float(0.7)));

    const atmoStrength = clamp(
      mul(mul(mul(tightAtmo, atmoWeight), viewportFalloff), uBoost),
      float(0.0),
      float(0.32),
    );
    const rimStrength = clamp(
      mul(mul(mul(sharpRim, rimWeight), viewportFalloff), mul(uBoost, float(0.58))),
      float(0.0),
      float(0.52),
    );
    const flareStrength = clamp(
      mul(mul(razorEdge, add(float(0.06), mul(directionalTight, float(0.72)))), uBoost),
      float(0.0),
      float(0.78),
    );

    const ringColor = mix(cRoyal, cIce, clamp(mul(directionalTight, float(0.85)), float(0.0), float(0.78)));
    const lightSum = add(
      mul(cRoyal, add(atmoStrength, rimStrength)),
      mul(ringColor, flareStrength),
    );

    // Micro-dithering (0.008) en el fragment shader para cero banding en el degradado oscuro
    const noiseSeed = dot(st, vec2(12.9898, 78.233));
    const dither = mul(sub(fract(mul(sin(noiseSeed), float(43758.5453))), float(0.5)), float(0.008));

    const composed = add(cVoid, lightSum);
    mat.colorNode = add(composed, vec2(dither, dither).x);
    return mat;
  }, [uAlert, uAspect, uBoost, uParallax, uPhase]);

  useEffect(() => {
    if (!gl || !scene || !camera) return undefined;
    let disposed = false;

    async function runWarmup() {
      try {
        if (typeof gl.compileAsync === 'function') {
          await gl.compileAsync(scene, camera);
        }
      } catch {
        // Continuar si compileAsync no está disponible
      }
      if (!disposed) {
        compiledRef.current = true;
      }
    }

    void runWarmup();
    return () => {
      disposed = true;
    };
  }, [gl, scene, camera]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((_, delta) => {
    if (!signaledRef.current && compiledRef.current) {
      framesAfterCompileRef.current += 1;
      if (framesAfterCompileRef.current >= 2) {
        signaledRef.current = true;
        onWarmupComplete?.();
      }
    }

    const dt = Math.min(delta, 0.05);
    const smooth = 1 - Math.exp(-5.0 * dt);

    const w = Math.max(size.width, 1);
    const h = Math.max(size.height, 1);
    uAspect.value = w / h;

    // Velocidad y luminosidad sobrias conectadas a coreState ('idle' | 'focus' | 'scanning')
    const targetSpeed = reducedMotion
      ? 0
      : coreState === 'scanning'
        ? 0.36
        : coreState === 'focus'
          ? 0.26
          : 0.18;
    const targetBoost =
      coreState === 'scanning' ? 1.18 : coreState === 'focus' ? 1.12 : 1.0;

    speedRef.current = THREE.MathUtils.lerp(speedRef.current, targetSpeed, smooth);
    if (!reducedMotion) {
      phaseRef.current = (phaseRef.current + dt * speedRef.current) % (Math.PI * 2);
    }

    uPhase.value = phaseRef.current;
    uBoost.value = THREE.MathUtils.lerp(uBoost.value, targetBoost, smooth);
    uAlert.value = THREE.MathUtils.lerp(uAlert.value, alert ? 1.0 : 0.0, smooth);

    // Parallax contenido (±18px en pantalla con damping suave)
    const maxPx = reducedMotion ? 0 : 18;
    const targetPxX = THREE.MathUtils.clamp(pointerRef.current.x, -1, 1) * maxPx;
    const targetPxY = THREE.MathUtils.clamp(pointerRef.current.y, -1, 1) * maxPx;

    parallaxRef.current.x = THREE.MathUtils.lerp(parallaxRef.current.x, targetPxX, smooth);
    parallaxRef.current.y = THREE.MathUtils.lerp(parallaxRef.current.y, targetPxY, smooth);

    uParallax.value.set(parallaxRef.current.x / w, parallaxRef.current.y / h);

    // Sincronizar sutilmente el logo Ω SVG central con el parallax sin causar re-renders de React
    if (logoWrapperRef?.current) {
      const lx = parallaxRef.current.x * 0.55;
      const ly = -parallaxRef.current.y * 0.55;
      logoWrapperRef.current.style.transform = `translate3d(${lx.toFixed(2)}px, ${ly.toFixed(2)}px, 0)`;
    }
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

/**
 * Logo Ω vectorial limpio y arquitectónico centrado en el vacío negro del eclipse:
 * - Degradado vertical refinado (#F8FAFC -> #94A3B8) a opacidad 0.92 con fino borde especular
 *   y sombra difusa sutil para integrarse en el vacío negro sin parecer extrusión 3D gruesa.
 */
function CentralOmegaMark({ alert = false, coreState = 'idle', wrapperRef }) {
  const uid = useId().replace(/:/g, '');
  const fillGradId = `omegaCenterFill-${uid}`;
  const strokeGradId = `omegaCenterStroke-${uid}`;
  const isActive = coreState === 'focus' || coreState === 'scanning';

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[1] flex items-center justify-center"
      style={{ paddingBottom: '2vh' }}
    >
      <div
        ref={wrapperRef}
        className="relative flex items-center justify-center will-change-transform"
      >
        <svg
          viewBox="0 0 80 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`h-[144px] w-[144px] sm:h-[160px] sm:w-[160px] lg:h-[172px] lg:w-[172px] transition-opacity duration-500 drop-shadow-[0_14px_34px_rgba(4,5,8,0.95)] ${
            isActive ? 'opacity-90' : 'opacity-80'
          }`}
        >
          <defs>
            <linearGradient id={fillGradId} x1="40" y1="16" x2="40" y2="58" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor={alert ? '#FCA5A5' : '#E2E8F0'} stopOpacity="0.72" />
              <stop offset="55%" stopColor={alert ? '#EF4444' : '#94A3B8'} stopOpacity="0.62" />
              <stop offset="100%" stopColor={alert ? '#7F1D1D' : '#475569'} stopOpacity="0.52" />
            </linearGradient>
            <linearGradient id={strokeGradId} x1="20" y1="18" x2="60" y2="56" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#E2E8F0" stopOpacity="0.34" />
              <stop offset="50%" stopColor={alert ? '#F87171' : '#60A5FA'} stopOpacity="0.22" />
              <stop offset="100%" stopColor="#1E293B" stopOpacity="0.25" />
            </linearGradient>
          </defs>

          {/* Silueta arquitectónica limpia y estilizada de Ω (proporción clásica, cero volumen inflado) */}
          <path
            d="M33.2 55.6H22.2V49.8H29.4C25.5 46.1 23.2 40.9 23.2 35C23.2 25.1 30.6 17.6 40 17.6C49.4 17.6 56.8 25.1 56.8 35C56.8 40.9 54.5 46.1 50.6 49.8H57.8V55.6H46.8V49.2C50 46.2 51.9 41.3 51.9 35.4C51.9 27.9 46.8 22.4 40 22.4C33.2 22.4 28.1 27.9 28.1 35.4C28.1 41.3 30 46.2 33.2 49.2V55.6Z"
            fill={`url(#${fillGradId})`}
            stroke={`url(#${strokeGradId})`}
            strokeWidth="0.9"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

export function SecurityCenterpiece3D({
  coreState = 'idle',
  surfaceId = 'repo',
  healthy = false,
  alert = false,
  reducedMotion = false,
  onSceneReady,
}) {
  const pointerRef = useRef({ x: 0, y: 0 });
  const logoWrapperRef = useRef(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [isReturnVisit] = useState(() => hasCompletedInitialWarmup);

  useEffect(() => {
    if (reducedMotion) return undefined;
    const onPointerMove = (e) => {
      if (window.innerWidth <= 0 || window.innerHeight <= 0) return;
      pointerRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointerRef.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, [reducedMotion]);

  const handleWarmupComplete = useCallback(() => {
    hasCompletedInitialWarmup = true;
    setSceneReady(true);
    onSceneReady?.();
  }, [onSceneReady]);

  const fallback = (
    <SecurityCenterpieceFallback surfaceId={surfaceId} healthy={healthy} alert={alert} />
  );

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-0 bg-[#040508] pointer-events-none select-none overflow-hidden"
    >
      {/* Canvas + Logo Ω en crossfade suave (450ms ease-out) tras compileAsync + 2 frames reales */}
      <div
        className={`absolute inset-0 transition-opacity ease-out ${
          isReturnVisit ? 'duration-[250ms]' : 'duration-[450ms]'
        } ${sceneReady ? 'opacity-100' : 'opacity-0'}`}
      >
        <WebGLErrorBoundary fallback={fallback} onError={handleWarmupComplete}>
          <Canvas
            orthographic
            dpr={[1, 1.5]}
            camera={{ left: -1, right: 1, top: 1, bottom: -1, near: 0.1, far: 10, position: [0, 0, 1] }}
            gl={async (props) => {
              const renderer = new THREE.WebGPURenderer({
                canvas: props.canvas,
                antialias: true,
                powerPreference: 'high-performance',
                alpha: false,
              });
              await renderer.init();
              renderer.toneMapping = THREE.AgXToneMapping;
              renderer.toneMappingExposure = 1.0;
              return renderer;
            }}
          >
            <EclipseShaderQuad
              coreState={coreState}
              alert={alert}
              reducedMotion={reducedMotion}
              pointerRef={pointerRef}
              logoWrapperRef={logoWrapperRef}
              onWarmupComplete={handleWarmupComplete}
            />
          </Canvas>
        </WebGLErrorBoundary>

        <CentralOmegaMark alert={alert} coreState={coreState} wrapperRef={logoWrapperRef} />
      </div>
    </div>
  );
}
