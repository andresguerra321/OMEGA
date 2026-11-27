import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import {
  LANDING_FAQ,
  LANDING_METRICS,
  LANDING_PAGES,
  LANDING_PROFILES,
  OMEGA_DEMO_VIDEO,
  OPERATIONAL_GUARANTEES,
  getPlansForProfile,
} from './data/catalog.js';

test('catalog mantiene rutas, demo de YouTube, precios reales en COP y límites de OMEGA', () => {
  assert.equal(LANDING_PAGES.map((p) => p.id).join(','), 'plataforma,demo,perfiles,seguridad,planes');
  assert.equal(OMEGA_DEMO_VIDEO.youtubeId, 'h8RutTVyJzY');
  assert.equal(OMEGA_DEMO_VIDEO.watchUrl, 'https://youtu.be/h8RutTVyJzY');
  assert.equal(LANDING_METRICS.length, 4);
  assert.equal(LANDING_PROFILES.map((p) => p.id).join(','), 'GENERAL,DEVELOPER,LEGAL');
  assert.equal(OPERATIONAL_GUARANTEES.length, 3);
  assert.equal(LANDING_FAQ.length, 4);

  const monthly = getPlansForProfile('GENERAL', 'monthly');
  assert.equal(monthly[0].displayPrice, '$0');
  assert.equal(monthly[1].displayPrice, '$59.900');
  assert.equal(monthly[2].displayPrice, '$299.900');

  const annual = getPlansForProfile('LEGAL', 'annual');
  assert.equal(annual[1].displayPrice, '$599.000');
  assert.equal(annual[2].displayPrice, '$2.999.000');
});

test('OmegaLandingPage navega entre vistas separadas, monta orbe 3D, demo YouTube y planes COP', async () => {
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

    // 1. Vista Plataforma (Hero + Orbe 3D + 4 métricas; NO mezcla planes en la misma vista)
    const homeText = container.textContent || '';
    assert.match(homeText, /OMEGA v2\.2/);
    assert.match(homeText, /0 B en disco/);
    assert.match(homeText, /WebGL 3D interactivo/);
    assert.doesNotMatch(homeText, /\$599\.000/);
    assert.doesNotMatch(homeText, /borrador en revisión/i);
    assert.doesNotMatch(homeText, /ventas@omega-sec\.local/i);

    // 2. Vista Demostración (YouTube h8RutTVyJzY)
    const demoNav = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Demostración',
    );
    await act(async () => {
      demoNav.click();
    });
    assert.match(container.textContent || '', /youtu\.be\/h8RutTVyJzY/);

    const playDemoBtn = container.querySelector('button[aria-label="Reproducir demostración oficial de OMEGA"]');
    await act(async () => {
      playDemoBtn.click();
    });
    const iframe = container.querySelector('iframe');
    assert.ok(iframe);
    assert.match(iframe.getAttribute('src') || '', /youtube-nocookie\.com\/embed\/h8RutTVyJzY/);

    // 3. Vista Perfiles (tabs General / Desarrollo / Legal)
    const perfilesNav = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Perfiles',
    );
    await act(async () => {
      perfilesNav.click();
    });
    assert.match(container.textContent || '', /Manifest\.db en :memory:/);

    const legalTab = Array.from(container.querySelectorAll('button[role="tab"]')).find(
      (btn) => btn.textContent?.includes('Legal'),
    );
    await act(async () => {
      legalTab.click();
    });
    assert.match(container.textContent || '', /LEGAL_ABSTENTION/);

    // 4. Vista Seguridad
    const segNav = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Seguridad',
    );
    await act(async () => {
      segNav.click();
    });
    assert.match(container.textContent || '', /Modo Soberano \(SELF_HOSTED\)/);

    // 5. Vista Planes + toggle anual
    const planesNav = Array.from(container.querySelectorAll('header nav button')).find(
      (btn) => btn.textContent?.trim() === 'Planes',
    );
    await act(async () => {
      planesNav.click();
    });
    assert.match(container.textContent || '', /\$59\.900/);
    assert.match(container.textContent || '', /\$299\.900/);

    const annualBtn = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('Anual'),
    );
    await act(async () => {
      annualBtn.click();
    });
    assert.match(container.textContent || '', /\$599\.000/);
    assert.match(container.textContent || '', /\$2\.999\.000/);

    // 6. CTA Iniciar sesión
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
