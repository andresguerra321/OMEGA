import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const SURFACE_COLORS = {
  clean: {
    rim: 0x3b82f6,
    bevel: 0x2563eb,
    bevelEmissive: 0x1d4ed8,
    core: 0x22c55e,
    ring: 0x22c55e,
  },
  alert: {
    rim: 0x3b82f6,
    bevel: 0xef4444,
    bevelEmissive: 0x7f1d1d,
    core: 0xef4444,
    ring: 0xef4444,
  },
  standby: {
    rim: 0x3b82f6,
    bevel: 0x3b82f6,
    bevelEmissive: 0x1d4ed8,
    core: 0x60a5fa,
    ring: 0x2563eb,
  },
};

function buildSurfaceMeshGroup(surfaceId, palette, disposables) {
  const group = new THREE.Group();

  const obsidianMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.78,
    roughness: 0.24,
  });
  const brushedSteelMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    metalness: 0.88,
    roughness: 0.2,
  });
  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x273549,
    metalness: 0.62,
    roughness: 0.3,
  });
  const royalBevelMat = new THREE.MeshStandardMaterial({
    color: palette.bevel,
    metalness: 0.3,
    roughness: 0.22,
    emissive: palette.bevelEmissive,
    emissiveIntensity: 0.95,
  });
  const coreCrystalMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    metalness: 0.42,
    roughness: 0.16,
    emissive: palette.core,
    emissiveIntensity: 0.72,
    flatShading: true,
  });
  disposables.push(obsidianMat, brushedSteelMat, deckMat, royalBevelMat, coreCrystalMat);

  const registerGeo = (geo) => {
    disposables.push(geo);
    return geo;
  };

  if (surfaceId === 'usb') {
    // Dispositivo móvil esculpido con anillos de inspección coaxiales
    const phoneBody = new THREE.Mesh(
      registerGeo(new THREE.BoxGeometry(1.16, 2.15, 0.14)),
      obsidianMat,
    );
    phoneBody.rotation.z = -0.14;
    phoneBody.rotation.x = 0.08;
    phoneBody.castShadow = true;
    group.add(phoneBody);

    const screenBezel = new THREE.Mesh(
      registerGeo(new THREE.BoxGeometry(1.04, 1.98, 0.15)),
      deckMat,
    );
    screenBezel.rotation.copy(phoneBody.rotation);
    group.add(screenBezel);

    const sideFrame = new THREE.Mesh(
      registerGeo(new THREE.BoxGeometry(1.2, 2.19, 0.09)),
      brushedSteelMat,
    );
    sideFrame.rotation.copy(phoneBody.rotation);
    group.add(sideFrame);

    const coreBeacon = new THREE.Mesh(
      registerGeo(new THREE.OctahedronGeometry(0.28, 0)),
      coreCrystalMat,
    );
    coreBeacon.position.set(0, 0.05, 0.16);
    group.add(coreBeacon);

    const lockRing = new THREE.Mesh(
      registerGeo(new THREE.TorusGeometry(1.52, 0.025, 20, 96)),
      royalBevelMat,
    );
    lockRing.rotation.x = Math.PI * 0.42;
    lockRing.rotation.y = 0.22;
    group.add(lockRing);

    const outerRing = new THREE.Mesh(
      registerGeo(new THREE.TorusGeometry(1.78, 0.014, 16, 96)),
      brushedSteelMat,
    );
    outerRing.rotation.x = Math.PI * 0.56;
    outerRing.rotation.z = -0.25;
    group.add(outerRing);

    return { group, rotatingParts: [lockRing, outerRing, coreBeacon] };
  }

  if (surfaceId === 'link') {
    // Dos compuertas prismáticas separadas por puente óptico pasivo
    const leftGate = new THREE.Mesh(
      registerGeo(new THREE.BoxGeometry(0.95, 1.65, 0.22)),
      obsidianMat,
    );
    leftGate.position.set(-1.12, 0, 0.15);
    leftGate.rotation.y = 0.36;
    leftGate.castShadow = true;
    group.add(leftGate);

    const rightGate = new THREE.Mesh(
      registerGeo(new THREE.BoxGeometry(0.95, 1.65, 0.22)),
      obsidianMat,
    );
    rightGate.position.set(1.12, 0, -0.15);
    rightGate.rotation.y = -0.36;
    rightGate.castShadow = true;
    group.add(rightGate);

    const leftTrim = new THREE.Mesh(
      registerGeo(new THREE.BoxGeometry(0.99, 1.69, 0.16)),
      brushedSteelMat,
    );
    leftTrim.position.copy(leftGate.position);
    leftTrim.rotation.copy(leftGate.rotation);
    group.add(leftTrim);

    const rightTrim = new THREE.Mesh(
      registerGeo(new THREE.BoxGeometry(0.99, 1.69, 0.16)),
      brushedSteelMat,
    );
    rightTrim.position.copy(rightGate.position);
    rightTrim.rotation.copy(rightGate.rotation);
    group.add(rightTrim);

    const gatewayRing = new THREE.Mesh(
      registerGeo(new THREE.TorusGeometry(0.92, 0.032, 24, 96)),
      royalBevelMat,
    );
    gatewayRing.rotation.y = Math.PI * 0.25;
    group.add(gatewayRing);

    const prismCore = new THREE.Mesh(
      registerGeo(new THREE.IcosahedronGeometry(0.42, 0)),
      coreCrystalMat,
    );
    prismCore.castShadow = true;
    group.add(prismCore);

    return { group, rotatingParts: [gatewayRing, prismCore] };
  }

  if (surfaceId === 'corpus') {
    // Bóveda forense laminar STIX 2.1 con núcleo cristalino
    const layers = [-0.52, -0.18, 0.18, 0.52];
    const plateRadii = [1.35, 1.52, 1.52, 1.35];
    const rotatingParts = [];

    layers.forEach((yPos, idx) => {
      const plate = new THREE.Mesh(
        registerGeo(new THREE.CylinderGeometry(plateRadii[idx], plateRadii[idx] * 0.94, 0.11, 8)),
        idx === 1 || idx === 2 ? deckMat : obsidianMat,
      );
      plate.position.y = yPos;
      plate.castShadow = true;
      group.add(plate);

      const trim = new THREE.Mesh(
        registerGeo(new THREE.TorusGeometry(plateRadii[idx] * 1.02, 0.015, 12, 8)),
        idx === 1 ? royalBevelMat : brushedSteelMat,
      );
      trim.position.y = yPos;
      trim.rotation.x = Math.PI / 2;
      group.add(trim);
    });

    const jewel = new THREE.Mesh(
      registerGeo(new THREE.OctahedronGeometry(0.56, 0)),
      coreCrystalMat,
    );
    group.add(jewel);
    rotatingParts.push(jewel);

    const halo = new THREE.Mesh(
      registerGeo(new THREE.TorusGeometry(1.88, 0.02, 18, 96)),
      royalBevelMat,
    );
    halo.rotation.x = Math.PI * 0.44;
    halo.rotation.y = -0.18;
    group.add(halo);
    rotatingParts.push(halo);

    return { group, rotatingParts };
  }

  // 'windows': Estación local de precisión con anillo giroscópico Azul Rey
  const chassisBase = new THREE.Mesh(
    registerGeo(new THREE.BoxGeometry(2.55, 0.11, 1.72)),
    obsidianMat,
  );
  chassisBase.position.set(0, -0.44, 0.18);
  chassisBase.rotation.x = 0.08;
  chassisBase.castShadow = true;
  group.add(chassisBase);

  const chassisTrim = new THREE.Mesh(
    registerGeo(new THREE.BoxGeometry(2.59, 0.06, 1.76)),
    brushedSteelMat,
  );
  chassisTrim.position.set(0, -0.46, 0.18);
  chassisTrim.rotation.x = 0.08;
  group.add(chassisTrim);

  const deckSurface = new THREE.Mesh(
    registerGeo(new THREE.BoxGeometry(2.15, 0.02, 1.1)),
    deckMat,
  );
  deckSurface.position.set(0, -0.37, 0.08);
  deckSurface.rotation.x = 0.08;
  group.add(deckSurface);

  // Pantalla abierta inclinada en ángulo de estudio
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, -0.38, -0.66);
  lidPivot.rotation.x = -0.24;

  const lidBody = new THREE.Mesh(
    registerGeo(new THREE.BoxGeometry(2.52, 1.54, 0.08)),
    obsidianMat,
  );
  lidBody.position.set(0, 0.77, 0);
  lidBody.castShadow = true;
  lidPivot.add(lidBody);

  const lidTrim = new THREE.Mesh(
    registerGeo(new THREE.BoxGeometry(2.56, 1.58, 0.04)),
    brushedSteelMat,
  );
  lidTrim.position.set(0, 0.77, -0.01);
  lidPivot.add(lidTrim);

  const hingeGlow = new THREE.Mesh(
    registerGeo(new THREE.BoxGeometry(1.38, 0.055, 0.11)),
    royalBevelMat,
  );
  hingeGlow.position.set(0, 0.03, 0.02);
  lidPivot.add(hingeGlow);

  const innerBeacon = new THREE.Mesh(
    registerGeo(new THREE.IcosahedronGeometry(0.24, 0)),
    coreCrystalMat,
  );
  innerBeacon.position.set(0, 0.78, 0.12);
  lidPivot.add(innerBeacon);

  group.add(lidPivot);

  // Anillo orbital azul rey circundando el equipo sin obstruir lectura
  const orbitalShield = new THREE.Mesh(
    registerGeo(new THREE.TorusGeometry(1.94, 0.02, 18, 112)),
    royalBevelMat,
  );
  orbitalShield.position.set(0, 0.16, 0);
  orbitalShield.rotation.x = Math.PI * 0.47;
  orbitalShield.rotation.y = 0.16;
  group.add(orbitalShield);

  return { group, rotatingParts: [innerBeacon, orbitalShield] };
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
  const lastSpinNonceRef = useRef(spinNonce);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  useEffect(() => {
    if (spinNonce !== lastSpinNonceRef.current) {
      lastSpinNonceRef.current = spinNonce;
      spinTargetRef.current += Math.PI * 2;
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
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
    camera.position.set(0, 0.65, 6.2);

    const palette = alert
      ? SURFACE_COLORS.alert
      : healthy
        ? SURFACE_COLORS.clean
        : SURFACE_COLORS.standby;

    const disposables = [];
    const stageGroup = new THREE.Group();
    const { group: artifactGroup, rotatingParts } = buildSurfaceMeshGroup(
      surfaceId,
      palette,
      disposables,
    );
    artifactGroup.rotation.y = -0.34;
    stageGroup.add(artifactGroup);

    // Anillo sutil del pedestal sobre el piso del estudio
    const floorRingGeo = new THREE.RingGeometry(2.15, 2.2, 96);
    const floorRingMat = new THREE.MeshBasicMaterial({
      color: palette.ring,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
    });
    disposables.push(floorRingGeo, floorRingMat);
    const floorRing = new THREE.Mesh(floorRingGeo, floorRingMat);
    floorRing.position.set(0, -1.24, 0);
    floorRing.rotation.x = -Math.PI / 2;
    stageGroup.add(floorRing);

    const shadowPlaneGeo = new THREE.PlaneGeometry(8, 8);
    const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.36 });
    disposables.push(shadowPlaneGeo, shadowPlaneMat);
    const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
    shadowPlane.position.set(0, -1.25, 0);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.receiveShadow = true;
    stageGroup.add(shadowPlane);

    scene.add(stageGroup);

    // Iluminación de estudio: luz cenital fría, relleno suave y borde Azul Rey
    const hemi = new THREE.HemisphereLight(0xe2e8f0, 0x050a14, 0.92);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.75);
    keyLight.position.set(2.8, 4.8, 5.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 16;
    scene.add(keyLight);

    const royalRim = new THREE.DirectionalLight(palette.rim, 2.45);
    royalRim.position.set(-4.6, 1.8, -3.2);
    scene.add(royalRim);

    const fillFront = new THREE.DirectionalLight(0x93c5fd, 1.15);
    fillFront.position.set(0.6, 0.4, 4.8);
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
      camera.position.z = viewport.width < 460 ? 7.2 : 6.2;
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

    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    host.addEventListener('pointerleave', onPointerLeave);

    let rafId = 0;
    let lastTs = performance.now();
    const startTs = lastTs;

    const renderFrame = (now) => {
      const rawDt = (now - lastTs) / 1000;
      const dt = Math.min(Math.max(rawDt, 0.001), 1 / 30);
      lastTs = now;
      const elapsed = (now - startTs) / 1000;

      if (reduceMotion) {
        camera.position.x = -0.35;
        camera.position.y = 0.78;
        camera.lookAt(-0.14, 0.02, 0);
        artifactGroup.rotation.y = -0.34 + dragRotationOffset + spinTargetRef.current;
        renderer.render(scene, camera);
        return;
      }

      const alpha = 1 - Math.pow(1 - 0.055, dt * 60);
      smoothPointer.x += (pointerTarget.x - smoothPointer.x) * alpha;
      smoothPointer.y += (pointerTarget.y - smoothPointer.y) * alpha;
      spinCurrent += (spinTargetRef.current - spinCurrent) * 0.09;

      // Paralaje suave de cámara y objeto separado
      camera.position.x = -smoothPointer.x * 0.42;
      camera.position.y = 0.65 + smoothPointer.y * 0.24;
      camera.lookAt(camera.position.x * 0.42, (camera.position.y - 0.65) * 0.42, 0);

      artifactGroup.rotation.y =
        -0.34 + Math.sin(elapsed * 0.35) * 0.07 + smoothPointer.x * 0.14 + dragRotationOffset + spinCurrent;
      artifactGroup.rotation.x = smoothPointer.y * 0.045;
      artifactGroup.position.y = Math.sin(elapsed * 1.1) * 0.045;

      rotatingParts.forEach((part, idx) => {
        part.rotation.z = elapsed * (idx % 2 === 0 ? 0.35 : -0.22);
      });

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
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      disposables.forEach((item) => item?.dispose?.());
      renderer.dispose();
    };
  }, [surfaceId, healthy, alert]);

  if (webglUnavailable) {
    return (
      <div className="relative w-full h-full flex items-center justify-center">
        <svg
          width="260"
          height="170"
          viewBox="0 0 260 170"
          aria-hidden="true"
          className="drop-shadow-[0_24px_40px_rgba(29,78,216,0.28)]"
        >
          <ellipse cx="130" cy="144" rx="92" ry="14" fill="rgba(37,99,235,0.16)" stroke="rgba(59,130,246,0.4)" />
          <rect x="64" y="34" width="132" height="86" rx="14" fill="#0B1220" stroke="#3B82F6" strokeWidth="1.5" />
          <circle cx="130" cy="77" r="22" fill="rgba(37,99,235,0.16)" stroke={alert ? '#EF4444' : healthy ? '#22C55E' : '#3B82F6'} strokeWidth="2" />
          <circle cx="130" cy="77" r="6" fill={alert ? '#EF4444' : healthy ? '#22C55E' : '#3B82F6'} />
        </svg>
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="relative w-full h-full cursor-grab active:cursor-grabbing select-none"
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}
