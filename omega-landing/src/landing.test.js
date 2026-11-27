import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import {
  DEPLOYMENT_OPTIONS,
  HERO_DISCRETE_CONCEPTS,
  LANDING_FAQ,
  LANDING_PAGES,
  LANDING_PROFILES,
  OMEGA_DEMO_VIDEO,
  PRIVACY_GUARANTEES,
  getPlansForProfile,
} from './data/catalog.js';

const FORBIDDEN_JARGON =
  /\b(RAM|STIX2?|YARA|AppSec|SBOM|CycloneDX|SPDX|SARIF|Ollama|Rust|Tauri|Manifest\.db|ADB|WMI|HTTP|OSINT|SHA-256|SELF_HOSTED|CTI|MVT|YouTube|WebGL|QA|ficticio|borrador en revisión)\b|ventas@omega-sec\.local|:memory:/i;

test('catalog mantiene precios reales en COP, perfiles recortados y cero jerga o texto QA', () => {
  assert.equal(LANDING_PAGES.map((p) => p.id).join(','), 'plataforma,perfiles,seguridad,planes');
  assert.equal(OMEGA_DEMO_VIDEO.src, '/media/omega-demo.mp4');
  assert.equal(HERO_DISCRETE_CONCEPTS.length, 4);
  assert.equal(LANDING_PROFILES.map((p) => p.id).join(','), 'GENERAL,DEVELOPER,LEGAL');
  assert.equal(PRIVACY_GUARANTEES.length, 3);
  assert.equal(DEPLOYMENT_OPTIONS.length, 2);
  assert.equal(LANDING_FAQ.length, 4);

  const monthly = getPlansForProfile('GENERAL', 'monthly');
  assert.equal(monthly[0].displayPrice, '$0');
  assert.equal(monthly[1].displayPrice, '$59.900');
  assert.equal(monthly[2].displayPrice, '$299.900');

  const annual = getPlansForProfile('LEGAL', 'annual');
  assert.equal(annual[1].displayPrice, '$599.000');
  assert.equal(annual[2].displayPrice, '$2.999.000');

  const serialized = JSON.stringify({
    HERO_DISCRETE_CONCEPTS,
    OMEGA_DEMO_VIDEO,
    LANDING_PROFILES,
    PRIVACY_GUARANTEES,
    DEPLOYMENT_OPTIONS,
    LANDING_FAQ,
    monthly,
    annual,
  });
  assert.doesNotMatch(serialized, FORBIDDEN_JARGON);
});

test('OmegaLandingPage renderiza Hero centrado, vistas previas HTML/Tailwind en Perfiles, Privacidad y Planes COP', async () => {
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

    // 1. Hero centrado con video nativo
    const homeText = container.textContent || '';
    assert.match(homeText, /Seguridad real\./);
    assert.match(homeText, /Privacidad absoluta\./);
    assert.ok(container.querySelector('#hero-video video'));
    assert.equal(container.querySelector('iframe'), null);
    assert.doesNotMatch(homeText, FORBIDDEN_JARGON);

    // 2. Vista Perfiles con UI previews nítidas (sin <img> de capturas PNG)
    const perfilesNav = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Perfiles',
    );
    await act(async () => {
      perfilesNav.click();
    });
    const generalText = container.textContent || '';
    assert.match(generalText, /Tres espacios\. Un solo control\./);
    assert.match(generalText, /Protege tus dispositivos sin copiar tus archivos\./);
    assert.match(generalText, /Equipo Local/);
    assert.match(generalText, /iPhone por USB/);
    assert.match(generalText, /Escudo Web/);
    assert.equal(container.querySelector('#profile-panel-GENERAL img'), null);
    assert.doesNotMatch(generalText, FORBIDDEN_JARGON);

    const devTab = Array.from(container.querySelectorAll('button[role="tab"]')).find(
      (btn) => btn.textContent?.includes('Desarrollo'),
    );
    await act(async () => {
      devTab.click();
    });
    const devText = container.textContent || '';
    assert.match(devText, /repositorio-pagos · Rama principal/);
    assert.match(devText, /Librería externa con vulnerabilidad conocida/);
    assert.match(devText, /0 fallos críticos en producción/);
    assert.equal(container.querySelector('#profile-panel-DEVELOPER img'), null);
    assert.doesNotMatch(devText, FORBIDDEN_JARGON);

    const legalTab = Array.from(container.querySelectorAll('button[role="tab"]')).find(
      (btn) => btn.textContent?.includes('Legal'),
    );
    await act(async () => {
      legalTab.click();
    });
    const legalText = container.textContent || '';
    assert.match(legalText, /Expediente #2026-041 · Acceso restringido/);
    assert.match(legalText, /Contrato_Servicios_2026\.pdf · Página 14 · Cláusula 8\.2/);
    assert.equal(container.querySelector('#profile-panel-LEGAL img'), null);
    assert.doesNotMatch(legalText, FORBIDDEN_JARGON);

    // 3. Vista Privacidad
    const segNav = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Privacidad',
    );
    await act(async () => {
      segNav.click();
    });
    assert.match(container.textContent || '', /Tu información nunca sale de tu control/);

    // 4. Vista Planes COP
    const planesNav = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Planes',
    );
    await act(async () => {
      planesNav.click();
    });
    assert.match(container.textContent || '', /\$59\.900/);
    assert.match(container.textContent || '', /\$299\.900/);

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
