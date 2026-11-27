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
  /\b(RAM|STIX2?|YARA|AppSec|SBOM|CycloneDX|SPDX|SARIF|Ollama|Rust|Tauri|Manifest\.db|ADB|WMI|HTTP|OSINT|SHA-256|SELF_HOSTED|CTI|MVT|YouTube|WebGL|borrador en revisión)\b|ventas@omega-sec\.local|:memory:/i;

test('catalog mantiene precios reales en COP, equivalencias humanas y cero jerga técnica', () => {
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
  assert.match(monthly[1].creditsEquivalence, /500 créditos cubren decenas/i);

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

test('OmegaLandingPage renderiza Hero centrado con video protagonista único, perfiles, privacidad y planes COP', async () => {
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

    // 1. Vista Plataforma: Hero centrado de 1 columna + video nativo protagonista + sin doble Ω ni sección demo repetida
    const homeText = container.textContent || '';
    assert.match(homeText, /Seguridad real\./);
    assert.match(homeText, /Privacidad absoluta\./);
    assert.match(homeText, /Protege tus equipos, tu código y tus documentos confidenciales/);
    assert.doesNotMatch(homeText, /Descargar para escritorio/);
    assert.doesNotMatch(homeText, /Así se siente tener el control en una sola pantalla/);

    const heroVideo = container.querySelector('#hero-video video');
    assert.ok(heroVideo);
    assert.equal(heroVideo.getAttribute('src'), '/media/omega-demo.mp4');
    assert.equal(container.querySelector('iframe'), null);
    assert.doesNotMatch(homeText, FORBIDDEN_JARGON);

    // 2. Vista Perfiles (capturas reales limpias)
    const perfilesNav = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Perfiles',
    );
    await act(async () => {
      perfilesNav.click();
    });
    const generalImg = container.querySelector('#profile-panel-GENERAL img');
    assert.ok(generalImg);
    assert.equal(generalImg.getAttribute('src'), '/media/omega-general.png');
    assert.doesNotMatch(container.textContent || '', FORBIDDEN_JARGON);

    const legalTab = Array.from(container.querySelectorAll('button[role="tab"]')).find(
      (btn) => btn.textContent?.includes('Legal'),
    );
    await act(async () => {
      legalTab.click();
    });
    const legalImg = container.querySelector('#profile-panel-LEGAL img');
    assert.ok(legalImg);
    assert.equal(legalImg.getAttribute('src'), '/media/omega-legal.png');
    assert.doesNotMatch(container.textContent || '', FORBIDDEN_JARGON);

    // 3. Vista Privacidad
    const segNav = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Privacidad',
    );
    await act(async () => {
      segNav.click();
    });
    const privacyText = container.textContent || '';
    assert.match(privacyText, /Tu información nunca sale de tu control/);
    assert.match(privacyText, /En la nube de OMEGA/);
    assert.match(privacyText, /Instalado en tu empresa \(Modo Privado\)/);
    assert.doesNotMatch(privacyText, FORBIDDEN_JARGON);

    // 4. Vista Planes + toggle anual + equivalencias
    const planesNav = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Planes',
    );
    await act(async () => {
      planesNav.click();
    });
    const plansText = container.textContent || '';
    assert.match(plansText, /\$59\.900/);
    assert.match(plansText, /\$299\.900/);
    assert.match(plansText, /500 créditos cubren decenas de revisiones/);
    assert.match(plansText, /Mercado Pago/);
    assert.doesNotMatch(plansText, FORBIDDEN_JARGON);

    const annualBtn = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('Anual'),
    );
    await act(async () => {
      annualBtn.click();
    });
    assert.match(container.textContent || '', /\$599\.000/);
    assert.match(container.textContent || '', /\$2\.999\.000/);

    // 5. CTA Iniciar sesión
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
