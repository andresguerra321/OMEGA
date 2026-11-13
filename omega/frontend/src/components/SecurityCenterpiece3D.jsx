import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const SURFACE_COLORS = {
  clean: {
    rim: 0x3b82f6,
    bevel: 0x22c55e,
    bevelEmissive: 0x15803d,
    core: 0x4ade80,
    ring: 0x22c55e,
    wire: 0x86efac,
  },
  alert: {
    rim: 0x3b82f6,
    bevel: 0xef4444,
    bevelEmissive: 0x991b1b,
    core: 0xf87171,
    ring: 0xef4444,
    wire: 0xfca5a5,
  },
  standby: {
    rim: 0x3b82f6,
    bevel: 0x2563eb,
    bevelEmissive: 0x1d4ed8,
    core: 0x60a5fa,
    ring: 0x2563eb,
    wire: 0x93c5fd,
  },
};

const SURFACE_RING_ORIENTATION = {
  windows: { tiltX: 0.14, tiltY: -0.2, secondaryZ: 0 },
  usb: { tiltX: 0.36, tiltY: 0.24, secondaryZ: 0.28 },
  link: { tiltX: -0.16, tiltY: 0.42, secondaryZ: -0.22 },
  corpus: { tiltX: 0.48, tiltY: -0.12, secondaryZ: 0.16 },
};

const LOGO_SCALE = 0.036;
const mx = (x) => (x - 40) * LOGO_SCALE;
const my = (y) => (40 - y) * LOGO_SCALE;

function createShieldShape() {
  const s = new THREE.Shape();
  s.moveTo(mx(40), my(5.8));
  s.bezierCurveTo(mx(45.8), my(9.6), mx(54.2), my(12.1), mx(65.5), my(13.6));
  s.lineTo(mx(65.5), my(37.2));
  s.bezierCurveTo(mx(65.5), my(53.8), mx(54.6), my(66.5), mx(40), my(73.6));
  s.bezierCurveTo(mx(25.4), my(66.5), mx(14.5), my(53.8), mx(14.5), my(37.2));
  s.lineTo(mx(14.5), my(13.6));
  s.bezierCurveTo(mx(25.8), my(12.1), mx(34.2), my(9.6), mx(40), my(5.8));
  return s;
}

function createInnerCavityPoints(zPos) {
  const c = new THREE.Shape();
  c.moveTo(mx(40), my(10.2));
  c.bezierCurveTo(mx(45.2), my(13.3), mx(52.4), my(15.4), mx(61.5), my(16.8));
  c.lineTo(mx(61.5), my(37));
  c.bezierCurveTo(mx(61.5), my(51.3), mx(52.2), my(62.3), mx(40), my(68.4));
  c.bezierCurveTo(mx(27.8), my(62.3), mx(18.5), my(51.3), mx(18.5), my(37));
  c.lineTo(mx(18.5), my(16.8));
  c.bezierCurveTo(mx(27.6), my(15.4), mx(34.8), my(13.3), mx(40), my(10.2));
  return c.getPoints(96).map((p) => new THREE.Vector3(p.x, p.y, zPos));
}

function createOmegaGlyphShape() {
  const g = new THREE.Shape();
  g.moveTo(mx(34.2), my(54.2));
  g.lineTo(mx(23.6), my(54.2));
  g.lineTo(mx(23.6), my(47.2));
  g.lineTo(mx(29.4), my(47.2));
  g.bezierCurveTo(mx(26.1), my(43.9), mx(24.2), my(39.4), mx(24.2), my(34.3));
  g.bezierCurveTo(mx(24.2), my(25.1), mx(31.1), my(18.2), mx(40), my(18.2));
  g.bezierCurveTo(mx(48.9), my(18.2), mx(55.8), my(25.1), mx(55.8), my(34.3));
  g.bezierCurveTo(mx(55.8), my(39.4), mx(53.9), my(43.9), mx(50.6), my(47.2));
  g.lineTo(mx(56.4), my(47.2));
  g.lineTo(mx(56.4), my(54.2));
  g.lineTo(mx(45.8), my(54.2));
  g.lineTo(mx(45.8), my(46.8));
  g.bezierCurveTo(mx(48.7), my(44.1), mx(50.3), my(39.9), mx(50.3), my(34.7));
  g.bezierCurveTo(mx(50.3), my(28), mx(45.8), my(23.2), mx(40), my(23.2));
  g.bezierCurveTo(mx(34.2), my(23.2), mx(29.7), my(28), mx(29.7), my(34.7));
  g.bezierCurveTo(mx(29.7), my(39.9), mx(31.3), my(44.1), mx(34.2), my(46.8));
  g.lineTo(mx(34.2), my(54.2));
  return g;
}

function attachScanDiscardShader(material, sharedUniforms, lagWorld = 0.28) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uScanOrigin = sharedUniforms.uScanOrigin;
    shader.uniforms.uScanRadius = sharedUniforms.uScanRadius;
    shader.uniforms.uScanEnabled = sharedUniforms.uScanEnabled;
    shader.uniforms.uScanLag = { value: lagWorld };

    shader.vertexShader = `varying vec3 vScanWorldPos;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `#include <project_vertex>\n  vScanWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );

    shader.fragmentShader = `
uniform vec3 uScanOrigin;
uniform float uScanRadius;
uniform float uScanEnabled;
uniform float uScanLag;
varying vec3 vScanWorldPos;
${shader.fragmentShader}`.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
  if (uScanEnabled > 0.5) {
    float scanWobble =
      sin(vScanWorldPos.y * 5.0 + vScanWorldPos.x * 3.4) * 0.08 +
      sin(vScanWorldPos.z * 6.4 + vScanWorldPos.y * 5.2) * 0.04;
    if (distance(vScanWorldPos, uScanOrigin) > (uScanRadius - uScanLag + scanWobble)) {
      discard;
    }
  }`,
    );
  };
  material.customProgramCacheKey = () => `omega-scan-${lagWorld}`;
}

function createWireCageMaterial(sharedUniforms, colorHex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uScanOrigin: sharedUniforms.uScanOrigin,
      uScanRadius: sharedUniforms.uScanRadius,
      uWireOpacity: sharedUniforms.uWireOpacity,
      uWireColor: { value: new THREE.Color(colorHex) },
    },
    vertexShader: `
varying vec3 vScanWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vScanWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    fragmentShader: `
uniform vec3 uScanOrigin;
uniform float uScanRadius;
uniform float uWireOpacity;
uniform vec3 uWireColor;
varying vec3 vScanWorldPos;
void main() {
  float d = distance(vScanWorldPos, uScanOrigin);
  float rim = exp(-pow((d - uScanRadius) / 0.38, 2.0));
  float ahead = smoothstep(uScanRadius + 1.8, uScanRadius + 0.1, d) * 0.28;
  float trail = smoothstep(uScanRadius + 0.15, uScanRadius - 1.85, d) * 0.48;
  float alpha = (rim * 1.4 + trail + ahead) * uWireOpacity;
  if (alpha < 0.015) discard;
  gl_FragColor = vec4(uWireColor, clamp(alpha, 0.0, 1.0));
}`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function buildOmegaCrestAssembly(palette, scanUniforms, disposables) {
  const emblemPivot = new THREE.Group();
  const cageGroup = new THREE.Group();

  const reg = (item) => {
    disposables.push(item);
    return item;
  };

  // Materiales arquitectónicos Negro · Blanco · Azul Rey con shader de revelación wireframe
  const obsidianShieldMat = reg(
    new THREE.MeshStandardMaterial({
      color: 0x0b1220,
      metalness: 0.86,
      roughness: 0.17,
      emissive: 0x07122a,
      emissiveIntensity: 0.38,
    }),
  );
  attachScanDiscardShader(obsidianShieldMat, scanUniforms, 0.28);

  const titaniumGlyphMat = reg(
    new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      metalness: 0.64,
      roughness: 0.18,
      emissive: palette.core,
      emissiveIntensity: 0.16,
    }),
  );
  attachScanDiscardShader(titaniumGlyphMat, scanUniforms, 0.22);

  // 1. Escudo OMEGA mecanizado en obsidiana (biseñado fino sin apariencia cartoon)
  const shieldGeo = reg(
    new THREE.ExtrudeGeometry(createShieldShape(), {
      depth: 0.056,
      bevelEnabled: true,
      bevelThickness: 0.014,
      bevelSize: 0.012,
      bevelSegments: 4,
      curveSegments: 28,
    }),
  );
  shieldGeo.translate(0, 0, -0.028);
  const shieldMesh = new THREE.Mesh(shieldGeo, obsidianShieldMat);
  shieldMesh.castShadow = true;
  emblemPivot.add(shieldMesh);

  // Arista plateada ultrafina alrededor del bisel del escudo
  const shieldEdgesGeo = reg(new THREE.EdgesGeometry(shieldGeo, 18));
  const shieldRimMat = reg(
    new THREE.LineBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.44,
    }),
  );
  emblemPivot.add(new THREE.LineSegments(shieldEdgesGeo, shieldRimMat));

  // Cavidad óptica interior Azul Rey / verde / rojo en frente y reverso
  const cavityLineMat = reg(
    new THREE.LineBasicMaterial({
      color: palette.bevel,
      transparent: true,
      opacity: 0.88,
    }),
  );
  for (const zOff of [0.046, -0.046]) {
    const cavGeo = reg(new THREE.BufferGeometry().setFromPoints(createInnerCavityPoints(zOff)));
    emblemPivot.add(new THREE.LineLoop(cavGeo, cavityLineMat));
  }

  // 2. Monograma Ω esculpido en titanio blanco frontal y reverso simétrico para giro 360°
  const omegaGeo = reg(
    new THREE.ExtrudeGeometry(createOmegaGlyphShape(), {
      depth: 0.022,
      bevelEnabled: true,
      bevelThickness: 0.007,
      bevelSize: 0.006,
      bevelSegments: 3,
      curveSegments: 28,
    }),
  );
  const omegaFront = new THREE.Mesh(omegaGeo, titaniumGlyphMat);
  omegaFront.position.z = 0.038;
  omegaFront.castShadow = true;
  emblemPivot.add(omegaFront);

  const omegaBack = new THREE.Mesh(omegaGeo, titaniumGlyphMat);
  omegaBack.position.z = -0.038;
  omegaBack.rotation.y = Math.PI;
  emblemPivot.add(omegaBack);

  // 3. Jaula temporal CAD wireframe (malla completa + contorno limpio) que conduce el barrido futurista
  const wireMat = reg(createWireCageMaterial(scanUniforms, palette.wire));
  const shieldWireGeo = reg(new THREE.WireframeGeometry(shieldGeo));
  const shieldWire = new THREE.LineSegments(shieldWireGeo, wireMat);
  shieldWire.scale.setScalar(1.003);
  cageGroup.add(shieldWire);

  const omegaEdgesGeo = reg(new THREE.EdgesGeometry(omegaGeo, 16));
  const omegaWireFront = new THREE.LineSegments(omegaEdgesGeo, wireMat);
  omegaWireFront.position.z = 0.04;
  cageGroup.add(omegaWireFront);

  emblemPivot.add(cageGroup);

  // 4. Instrumentación circular futurista tipo cronómetro alrededor del emblema (proporcionada sin tapar <h1> ni <360°>)
  const dialGroup = new THREE.Group();

  // Dial radial de 60 marcas de calibración
  const tickPositions = [];
  const tickColors = [];
  for (let i = 0; i < 60; i += 1) {
    const ang = (i / 60) * Math.PI * 2;
    const isMajor = i % 5 === 0;
    const rIn = isMajor ? 1.37 : 1.42;
    const rOut = 1.48;
    tickPositions.push(Math.cos(ang) * rIn, Math.sin(ang) * rIn, -0.06);
    tickPositions.push(Math.cos(ang) * rOut, Math.sin(ang) * rOut, -0.06);
    const v = isMajor ? 0.62 : 0.22;
    const b = isMajor ? 0.88 : 0.34;
    tickColors.push(v, v + 0.05, b, v, v + 0.05, b);
  }
  const ticksGeo = reg(new THREE.BufferGeometry());
  ticksGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickPositions, 3));
  ticksGeo.setAttribute('color', new THREE.Float32BufferAttribute(tickColors, 3));
  const ticksMat = reg(
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
    }),
  );
  const ticksObj = new THREE.LineSegments(ticksGeo, ticksMat);
  dialGroup.add(ticksObj);

  // Arco de retícula en cuatro cuadrantes finos (contra-rotación sutil)
  const bracketPositions = [];
  const rBr = 1.24;
  for (let q = 0; q < 4; q += 1) {
    const startA = q * (Math.PI / 2) + 0.26;
    const endA = (q + 1) * (Math.PI / 2) - 0.26;
    const steps = 14;
    for (let s = 0; s < steps; s += 1) {
      const a0 = THREE.MathUtils.lerp(startA, endA, s / steps);
      const a1 = THREE.MathUtils.lerp(startA, endA, (s + 1) / steps);
      bracketPositions.push(Math.cos(a0) * rBr, Math.sin(a0) * rBr, -0.04);
      bracketPositions.push(Math.cos(a1) * rBr, Math.sin(a1) * rBr, -0.04);
    }
  }
  const bracketGeo = reg(new THREE.BufferGeometry());
  bracketGeo.setAttribute('position', new THREE.Float32BufferAttribute(bracketPositions, 3));
  const bracketMat = reg(
    new THREE.LineBasicMaterial({
      color: 0xcbd5e1,
      transparent: true,
      opacity: 0.38,
    }),
  );
  const bracketObj = new THREE.LineSegments(bracketGeo, bracketMat);
  dialGroup.add(bracketObj);

  // Halo orbital fino Azul Rey reactivo al modo y superficie seleccionada
  const gyroOrbitGroup = new THREE.Group();
  gyroOrbitGroup.rotation.set(0.14, -0.2, 0);

  const royalRingGeo = reg(new THREE.TorusGeometry(1.61, 0.0085, 16, 128));
  const royalRingMat = reg(
    new THREE.MeshStandardMaterial({
      color: palette.bevel,
      metalness: 0.25,
      roughness: 0.2,
      emissive: palette.bevelEmissive,
      emissiveIntensity: 1.05,
    }),
  );
  const royalRingMesh = new THREE.Mesh(royalRingGeo, royalRingMat);
  gyroOrbitGroup.add(royalRingMesh);

  // Nodo trazador micro-satélite desplazándose por el halo
  const satNodeGeo = reg(new THREE.OctahedronGeometry(0.036, 0));
  const satNodeMat = reg(
    new THREE.MeshBasicMaterial({
      color: 0xf8fafc,
    }),
  );
  const satNode = new THREE.Mesh(satNodeGeo, satNodeMat);
  satNode.position.set(1.61, 0, 0);
  gyroOrbitGroup.add(satNode);

  dialGroup.add(gyroOrbitGroup);

  return {
    emblemPivot,
    cageGroup,
    dialGroup,
    ticksObj,
    bracketObj,
    gyroOrbitGroup,
    satNode,
    shieldRimMat,
    cavityLineMat,
    titaniumGlyphMat,
    royalRingMat,
    wireMat,
  };
}

function buildPerspectiveFloorGrid(disposables) {
  const halfExtent = 16.8;
  const step = 1.4;
  const subStep = 1.2;
  const positions = [];
  const colors = [];

  const pushFadeColor = (x, z, isAccentAxis) => {
    const radial = Math.hypot(x, z * 0.72);
    const centerHole = THREE.MathUtils.smoothstep(radial, 1.6, 3.0);
    const farFade = 1 - THREE.MathUtils.smoothstep(radial, 5.2, 14.5);
    const intensity = centerHole * farFade;
    const baseR = isAccentAxis ? 0.14 : 0.09;
    const baseG = isAccentAxis ? 0.31 : 0.14;
    const baseB = isAccentAxis ? 0.68 : 0.24;
    colors.push(baseR * intensity, baseG * intensity, baseB * intensity);
  };

  for (let gx = -halfExtent; gx <= halfExtent + 0.001; gx += step) {
    const isCenterAxis = Math.abs(gx) < 0.05;
    for (let z = -18; z < 8; z += subStep) {
      const z2 = Math.min(8, z + subStep);
      positions.push(gx, -1.26, z, gx, -1.26, z2);
      pushFadeColor(gx, z, isCenterAxis);
      pushFadeColor(gx, z2, isCenterAxis);
    }
  }

  for (let gz = -18; gz <= 8 + 0.001; gz += step) {
    const isHorizonAxis = Math.abs(gz + 2.8) < 0.15;
    for (let x = -halfExtent; x < halfExtent; x += subStep) {
      const x2 = Math.min(halfExtent, x + subStep);
      positions.push(x, -1.26, gz, x2, -1.26, gz);
      pushFadeColor(x, gz, isHorizonAxis);
      pushFadeColor(x2, gz, isHorizonAxis);
    }
  }

  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  gridGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const gridMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  disposables.push(gridGeo, gridMat);
  return new THREE.LineSegments(gridGeo, gridMat);
}

function buildAtmosphericMotes(disposables) {
  const count = 88;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i += 1) {
    const s1 = Math.sin(i * 12.9898) * 43758.5453;
    const s2 = Math.sin(i * 78.233) * 19341.123;
    const s3 = Math.sin(i * 39.425) * 65123.771;
    const r1 = s1 - Math.floor(s1);
    const r2 = s2 - Math.floor(s2);
    const r3 = s3 - Math.floor(s3);

    let x = (r1 - 0.5) * 17;
    if (Math.abs(x) < 2.2) x += x >= 0 ? 2.4 : -2.4;
    const y = -0.8 + r2 * 4.2;
    const z = -11.5 + r3 * 12.5;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const royal = i % 3 === 0;
    colors[i * 3] = royal ? 0.24 : 0.78;
    colors[i * 3 + 1] = royal ? 0.51 : 0.85;
    colors[i * 3 + 2] = royal ? 0.96 : 0.94;
  }

  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  moteGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const moteMat = new THREE.PointsMaterial({
    size: 0.04,
    vertexColors: true,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  disposables.push(moteGeo, moteMat);
  return new THREE.Points(moteGeo, moteMat);
}

export function SecurityCenterpiece3D({
  surfaceId = 'windows',
  healthy = false,
  alert = false,
  spinNonce = 0,
}) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const spinTargetRef = useRef(0);
  const scanResetNonceRef = useRef(spinNonce);
  const lastSpinNonceRef = useRef(spinNonce);
  const stateRef = useRef({ surfaceId, healthy, alert });
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  useEffect(() => {
    stateRef.current = { surfaceId, healthy, alert };
  }, [surfaceId, healthy, alert]);

  useEffect(() => {
    if (spinNonce !== lastSpinNonceRef.current) {
      lastSpinNonceRef.current = spinNonce;
      spinTargetRef.current += Math.PI * 2;
      scanResetNonceRef.current = spinNonce;
    }
  }, [spinNonce]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      queueMicrotask(() => setWebglUnavailable(true));
      return undefined;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
    camera.position.set(0, 1.18, 10.2);

    const initialPalette = stateRef.current.alert
      ? SURFACE_COLORS.alert
      : stateRef.current.healthy
        ? SURFACE_COLORS.clean
        : SURFACE_COLORS.standby;

    const scanUniforms = {
      uScanOrigin: { value: new THREE.Vector3(-1.35, -1.1, 0.55) },
      uScanRadius: { value: 0.9 },
      uScanEnabled: { value: 1 },
      uWireOpacity: { value: 0 },
    };

    const disposables = [];
    const stageGroup = new THREE.Group();
    const crestCenterGroup = new THREE.Group();
    crestCenterGroup.position.set(0, 0.08, 0);

    const {
      emblemPivot,
      cageGroup,
      dialGroup,
      ticksObj,
      bracketObj,
      gyroOrbitGroup,
      satNode,
      shieldRimMat,
      cavityLineMat,
      titaniumGlyphMat,
      royalRingMat,
      wireMat,
    } = buildOmegaCrestAssembly(initialPalette, scanUniforms, disposables);

    emblemPivot.rotation.y = -0.14;
    crestCenterGroup.add(dialGroup);
    crestCenterGroup.add(emblemPivot);
    stageGroup.add(crestCenterGroup);

    const perspectiveGrid = buildPerspectiveFloorGrid(disposables);
    stageGroup.add(perspectiveGrid);

    const motes = buildAtmosphericMotes(disposables);
    stageGroup.add(motes);

    // Anillos de pedestal + cruz de calibración sobre el piso en perspectiva
    const floorRingGeo = new THREE.RingGeometry(1.76, 1.8, 96);
    const floorRingMat = new THREE.MeshBasicMaterial({
      color: initialPalette.ring,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
    });
    const innerFloorGeo = new THREE.RingGeometry(1.24, 1.26, 96);
    const innerFloorMat = new THREE.MeshBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
    });
    const crossGeo = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          -2.1, -1.245, 0, -1.68, -1.245, 0,
          1.68, -1.245, 0, 2.1, -1.245, 0,
          0, -1.245, -2.1, 0, -1.245, -1.68,
          0, -1.245, 1.68, 0, -1.245, 2.1,
        ],
        3,
      ),
    );
    const crossMat = new THREE.LineBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.3,
    });
    disposables.push(floorRingGeo, floorRingMat, innerFloorGeo, innerFloorMat, crossGeo, crossMat);

    const floorRing = new THREE.Mesh(floorRingGeo, floorRingMat);
    floorRing.position.set(0, -1.24, 0);
    floorRing.rotation.x = -Math.PI / 2;
    stageGroup.add(floorRing);

    const innerFloor = new THREE.Mesh(innerFloorGeo, innerFloorMat);
    innerFloor.position.set(0, -1.24, 0);
    innerFloor.rotation.x = -Math.PI / 2;
    stageGroup.add(innerFloor);

    stageGroup.add(new THREE.LineSegments(crossGeo, crossMat));

    const shadowPlaneGeo = new THREE.PlaneGeometry(8, 8);
    const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.36 });
    disposables.push(shadowPlaneGeo, shadowPlaneMat);
    const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
    shadowPlane.position.set(0, -1.25, 0);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.receiveShadow = true;
    stageGroup.add(shadowPlane);

    scene.add(stageGroup);

    // Iluminación de estudio limpia para resaltar biseles del escudo y titanio Ω
    const hemi = new THREE.HemisphereLight(0xe2e8f0, 0x050a14, 0.95);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.9);
    keyLight.position.set(2.6, 4.6, 5.4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 16;
    scene.add(keyLight);

    const royalRim = new THREE.DirectionalLight(initialPalette.rim, 2.6);
    royalRim.position.set(-4.4, 1.9, -2.6);
    scene.add(royalRim);

    const fillFront = new THREE.DirectionalLight(0x93c5fd, 1.25);
    fillFront.position.set(0.4, 0.3, 4.8);
    scene.add(fillFront);

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let viewport = { width: 1, height: 1, left: 0, top: 0 };
    const pointerTarget = { x: 0, y: 0 };
    const smoothPointer = { x: 0, y: 0 };
    let dragActive = false;
    let dragStartX = 0;
    let dragRotationOffset = 0;
    let spinCurrent = 0;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      viewport = {
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
        left: rect.left,
        top: rect.top,
      };
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(viewport.width, viewport.height, false);
      camera.aspect = viewport.width / viewport.height;
      camera.position.z = viewport.width < 640 ? 14.2 : viewport.width < 1100 ? 11.2 : 10.2;
      camera.updateProjectionMatrix();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const onPointerMove = (ev) => {
      if (dragActive) {
        const dx = ev.clientX - dragStartX;
        dragStartX = ev.clientX;
        dragRotationOffset += dx * 0.0085;
        return;
      }
      if (ev.pointerType === 'touch') return;
      pointerTarget.x = ((ev.clientX - viewport.left) / viewport.width) * 2 - 1;
      pointerTarget.y = ((ev.clientY - viewport.top) / viewport.height) * 2 - 1;
    };

    const onPointerDown = (ev) => {
      if (ev.pointerType === 'touch') return;
      if (
        ev.target instanceof Element &&
        ev.target.closest('button, a, input, select, form, header, footer, [role="listbox"]')
      ) {
        return;
      }
      dragActive = true;
      dragStartX = ev.clientX;
    };

    const onPointerUp = () => {
      dragActive = false;
    };

    const onPointerLeave = () => {
      dragActive = false;
      pointerTarget.x = 0;
      pointerTarget.y = 0;
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    document.addEventListener('mouseleave', onPointerLeave);

    let rafId = 0;
    let lastTs = performance.now();
    const startTs = lastTs;
    let scanStartTs = startTs;
    let appliedScanNonce = scanResetNonceRef.current;
    const SCAN_DURATION = 1.25;
    const SCAN_MAX_RADIUS = 4.6;

    const targetBevelColor = new THREE.Color(initialPalette.bevel);
    const targetEmissiveColor = new THREE.Color(initialPalette.bevelEmissive);
    const targetCoreColor = new THREE.Color(initialPalette.core);
    const targetRingColor = new THREE.Color(initialPalette.ring);
    const targetWireColor = new THREE.Color(initialPalette.wire);

    const smoothstep = (edge0, edge1, x) => {
      const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
      return t * t * (3 - 2 * t);
    };

    const renderFrame = (now) => {
      const rawDt = (now - lastTs) / 1000;
      const dt = Math.min(Math.max(rawDt, 0.001), 1 / 30);
      lastTs = now;
      const elapsed = (now - startTs) / 1000;

      const { surfaceId: curSurface, healthy: curHealthy, alert: curAlert } = stateRef.current;
      const curPalette = curAlert
        ? SURFACE_COLORS.alert
        : curHealthy
          ? SURFACE_COLORS.clean
          : SURFACE_COLORS.standby;
      targetBevelColor.setHex(curPalette.bevel);
      targetEmissiveColor.setHex(curPalette.bevelEmissive);
      targetCoreColor.setHex(curPalette.core);
      targetRingColor.setHex(curPalette.ring);
      targetWireColor.setHex(curPalette.wire);

      const colorLerp = Math.min(1, dt * 6);
      cavityLineMat.color.lerp(targetBevelColor, colorLerp);
      royalRingMat.color.lerp(targetBevelColor, colorLerp);
      royalRingMat.emissive.lerp(targetEmissiveColor, colorLerp);
      titaniumGlyphMat.emissive.lerp(targetCoreColor, colorLerp);
      floorRingMat.color.lerp(targetRingColor, colorLerp);
      wireMat.uniforms.uWireColor.value.lerp(targetWireColor, colorLerp);

      const targetOrient = SURFACE_RING_ORIENTATION[curSurface] || SURFACE_RING_ORIENTATION.windows;
      gyroOrbitGroup.rotation.x += (targetOrient.tiltX - gyroOrbitGroup.rotation.x) * Math.min(1, dt * 4);
      gyroOrbitGroup.rotation.y += (targetOrient.tiltY - gyroOrbitGroup.rotation.y) * Math.min(1, dt * 4);

      if (appliedScanNonce !== scanResetNonceRef.current) {
        appliedScanNonce = scanResetNonceRef.current;
        scanStartTs = now;
      }

      const lookY = viewport.width < 640 ? -1.18 : -0.3;

      if (reduceMotion) {
        scanUniforms.uScanEnabled.value = 0;
        cageGroup.visible = false;
        shieldRimMat.opacity = 0.44;
        cavityLineMat.opacity = 0.88;
        camera.position.x = -0.2;
        camera.position.y = 1.18;
        camera.lookAt(-0.08, lookY, 0);
        emblemPivot.rotation.y = -0.14 + dragRotationOffset + spinTargetRef.current;
        renderer.render(scene, camera);
        return;
      }

      // Barrido futurista con wireframe completo sincronizado (sin cortes huecos en el borde)
      const scanElapsed = (now - scanStartTs) / 1000;
      const e = Math.min(1, scanElapsed / SCAN_DURATION);
      if (e < 1) {
        const eased = 0.28 + 0.72 * (1 - Math.pow(1 - e, 1.35));
        scanUniforms.uScanEnabled.value = 1;
        scanUniforms.uScanRadius.value = eased * SCAN_MAX_RADIUS;
        scanUniforms.uWireOpacity.value = Math.min(1, e / 0.08 + 0.35) * (1 - smoothstep(0.68, 1, e));
        const rimReveal = smoothstep(0.45, 0.98, e);
        shieldRimMat.opacity = 0.44 * rimReveal;
        cavityLineMat.opacity = 0.88 * rimReveal;
        cageGroup.visible = true;
      } else {
        scanUniforms.uScanEnabled.value = 0;
        scanUniforms.uWireOpacity.value = 0;
        shieldRimMat.opacity = 0.44;
        cavityLineMat.opacity = 0.88;
        cageGroup.visible = false;
      }

      const alpha = 1 - Math.pow(1 - 0.055, dt * 60);
      smoothPointer.x += (pointerTarget.x - smoothPointer.x) * alpha;
      smoothPointer.y += (pointerTarget.y - smoothPointer.y) * alpha;
      spinCurrent += (spinTargetRef.current - spinCurrent) * 0.09;

      // Paralaje suave de cámara y escudo OMEGA
      camera.position.x = -smoothPointer.x * 0.48;
      camera.position.y = 1.18 + smoothPointer.y * 0.2;
      camera.lookAt(camera.position.x * 0.3, lookY + (camera.position.y - 1.18) * 0.32, 0);

      emblemPivot.rotation.y =
        -0.14 + Math.sin(elapsed * 0.42) * 0.14 + smoothPointer.x * 0.18 + dragRotationOffset + spinCurrent;
      emblemPivot.rotation.x = smoothPointer.y * 0.05;
      crestCenterGroup.position.y = 0.08 + Math.sin(elapsed * 1.15) * 0.038;

      // Anillos de calibración tipo cronómetro de precisión
      ticksObj.rotation.z = elapsed * 0.055;
      bracketObj.rotation.z = -elapsed * 0.095;
      gyroOrbitGroup.rotation.z += dt * 0.28;
      const satAngle = elapsed * 0.65;
      satNode.position.set(Math.cos(satAngle) * 1.61, Math.sin(satAngle) * 1.61, 0);

      // Deriva continua del piso reticulado y micro-partículas
      perspectiveGrid.position.z = (elapsed * 0.2) % 1.4;
      motes.rotation.y = elapsed * 0.014;

      renderer.render(scene, camera);
      if (!document.hidden) {
        rafId = requestAnimationFrame(renderFrame);
      }
    };

    const onVisibility = () => {
      cancelAnimationFrame(rafId);
      if (!document.hidden && !reduceMotion) {
        lastTs = performance.now();
        rafId = requestAnimationFrame(renderFrame);
      }
    };

    renderFrame(performance.now());
    if (!reduceMotion && !document.hidden) {
      rafId = requestAnimationFrame(renderFrame);
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('mouseleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      disposables.forEach((item) => item?.dispose?.());
      renderer.dispose();
    };
  }, []);

  if (webglUnavailable) {
    return (
      <div className="relative w-full h-full flex items-center justify-center">
        <svg
          width="220"
          height="220"
          viewBox="0 0 220 220"
          aria-hidden="true"
          className="drop-shadow-[0_24px_40px_rgba(29,78,216,0.28)]"
        >
          <circle
            cx="110"
            cy="110"
            r="88"
            fill="none"
            stroke="rgba(148,163,184,0.28)"
            strokeWidth="1"
            strokeDasharray="3 6"
          />
          <circle
            cx="110"
            cy="110"
            r="72"
            fill="none"
            stroke={alert ? '#EF4444' : healthy ? '#22C55E' : '#2563EB'}
            strokeWidth="1.25"
          />
          <g transform="translate(70, 70)">
            <path
              d="M40 5.8C45.8 9.6 54.2 12.1 65.5 13.6V37.2C65.5 53.8 54.6 66.5 40 73.6C25.4 66.5 14.5 53.8 14.5 37.2V13.6C25.8 12.1 34.2 9.6 40 5.8Z"
              fill="#0B1220"
              stroke="rgba(226,232,240,0.45)"
              strokeWidth="1.25"
            />
            <path
              d="M34.2 54.2H23.6V47.2H29.4C26.1 43.9 24.2 39.4 24.2 34.3C24.2 25.1 31.1 18.2 40 18.2C48.9 18.2 55.8 25.1 55.8 34.3C55.8 39.4 53.9 43.9 50.6 47.2H56.4V54.2H45.8V46.8C48.7 44.1 50.3 39.9 50.3 34.7C50.3 28 45.8 23.2 40 23.2C34.2 23.2 29.7 28 29.7 34.7C29.7 39.9 31.3 44.1 34.2 46.8V54.2Z"
              fill="#F8FAFC"
            />
          </g>
        </svg>
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="relative w-full h-full touch-pan-y cursor-grab active:cursor-grabbing select-none"
    >
      <canvas ref={canvasRef} className="block w-full h-full touch-pan-y" />
    </div>
  );
}
