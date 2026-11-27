import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import {
  LANDING_METRICS,
  LANDING_PROFILES,
  TRUST_PILLARS,
  getPlansForProfile,
} from '../lib/landingCatalog.js';

test('landingCatalog mantiene precios, créditos y límites reales de docs/billing-mercadopago.md', () => {
  assert.equal(LANDING_METRICS.length, 4);
  assert.equal(LANDING_PROFILES.map((p) => p.id).join(','), 'GENERAL,DEVELOPER,LEGAL');
  assert.equal(TRUST_PILLARS.length, 3);

  const monthly = getPlansForProfile('GENERAL', 'monthly');
  assert.equal(monthly.length, 3);
  assert.equal(monthly[0].displayPrice, '$0');
  assert.equal(monthly[1].priceMonthly, 59900);
  assert.equal(monthly[1].displayPrice, '$59.900');
  assert.equal(monthly[2].priceMonthly, 299900);
  assert.equal(monthly[2].displayPrice, '$299.900');

  const annual = getPlansForProfile('LEGAL', 'annual');
  assert.equal(annual[1].priceAnnual, 599000);
  assert.equal(annual[1].displayPrice, '$599.000');
  assert.equal(annual[2].priceAnnual, 2999000);
  assert.equal(annual[2].displayPrice, '$2.999.000');
});

test('OmegaLandingPage renderiza secciones clave, alterna perfiles/ciclo anual y navega a la app', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'file:///omega-landing.html',
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

    const initialText = container.textContent || '';
    assert.match(initialText, /OMEGA v2\.2/);
    assert.match(initialText, /0 B en disco/);
    assert.match(initialText, /STIX2 & YARA/);
    assert.match(initialText, /Modo Soberano/);
    assert.match(initialText, /App Nativa/);
    assert.match(initialText, /Una sola plataforma\. Tres espacios de trabajo especializados\./);
    assert.match(initialText, /\$59\.900/);
    assert.match(initialText, /\$299\.900/);
    assert.doesNotMatch(initialText, /borrador en revisión/i);

    // Cambiar pestaña de perfil a Legal
    const legalTab = Array.from(container.querySelectorAll('button[role="tab"]')).find(
      (btn) => btn.textContent?.includes('Legal'),
    );
    assert.ok(legalTab, 'Debe existir la pestaña Legal');
    await act(async () => {
      legalTab.click();
      await new Promise((r) => setTimeout(r, 400));
    });
    assert.equal(legalTab.getAttribute('aria-selected'), 'true');
    assert.match(container.textContent || '', /Expedientes confidenciales con revisión documental citada/);

    // Cambiar toggle a Anual
    const annualBtn = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('Anual'),
    );
    assert.ok(annualBtn, 'Debe existir el botón de facturación Anual');
    await act(async () => {
      annualBtn.click();
    });
    assert.match(container.textContent || '', /\$599\.000/);
    assert.match(container.textContent || '', /\$2\.999\.000/);

    // Botón Iniciar sesión invoca onEnterApp('login')
    const loginBtn = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent?.trim() === 'Iniciar sesión',
    );
    assert.ok(loginBtn);
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
