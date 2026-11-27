import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const ORB_VERTEX_SHADER = `
attribute float a_size;
attribute float a_layer;

uniform float u_time;
uniform float u_pointSize;
uniform float u_dpr;

varying float v_layer;
varying float v_depth;
varying float v_falloff;

void main() {
  vec3 pos = position;
  float pulse = 1.0 + sin(u_time * 0.6 + a_layer * 4.2) * 0.011;
  pos *= pulse;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = u_pointSize * u_dpr * a_size * (1.0 / max(0.2, -mvPosition.z));
  gl_Position = projectionMatrix * mvPosition;

  v_layer = a_layer;
  v_depth = smoothstep(-1.8, 1.8, pos.z);
  v_falloff = smoothstep(2.5, 0.3, length(pos));
}
`;

const ORB_FRAGMENT_SHADER = `
precision highp float;

uniform vec3 u_coreColor;
uniform vec3 u_accentColor;
uniform vec3 u_highlightColor;

varying float v_layer;
varying float v_depth;
varying float v_falloff;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;

  float alpha = smoothstep(0.5, 0.0, d);
  alpha *= alpha;

  vec3 baseColor = mix(u_coreColor, u_accentColor, smoothstep(0.32, 0.88, v_layer));
  vec3 color = mix(baseColor, u_highlightColor, smoothstep(0.75, 1.0, v_depth) * 0.25);
  color = mix(color * 0.45, color, clamp(v_falloff + v_layer * 0.26, 0.0, 1.0));
  alpha *= mix(0.46, 0.96, clamp(v_falloff + v_layer * 0.22, 0.0, 1.0));

  gl_FragColor = vec4(color, alpha);
}
`;

function buildSphereGeometry(count, radius) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const layers = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const z = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const shellBias = Math.pow(Math.random(), 0.36);
    const r = radius * (0.64 + shellBias * 0.36);
    const root = Math.sqrt(Math.max(0, 1 - z * z));
    const idx = i * 3;

    positions[idx] = Math.cos(theta) * root * r;
    positions[idx + 1] = Math.sin(theta) * root * r;
    positions[idx + 2] = z * r;
    sizes[i] = 0.65 + Math.random() * 0.68;
    layers[i] = Math.random() * 0.32;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('a_size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('a_layer', new THREE.BufferAttribute(layers, 1));
  return geometry;
}

function buildRingGeometry(count, ringRadius, ringThickness) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const layers = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = ringRadius + (Math.random() - 0.5) * ringThickness;
    const y = (Math.random() - 0.5) * ringThickness * 0.48;
    const idx = i * 3;

    positions[idx] = Math.cos(angle) * r;
    positions[idx + 1] = y;
    positions[idx + 2] = Math.sin(angle) * r;
    sizes[i] = 0.56 + Math.random() * 0.54;
    layers[i] = 0.72 + Math.random() * 0.28;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('a_size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('a_layer', new THREE.BufferAttribute(layers, 1));
  return geometry;
}

/**
 * Orbe 3D WebGL de OMEGA: núcleo esférico de partículas + anillo orbital azul rey
 * con órbita amortiguada al puntero, pausa fuera de pantalla y fallback sin WebGL.
 */
export function OmegaOrb3D({ className = '' }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || typeof window === 'undefined') return undefined;

    let renderer;
    try {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) {
        setWebglUnavailable(true);
        return undefined;
      }
      renderer = new THREE.WebGLRenderer({
        canvas,
        context: gl,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglUnavailable(true);
      return undefined;
    }

    const maxDpr = 1.75;
    let dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(dpr);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 0, 5.8);

    const sphereGroup = new THREE.Group();
    const ringGroup = new THREE.Group();
    ringGroup.rotation.x = -0.44;
    ringGroup.rotation.z = 0.24;
    scene.add(sphereGroup);
    scene.add(ringGroup);

    const particleMaterial = new THREE.ShaderMaterial({
      vertexShader: ORB_VERTEX_SHADER,
      fragmentShader: ORB_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        u_time: { value: 0 },
        u_pointSize: { value: 16.5 },
        u_dpr: { value: dpr },
        u_coreColor: { value: new THREE.Color('#F8FAFC') },
        u_accentColor: { value: new THREE.Color('#2F6FED') },
        u_highlightColor: { value: new THREE.Color('#93C5FD') },
      },
    });

    /* Núcleo oscuro interior para profundidad real frente/fondo */
    const innerCoreGeom = new THREE.SphereGeometry(0.92, 32, 32);
    const innerCoreMat = new THREE.MeshBasicMaterial({
      color: 0x05070b,
      transparent: true,
      opacity: 0.72,
    });
    const innerCoreMesh = new THREE.Mesh(innerCoreGeom, innerCoreMat);
    sphereGroup.add(innerCoreMesh);

    const sphereGeom = buildSphereGeometry(2400, 1.28);
    const spherePoints = new THREE.Points(sphereGeom, particleMaterial);
    sphereGroup.add(spherePoints);

    const ringGeom = buildRingGeometry(1300, 2.02, 0.14);
    const ringPoints = new THREE.Points(ringGeom, particleMaterial);
    ringGroup.add(ringPoints);

    /* Anillo geométrico fino de calibración orbital */
    const guideGeom = new THREE.TorusGeometry(2.02, 0.0045, 8, 128);
    const guideMat = new THREE.MeshBasicMaterial({
      color: 0x2f6fed,
      transparent: true,
      opacity: 0.26,
    });
    const guideMesh = new THREE.Mesh(guideGeom, guideMat);
    guideMesh.rotation.x = Math.PI / 2;
    ringGroup.add(guideMesh);

    const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = reduceMotionQuery.matches;

    const target = { x: 0, y: 0 };
    const smooth = { x: reducedMotion ? 0.28 : 0, y: reducedMotion ? -0.12 : 0 };
    let bounds = { left: 0, top: 0, width: 1, height: 1 };
    let isVisible = true;
    let rafId = 0;
    let lastTimestamp = 0;
    let elapsed = 0;

    function updateSize() {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      bounds = { left: rect.left, top: rect.top, width, height };
      dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      particleMaterial.uniforms.u_dpr.value = dpr;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function applyPose(timeSeconds) {
      particleMaterial.uniforms.u_time.value = timeSeconds;

      /* Paralaje dividido entre cámara, núcleo y anillo orbital */
      camera.position.x = -smooth.x * 0.42;
      camera.position.y = smooth.y * 0.28;
      camera.lookAt(camera.position.x * 0.42, camera.position.y * 0.42, 0);

      sphereGroup.rotation.y = timeSeconds * 0.14 + smooth.x * 0.22;
      sphereGroup.rotation.x = smooth.y * 0.12;

      ringGroup.rotation.y = -timeSeconds * 0.09 + smooth.x * 0.11;
      ringGroup.rotation.x = -0.44 + smooth.y * 0.09;
      ringGroup.rotation.z = 0.24 + smooth.x * 0.06;

      renderer.render(scene, camera);
    }

    function tick(now) {
      if (!isVisible || document.hidden) {
        rafId = 0;
        lastTimestamp = 0;
        return;
      }

      const dt = lastTimestamp ? Math.min((now - lastTimestamp) * 0.001, 1 / 30) : 1 / 60;
      lastTimestamp = now;
      elapsed += dt;

      const alpha = 1 - Math.pow(1 - 0.055, dt * 60);
      smooth.x += (target.x - smooth.x) * alpha;
      smooth.y += (target.y - smooth.y) * alpha;

      applyPose(elapsed);
      rafId = requestAnimationFrame(tick);
    }

    function startLoop() {
      if (reducedMotion) {
        smooth.x = 0.28;
        smooth.y = -0.12;
        applyPose(0);
        return;
      }
      if (!rafId && isVisible && !document.hidden) {
        lastTimestamp = 0;
        rafId = requestAnimationFrame(tick);
      }
    }

    function onPointerMove(event) {
      if (event.pointerType === 'touch' || reducedMotion) return;
      const nx = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      const ny = ((event.clientY - bounds.top) / bounds.height) * 2 - 1;
      target.x = Math.max(-1, Math.min(1, nx));
      target.y = Math.max(-1, Math.min(1, ny));
    }

    function onPointerLeave() {
      target.x = 0;
      target.y = 0;
    }

    function onVisibilityChange() {
      if (document.hidden) {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      } else {
        startLoop();
      }
    }

    function onMotionChange(event) {
      reducedMotion = event.matches;
      if (reducedMotion && rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      startLoop();
    }

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
      if (reducedMotion) applyPose(0);
    });
    resizeObserver.observe(container);

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        isVisible = Boolean(entries[0]?.isIntersecting);
        if (isVisible) {
          startLoop();
        } else if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      },
      { threshold: 0.05 },
    );
    intersectionObserver.observe(container);

    updateSize();
    startLoop();

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    reduceMotionQuery.addEventListener?.('change', onMotionChange);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reduceMotionQuery.removeEventListener?.('change', onMotionChange);

      innerCoreGeom.dispose();
      innerCoreMat.dispose();
      sphereGeom.dispose();
      ringGeom.dispose();
      guideGeom.dispose();
      guideMat.dispose();
      particleMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-label="Orbe 3D interactivo de OMEGA"
      role="img"
      className={`relative aspect-square w-full max-w-[460px] mx-auto select-none ${className}`}
    >
      {webglUnavailable ? (
        <svg
          viewBox="0 0 360 360"
          fill="none"
          aria-hidden="true"
          className="h-full w-full"
        >
          <circle cx="180" cy="180" r="88" stroke="rgba(248,250,252,0.22)" strokeWidth="1" />
          <circle cx="180" cy="180" r="62" stroke="rgba(248,250,252,0.12)" strokeWidth="1" />
          <ellipse
            cx="180"
            cy="180"
            rx="142"
            ry="44"
            transform="rotate(-18 180 180)"
            stroke="#2F6FED"
            strokeOpacity="0.65"
            strokeWidth="1.25"
          />
          <circle cx="180" cy="180" r="3" fill="#93C5FD" />
        </svg>
      ) : (
        <canvas
          ref={canvasRef}
          data-omega-orb="webgl"
          className="block h-full w-full pointer-events-none"
        />
      )}
    </div>
  );
}
