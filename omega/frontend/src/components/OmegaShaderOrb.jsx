import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  // Simplex 3D Noise
  vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);

    // Fresnel para el borde de cristal esmerilado
    float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 2.6);

    // Domain warping para generar cintas de luz fluida tipo seda/plasma
    float t = uTime * 0.35;
    vec3 q = vec3(
      snoise(normal * 1.6 + vec3(t, -t * 0.6, 0.0)),
      snoise(normal * 1.6 + vec3(-t * 0.5, t * 0.8, 1.2)),
      snoise(normal * 1.6 + vec3(0.4, -t * 0.4, t))
    );

    float wave1 = snoise(normal * 2.2 + q * 1.4 + vec3(t * 0.5));
    float wave2 = snoise(normal * 3.1 - q * 1.1 - vec3(0.0, t * 0.7, 0.0));

    // Bandas suaves tipo cinta luminosa
    float ribbon = smoothstep(0.05, 0.75, wave1 * 0.6 + wave2 * 0.4);
    float highlight = smoothstep(0.45, 0.92, wave1 * 0.5 + wave2 * 0.5);

    // Paleta OMEGA: abismo oscuro + azul cobalto + destello cian/lavanda
    vec3 deepCore = vec3(0.03, 0.05, 0.11);
    vec3 midCobalt = vec3(0.16, 0.38, 0.88);
    vec3 silkGlow = vec3(0.55, 0.76, 1.00);
    vec3 rimLight = vec3(0.42, 0.64, 0.98);

    vec3 color = mix(deepCore, midCobalt, ribbon * 0.85);
    color = mix(color, silkGlow, highlight * 0.75);
    color += rimLight * fresnel * 0.65;

    // Viñeta suave en el contorno para integración limpia
    float alpha = mix(0.92, 1.0, fresnel);
    gl_FragColor = vec4(color, alpha);
  }
`;

export function OmegaShaderOrb({ size = 136, isThinking = false, className = '' }) {
  const containerRef = useRef(null);
  const thinkingRef = useRef(isThinking);
  const useWebGl = size >= 72;

  useEffect(() => {
    thinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    if (!useWebGl) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch {
      return undefined;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.z = 3.4;

    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = `${size}px`;
    renderer.domElement.style.height = `${size}px`;
    container.appendChild(renderer.domElement);

    const geometry = new THREE.SphereGeometry(1, 64, 64);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 1.2 },
      },
      transparent: true,
    });

    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    let animationFrameId = 0;
    let lastNow = performance.now();
    let elapsed = 1.2;

    const renderFrame = (now) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;
      const speedFactor = thinkingRef.current ? 1.65 : 1.0;
      elapsed += dt * speedFactor;

      material.uniforms.uTime.value = elapsed;
      sphere.rotation.y += 0.003 * speedFactor;
      renderer.render(scene, camera);

      if (!document.hidden && !reduceMotion) {
        animationFrameId = requestAnimationFrame(renderFrame);
      }
    };

    const handleVisibility = () => {
      cancelAnimationFrame(animationFrameId);
      if (!document.hidden && !reduceMotion) {
        lastNow = performance.now();
        animationFrameId = requestAnimationFrame(renderFrame);
      }
    };

    if (reduceMotion) {
      renderer.render(scene, camera);
    } else {
      document.addEventListener('visibilitychange', handleVisibility);
      if (!document.hidden) {
        animationFrameId = requestAnimationFrame(renderFrame);
      } else {
        renderer.render(scene, camera);
      }
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
      document.removeEventListener('visibilitychange', handleVisibility);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [size, useWebGl]);

  const glyphClass =
    size >= 110
      ? 'text-[30px]'
      : size >= 40
        ? 'text-[17px]'
        : 'text-[10.5px]';

  return (
    <div
      aria-hidden="true"
      className={`relative flex items-center justify-center shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Halo ambiental difuso */}
      <div
        className={`pointer-events-none absolute inset-0 rounded-full transition-opacity duration-500 ${
          size >= 72 ? 'blur-2xl scale-110' : 'blur-lg scale-105'
        } ${
          isThinking ? 'bg-blue-500/35 opacity-100' : 'bg-blue-500/22 opacity-85'
        }`}
      />
      {/* Anillo sutil de cristal oscuro */}
      <div
        className="relative flex items-center justify-center rounded-full p-[1px] bg-gradient-to-b from-white/25 via-blue-400/10 to-transparent shadow-[0_12px_40px_-10px_rgba(37,99,235,0.45)]"
        style={{ width: size, height: size }}
      >
        {/* Capa volumétrica base / fallback para tamaños compactos */}
        <div
          ref={containerRef}
          className="relative overflow-hidden isolate rounded-full bg-[#060C1A]"
          style={{
            width: size - 2,
            height: size - 2,
            clipPath: 'circle(50% at 50% 50%)',
            WebkitClipPath: 'circle(50% at 50% 50%)',
          }}
        >
          {!useWebGl && (
            <>
              <span
                className={`absolute inset-[-25%] rounded-full bg-[conic-gradient(from_40deg,rgba(29,78,216,0.18),rgba(147,197,253,0.72),rgba(3,5,11,0.1),rgba(59,130,246,0.55),rgba(29,78,216,0.18))] blur-[6px] mix-blend-screen motion-safe:animate-[spin_9s_linear_infinite] ${
                  isThinking ? 'omega-core-pulse' : ''
                }`}
              />
              <span className="absolute inset-[-18%] rounded-full bg-[conic-gradient(from_210deg,rgba(59,130,246,0.08),rgba(96,165,250,0.48),rgba(15,23,42,0.2),rgba(191,219,254,0.42),rgba(59,130,246,0.08))] blur-[7px] mix-blend-screen motion-safe:animate-[spin_14s_linear_infinite_reverse]" />
              <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_34%_28%,rgba(191,219,254,0.34),rgba(13,34,88,0.45)_54%,rgba(3,5,11,0.92)_100%)]" />
            </>
          )}
        </div>
        {/* Glifo Omega minimalista plano en el núcleo */}
        <span
          className={`pointer-events-none absolute z-10 select-none ${glyphClass} font-semibold tracking-tight text-white/95 opacity-85 drop-shadow-[0_2px_10px_rgba(15,23,42,0.85)]`}
        >
          Ω
        </span>
      </div>
    </div>
  );
}
