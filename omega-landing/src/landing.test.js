import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import {
  DRIVE_PRIVACY_MODES,
  EDITORIAL_SPACES,
  HERO_SPECS,
  LANDING_FAQ,
  LANDING_SECTIONS,
  MANIFESTO_LINES,
  PRIVACY_SPECS,
  PRODUCT_OVERVIEW,
  getPlansForProfile,
} from './data/catalog.js';

const FORBIDDEN_CATALOG_JARGON =
  /\b(RAM|STIX2?|YARA|AppSec|SBOM|CycloneDX|SPDX|SARIF|Ollama|Rust|Tauri|Manifest\.db|ADB|WMI|HTTP|OSINT|SHA-256|SELF_HOSTED|CTI|MVT|YouTube|WebGL|QA|ficticio|borrador en revisión)\b|ventas@omega-sec\.local|:memory:|omega-demo\.mp4/i;

const FORBIDDEN_DOM_JARGON =
  /\b(STIX2?|YARA|AppSec|SBOM|CycloneDX|SPDX|SARIF|Ollama|Rust|Tauri|Manifest\.db|ADB|WMI|HTTP|OSINT|SELF_HOSTED|CTI|MVT|YouTube|WebGL|QA|ficticio|borrador en revisión)\b|ventas@omega-sec\.local|:memory:|omega-demo\.mp4/i;

test('catalog mantiene datos reales en COP, descripción ejecutiva de producto y cero jerga técnica', () => {
  assert.equal(
    LANDING_SECTIONS.map((s) => s.id).join(','),
    'plataforma,producto,espacios,privacidad,planes',
  );
  assert.equal(HERO_SPECS.map((s) => s.value).join(','), '0 B,3,100%');
  assert.equal(PRODUCT_OVERVIEW.pillars.length, 4);
  assert.equal(MANIFESTO_LINES.length, 3);
  assert.equal(EDITORIAL_SPACES.map((p) => p.id).join(','), 'GENERAL,DEVELOPER,LEGAL');
  assert.equal(
    EDITORIAL_SPACES.map((p) => p.image).join(','),
    '/media/space-personal.jpg,/media/space-dev.jpg,/media/space-legal.jpg',
  );
  assert.equal(DRIVE_PRIVACY_MODES.map((m) => m.id).join(','), 'cloud,private');
  assert.equal(PRIVACY_SPECS.map((s) => s.value).join(','), '0 bytes,Sello digital,24/7');
  assert.equal(LANDING_FAQ.length, 4);

  const monthly = getPlansForProfile('GENERAL', 'monthly');
  assert.equal(monthly[0].displayPrice, '$0');
  assert.equal(monthly[1].displayPrice, '$59.900');
  assert.equal(monthly[2].displayPrice, '$299.900');

  const annual = getPlansForProfile('LEGAL', 'annual');
  assert.equal(annual[1].displayPrice, '$599.000');
  assert.equal(annual[2].displayPrice, '$2.999.000');

  const serialized = JSON.stringify({
    HERO_SPECS,
    PRODUCT_OVERVIEW,
    MANIFESTO_LINES,
    EDITORIAL_SPACES,
    DRIVE_PRIVACY_MODES,
    PRIVACY_SPECS,
    LANDING_FAQ,
    monthly,
    annual,
  });
  assert.doesNotMatch(serialized, FORBIDDEN_CATALOG_JARGON);
});

test('OmegaLandingPage renderiza Hero con Ver más, ProductOverview Anti-Slop, SpaceModal visual y Privacidad', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:4175/',
  });
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
    Node: globalThis.Node,
    HTMLElement: globalThis.HTMLElement,
    SVGElement: globalThis.SVGElement,
    KeyboardEvent: globalThis.KeyboardEvent,
    IntersectionObserver: globalThis.IntersectionObserver,
    ResizeObserver: globalThis.ResizeObserver,
    matchMedia: globalThis.matchMedia,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };

  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Element = dom.window.Element;
  globalThis.Node = dom.window.Node;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.SVGElement = dom.window.SVGElement;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.IntersectionObserver = class {
    observe() { }
    unobserve() { }
    disconnect() { }
  };
  globalThis.ResizeObserver = class {
    observe() { }
    unobserve() { }
    disconnect() { }
  };
  globalThis.matchMedia = () => ({
    matches: true,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener() { },
    removeEventListener() { },
    addListener() { },
    removeListener() { },
  });
  dom.window.matchMedia = globalThis.matchMedia;
  dom.window.IntersectionObserver = globalThis.IntersectionObserver;
  dom.window.scrollTo = () => { };

  const scrolledIds = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function () {
    if (this.id) scrolledIds.push(this.id);
  };

  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom',
    logLevel: 'silent',
  });

  try {
    const React = await import('react');
    const { act } = React;
    const { createRoot } = await import('react-dom/client');
    const { MotionConfig } = await import('framer-motion');
    const { OmegaLandingPage } = await vite.ssrLoadModule('/src/components/OmegaLandingPage.jsx');

    const container = dom.window.document.getElementById('root');
    const root = createRoot(container);
    const intents = [];

    await act(async () => {
      root.render(
        React.createElement(
          MotionConfig,
          { reducedMotion: 'always' },
          React.createElement(OmegaLandingPage, {
            onEnterApp: (intent) => intents.push(intent),
          }),
        ),
      );
    });

    const fullText = container.textContent || '';

    // 1. HeroKeynote + botón Ver más hacia #producto
    assert.match(fullText, /OMEGA\./);
    assert.match(fullText, /Control total\. Cero rastro\./);
    assert.ok(container.querySelector('[aria-label="Eclipse OMEGA"]'));
    const verMasBtn = Array.from(container.querySelectorAll('#plataforma button')).find((btn) =>
      btn.textContent?.includes('Ver más'),
    );
    assert.equal(Boolean(verMasBtn), true);
    await act(async () => {
      verMasBtn.click();
    });
    assert.equal(scrolledIds.includes('producto'), true);

    // 2. ProductOverviewSection minimalista con Orbe Ω y tarjetas flotantes (#producto)
    assert.match(container.textContent || '', /Defensa preventiva e inteligencia privada en un solo lugar\./);
    assert.equal((container.textContent || '').includes('AISLAMIENTO EN RAM'), false);
    assert.match(container.textContent || '', /Procesos y cable USB verificados/);
    assert.match(container.textContent || '', /Ver arquitectura completa/);

    // Cambiar pestaña con teclado (ArrowDown)
    const prodTabList = container.querySelector('#producto [role="tablist"]');
    assert.equal(Boolean(prodTabList), true);
    await act(async () => {
      prodTabList.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
    });
    assert.match(container.textContent || '', /Redirecciones analizadas sin riesgo/);

    const legalPillarTab = Array.from(container.querySelectorAll('#producto [role="tab"]')).find(
      (btn) => btn.textContent?.includes('Expedientes legales'),
    );
    assert.equal(Boolean(legalPillarTab), true);
    await act(async () => {
      legalPillarTab.click();
    });
    assert.match(container.textContent || '', /Citas exactas por documento y página/);
    assert.match(container.textContent || '', /Doc\. y página/);

    // 3. SpacesShowcase + SpaceModal visual (+ clic, Esc, clic fuera, salto a Planes)
    const spaceImgs = Array.from(container.querySelectorAll('#espacios article img')).map((el) =>
      el.getAttribute('src'),
    );
    assert.deepEqual(spaceImgs, [
      '/media/space-personal.jpg',
      '/media/space-dev.jpg',
      '/media/space-legal.jpg',
    ]);
    assert.equal(
      Array.from(container.querySelectorAll('#espacios span')).some(
        (el) => el.textContent?.trim() === 'Explorar',
      ),
      false,
    );

    const legalPlusBtn = container.querySelector('button[aria-label="Explorar frente Legal"]');
    assert.equal(Boolean(legalPlusBtn), true);
    await act(async () => {
      legalPlusBtn.click();
    });
    assert.equal(Boolean(container.querySelector('[role="dialog"]')), true);
    assert.equal(
      Boolean(container.querySelector('[role="dialog"] [data-modal-orb="LEGAL"] svg')),
      true,
    );
    assert.match(container.textContent || '', /Expedientes · Contratos · Lectura privada/);
    assert.match(container.textContent || '', /Citas exactas por página/);
    assert.match(container.textContent || '', /Entregable verificado/);
    assert.match(container.textContent || '', /PDF VERIFICADO · SELLO SHA-256/);
    assert.match(container.textContent || '', /Citas exactas por página · 0 retención/);
    const modalButtons = Array.from(container.querySelectorAll('[role="dialog"] button')).map((b) =>
      b.textContent?.trim(),
    );
    assert.equal(modalButtons.includes('Cerrar'), false);

    // Cerrar con botón X
    const closeXBtn = container.querySelector('[role="dialog"] button[aria-label="Cerrar detalle"]');
    assert.equal(Boolean(closeXBtn), true);
    await act(async () => {
      closeXBtn.click();
    });
    assert.equal(Boolean(container.querySelector('[role="dialog"]')), false);

    // Reabrir y cerrar con Escape
    await act(async () => {
      legalPlusBtn.click();
    });
    await act(async () => {
      dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
    });
    assert.equal(Boolean(container.querySelector('[role="dialog"]')), false);

    // Clic fuera
    await act(async () => {
      legalPlusBtn.click();
    });
    const dialogBackdrop = container.querySelector('[role="dialog"]');
    assert.equal(Boolean(dialogBackdrop), true);
    await act(async () => {
      dialogBackdrop.click();
    });
    assert.equal(Boolean(container.querySelector('[role="dialog"]')), false);

    // Salto a Planes desde SpaceModal
    const devPlusBtn = container.querySelector('button[aria-label="Explorar frente Desarrollo"]');
    await act(async () => {
      devPlusBtn.click();
    });
    const planLinkBtn = Array.from(container.querySelectorAll('[role="dialog"] button')).find(
      (btn) => btn.textContent?.includes('Ver plan para este espacio'),
    );
    assert.equal(Boolean(planLinkBtn), true);
    await act(async () => {
      planLinkBtn.click();
    });
    assert.equal(Boolean(container.querySelector('[role="dialog"]')), false);
    assert.match(container.textContent || '', /El espacio Desarrollo requiere plan Pro o Enterprise\./);

    // 4. DriveModePrivacy
    assert.match(container.textContent || '', /Privacidad sin concesiones\./);
    assert.match(container.textContent || '', /Operando en minutos\./);
    const privSection = container.querySelector('#privacidad');
    assert.equal(privSection?.getAttribute('data-drive-mode'), 'cloud');

    const privateTab = Array.from(container.querySelectorAll('#privacidad [role="tab"]')).find(
      (btn) => btn.textContent?.trim() === 'En tu empresa',
    );
    await act(async () => {
      privateTab.click();
    });
    assert.equal(privSection?.getAttribute('data-drive-mode'), 'private');
    assert.match(container.textContent || '', /Ningún dato sale de tu red\./);

    // 5. PricingSection, FinalKeynote y cero referencias prohibidas
    assert.match(container.textContent || '', /Planes simples\./);
    assert.match(container.textContent || '', /Empieza hoy\./);
    assert.equal(container.querySelectorAll('video').length, 0);
    assert.doesNotMatch(container.textContent || '', FORBIDDEN_DOM_JARGON);

    const loginBtn = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Iniciar sesión',
    );
    await act(async () => {
      loginBtn.click();
    });
    assert.deepEqual(intents, ['login']);

    await act(async () => {
      root.unmount();
    });
  } finally {
    await vite.close();
    globalThis.window = saved.window;
    globalThis.document = saved.document;
    globalThis.Element = saved.Element;
    globalThis.Node = saved.Node;
    globalThis.HTMLElement = saved.HTMLElement;
    globalThis.SVGElement = saved.SVGElement;
    globalThis.KeyboardEvent = saved.KeyboardEvent;
    globalThis.IntersectionObserver = saved.IntersectionObserver;
    globalThis.ResizeObserver = saved.ResizeObserver;
    globalThis.matchMedia = saved.matchMedia;
    globalThis.IS_REACT_ACT_ENVIRONMENT = saved.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
  }
});
