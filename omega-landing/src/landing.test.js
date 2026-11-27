import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import {
  LANDING_FAQ,
  LANDING_PAGES,
  LANDING_PROFILES,
  PRIVACY_BENTO_TOP,
  PRIVACY_DEPLOYMENT_MODES,
  getPlansForProfile,
} from './data/catalog.js';

const FORBIDDEN_JARGON =
  /\b(RAM|STIX2?|YARA|AppSec|SBOM|CycloneDX|SPDX|SARIF|Ollama|Rust|Tauri|Manifest\.db|ADB|WMI|HTTP|OSINT|SHA-256|SELF_HOSTED|CTI|MVT|YouTube|WebGL|QA|ficticio|borrador en revisión)\b|ventas@omega-sec\.local|:memory:/i;

test('catalog mantiene precios reales en COP, datos Bento de Privacidad y cero jerga o texto QA', () => {
  assert.equal(LANDING_PAGES.map((p) => p.id).join(','), 'plataforma,perfiles,seguridad,planes');
  assert.equal(LANDING_PROFILES.map((p) => p.id).join(','), 'GENERAL,DEVELOPER,LEGAL');
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
    LANDING_PROFILES,
    PRIVACY_BENTO_TOP,
    PRIVACY_DEPLOYMENT_MODES,
    LANDING_FAQ,
    monthly,
    annual,
  });
  assert.doesNotMatch(serialized, FORBIDDEN_JARGON);
});

test('OmegaLandingPage cumple fases 1-5: Hero sin video, Perfiles SpecularCard, Bento anti-anidamiento y Planes', async () => {
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

    // Fase 2: Hero sin <video>, sin <iframe>, con Orbe + 3 capas flotantes + banda monumental
    const homeText = container.textContent || '';
    assert.match(homeText, /Control total antes de tu próximo paso\./);
    assert.ok(container.querySelector('[aria-label="Orbe de Cristal Obsidiana de OMEGA"]'));
    assert.equal(container.querySelector('video'), null);
    assert.equal(container.querySelector('iframe'), null);
    assert.doesNotMatch(homeText, FORBIDDEN_JARGON);

    // Fase 3: Perfiles
    const perfilesNav = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Perfiles',
    );
    await act(async () => {
      perfilesNav.click();
    });
    assert.match(container.textContent || '', /Tres espacios\. Un solo control\./);
    assert.match(container.textContent || '', /Revisión silenciosa de tu computador/);

    // Fase 4: Privacidad (0 datos salientes aparece SOLO una vez en modo privado)
    const segNav = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Privacidad',
    );
    await act(async () => {
      segNav.click();
    });
    const privateTab = Array.from(container.querySelectorAll('button[role="tab"]')).find(
      (btn) => btn.textContent?.includes('Instalado en tu empresa'),
    );
    await act(async () => {
      privateTab.click();
    });
    const privateText = container.textContent || '';
    assert.equal((privateText.match(/0 datos salientes/g) || []).length, 1);
    assert.match(privateText, /Internet externo bloqueado/);
    assert.doesNotMatch(privateText, FORBIDDEN_JARGON);

    // Fase 5: Planes
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
