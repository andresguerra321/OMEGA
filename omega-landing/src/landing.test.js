import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import {
  EDITORIAL_SPACES,
  LANDING_FAQ,
  LANDING_PAGES,
  PRIVACY_BENTO_TOP,
  PRIVACY_DEPLOYMENT_MODES,
  getPlansForProfile,
} from './data/catalog.js';

const FORBIDDEN_JARGON =
  /\b(RAM|STIX2?|YARA|AppSec|SBOM|CycloneDX|SPDX|SARIF|Ollama|Rust|Tauri|Manifest\.db|ADB|WMI|HTTP|OSINT|SHA-256|SELF_HOSTED|CTI|MVT|YouTube|WebGL|QA|ficticio|borrador en revisión)\b|ventas@omega-sec\.local|:memory:/i;

test('catalog mantiene precios reales en COP, galería editorial de 3 frentes y cero jerga o texto QA', () => {
  assert.equal(LANDING_PAGES.map((p) => p.id).join(','), 'plataforma,perfiles,seguridad,planes');
  assert.equal(EDITORIAL_SPACES.map((p) => p.id).join(','), 'GENERAL,DEVELOPER,LEGAL');
  assert.equal(EDITORIAL_SPACES.map((p) => p.image).join(','), '/media/space-personal.jpg,/media/space-dev.jpg,/media/space-legal.jpg');
  assert.equal(PRIVACY_BENTO_TOP.zeroStorage.counterLabel, '0 B guardados');
  assert.equal(PRIVACY_DEPLOYMENT_MODES.map((m) => m.id).join(','), 'cloud,private');
  assert.equal(LANDING_FAQ.length, 4);

  const monthly = getPlansForProfile('GENERAL', 'monthly');
  assert.equal(monthly[0].displayPrice, '$0');
  assert.equal(monthly[1].displayPrice, '$59.900');
  assert.equal(monthly[2].displayPrice, '$299.900');

  const annual = getPlansForProfile('LEGAL', 'annual');
  assert.equal(annual[1].displayPrice, '$599.000');
  assert.equal(annual[2].displayPrice, '$2.999.000');

  const serialized = JSON.stringify({
    EDITORIAL_SPACES,
    PRIVACY_BENTO_TOP,
    PRIVACY_DEPLOYMENT_MODES,
    LANDING_FAQ,
    monthly,
    annual,
  });
  assert.doesNotMatch(serialized, FORBIDDEN_JARGON);
});

test('OmegaLandingPage renderiza Hero espejo del Home y galería editorial de 3 frentes sin pestañas ni adornos', async () => {
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
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.matchMedia = () => ({
    matches: true,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  dom.window.matchMedia = globalThis.matchMedia;
  dom.window.IntersectionObserver = globalThis.IntersectionObserver;
  dom.window.scrollTo = () => {};

  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
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

    // 1. Hero minimalista
    const homeText = container.textContent || '';
    assert.match(homeText, /Control total\. Cero rastro\./);
    assert.ok(container.querySelector('[aria-label="Eclipse OMEGA"]'));
    assert.doesNotMatch(homeText, FORBIDDEN_JARGON);

    // 2. Galería editorial de 3 tarjetas verticales (sin tabs, sin botones dentro, 3 imágenes 4:5 reales)
    const perfilesNav = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Perfiles',
    );
    await act(async () => {
      perfilesNav.click();
    });
    const galleryText = container.textContent || '';
    assert.match(galleryText, /Un solo estándar\. Tres frentes\./);
    assert.match(galleryText, /Dispositivos y enlaces/);
    assert.match(galleryText, /Código y entregas/);
    assert.match(galleryText, /Expedientes privados/);
    assert.equal(container.querySelectorAll('#perfiles [role="tab"]').length, 0);
    assert.equal(container.querySelectorAll('#perfiles article button').length, 0);
    const cardImgs = Array.from(container.querySelectorAll('#perfiles article img')).map((el) =>
      el.getAttribute('src'),
    );
    assert.deepEqual(cardImgs, [
      '/media/space-personal.jpg',
      '/media/space-dev.jpg',
      '/media/space-legal.jpg',
    ]);
    assert.doesNotMatch(galleryText, FORBIDDEN_JARGON);

    // 3. Privacidad
    const segNav = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Privacidad',
    );
    await act(async () => {
      segNav.click();
    });
    assert.match(container.textContent || '', /Cero almacenamiento oculto/);

    // 4. Planes
    const planesNav = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Planes',
    );
    await act(async () => {
      planesNav.click();
    });
    assert.match(container.textContent || '', /Planes simples\./);
    assert.match(container.textContent || '', /\$59\.900/);

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
    globalThis.IntersectionObserver = saved.IntersectionObserver;
    globalThis.ResizeObserver = saved.ResizeObserver;
    globalThis.matchMedia = saved.matchMedia;
    globalThis.IS_REACT_ACT_ENVIRONMENT = saved.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
  }
});
