import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { after, afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const sources = new Map();
for (const name of ['DesktopStartupGate', 'OmegaLoader']) {
  const url = new URL(`./${name}.jsx`, import.meta.url);
  sources.set(url.href, (await transformWithOxc(await fs.readFile(url, 'utf8'), fileURLToPath(url), { jsx: { runtime: 'automatic' } })).code);
}
const bootstrapUrl = new URL('../lib/useDesktopBootstrap.js', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (sources.has(context.parentURL) && specifier.startsWith('.')) {
      const extension = specifier === './OmegaLoader' ? '.jsx' : '.js';
      return { url: new URL(specifier + extension, context.parentURL).href, shortCircuit: true };
    }
    if (context.parentURL === bootstrapUrl && specifier === './desktopBridge') {
      return { url: new URL('../lib/desktopBridge.js', import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (sources.has(url)) return { format: 'module', source: sources.get(url), shortCircuit: true };
    return next(url, context);
  },
});
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://omega.test', pretendToBeVisual: true });
const previous = new Map();
for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
  Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement,
  Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
// Exercise the actual UI and native-status hook; drawing is covered by the browser preview.
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { DesktopStartupGate } = await import('./DesktopStartupGate.jsx');
const { useDesktopBootstrap } = await import('../lib/useDesktopBootstrap.js');
function Application({ intervalMs = 10 }) {
  const bootstrap = useDesktopBootstrap({ intervalMs });
  return createElement(DesktopStartupGate, { bootstrap }, createElement('input', { 'aria-label': 'Correo para iniciar sesión' }));
}
let root, container;
beforeEach(() => {
  delete window.__TAURI_INTERNALS__;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
after(() => {
  hooks.deregister(); dom.window.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
});
const login = () => container.querySelector('input');
async function waitFor(condition) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (condition()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  assert.fail('Startup did not reach the expected state');
}

test('desktop hides login before the first native response and throughout service startup', async () => {
  let firstResponse;
  let state = 'starting';
  let calls = 0;
  window.__TAURI_INTERNALS__ = { invoke: async () => {
    if (calls++ === 0) return new Promise(resolve => { firstResponse = resolve; });
    return { state };
  } };
  await act(async () => root.render(createElement(Application)));
  assert.equal(login(), null);
  assert.ok(container.querySelector('canvas'));
  await act(async () => firstResponse({ state: 'checking' }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(login(), null);
  state = 'ready';
  await waitFor(login);
  assert.equal(container.querySelector('canvas'), null);
});

test('startup errors keep login hidden and retry returns to the loading screen', async () => {
  let state = 'error';
  let failRetry = true;
  window.__TAURI_INTERNALS__ = { invoke: async command => {
    if (command === 'retry_self_hosted_bootstrap') {
      if (failRetry) throw new Error('IPC unavailable');
      state = 'starting';
    }
    return { state, message: 'Abre Docker Desktop y vuelve a intentarlo.' };
  } };
  await act(async () => root.render(createElement(Application, { intervalMs: 100 })));
  await waitFor(() => container.querySelector('[role="alert"]'));
  assert.equal(login(), null);
  await act(async () => container.querySelector('button').click());
  assert.match(container.textContent, /No se pudo reiniciar/);
  failRetry = false;
  await act(async () => container.querySelector('button').click());
  assert.ok(container.querySelector('canvas'));
  assert.equal(login(), null);
  state = 'ready';
  await waitFor(login);
});

test('a failed native-status query provides retry instead of exposing login', async () => {
  window.__TAURI_INTERNALS__ = { invoke: async () => { throw new Error('IPC unavailable'); } };
  await act(async () => root.render(createElement(Application)));
  await waitFor(() => container.querySelector('[role="alert"]'));
  assert.equal(login(), null);
  assert.ok(container.querySelector('button'));
});

test('web deployments keep their normal login without waiting for Docker IPC', async () => {
  await act(async () => root.render(createElement(Application)));
  assert.ok(login());
  assert.equal(container.querySelector('canvas'), null);
});
