import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { after, afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const componentUrl = new URL('./AuthModulePanel.jsx', import.meta.url);
const code = (await transformWithOxc(await fs.readFile(componentUrl, 'utf8'), fileURLToPath(componentUrl), { jsx: { runtime: 'automatic' } })).code;
const names = ['confirmPasswordReset', 'saveAuthSession', 'getAuthConfig',
  'loginWithPassword', 'registerAccount', 'requestPasswordReset', 'resendMfaEmail', 'verifyMfaLogin'];
const api = {};
globalThis.__omegaRecoveryTestApi = api;
const apiUrl = new URL('./__recovery_api_mock__.js', import.meta.url).href;
const stubUrl = new URL('./__recovery_ui_mock__.js', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === componentUrl.href) {
      if (specifier === '../lib/api') return { url: apiUrl, shortCircuit: true };
      if (specifier === './DossierExportButtons' || specifier === './OmegaLogo' || specifier === './OmegaBrandMark' || specifier === './SaasFleetCard') return { url: stubUrl, shortCircuit: true };
      if (specifier.startsWith('../lib/')) return { url: new URL(`${specifier}.js`, componentUrl).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === componentUrl.href) return { format: 'module', source: code, shortCircuit: true };
    if (url === stubUrl) return { format: 'module', source: 'export default () => null; export const OmegaLogo = () => null; export const OmegaBrandMark = () => null; export const SaasFleetCard = () => null;', shortCircuit: true };
    if (url === apiUrl) return { format: 'module', source: names.map(name =>
      `export const ${name} = (...args) => globalThis.__omegaRecoveryTestApi.${name}(...args);`).join('\n'), shortCircuit: true };
    return next(url, context);
  },
});
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://omega.test' });
const previous = new Map();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AuthAccessForm, AuthModulePanel } = await import('./AuthModulePanel.jsx');
let root, container;
beforeEach(() => {
  for (const name of names) api[name] = () => { throw new Error(`Unexpected API: ${name}`); };
  api.getAuthConfig = async () => ({ tenantSelfRegistrationEnabled: true, smtpConfigured: false });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
after(() => {
  hooks.deregister(); dom.window.close(); delete globalThis.__omegaRecoveryTestApi;
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
});
async function input(suffix, value) {
  const element = container.querySelector(`input[id$="${suffix}"]`);
  assert.ok(element, suffix);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
}

test('registration shows the saved key before publishing the authenticated session', async () => {
  const token = { accessToken: 'token', recoveryKey: 'a'.repeat(48) };
  api.registerAccount = async () => token;
  let authenticated = false, saved = false;
  api.saveAuthSession = session => { saved = true; return session; };
  await act(async () => root.render(createElement(AuthAccessForm, { defaultTab: 'register', onAuthenticated: () => { authenticated = true; } })));
  await input('reg-name', 'Ana Martinez'); await input('reg-email', 'ana@example.org'); await input('reg-password', 'Secure-password-123');
  await submit();
  assert.equal(container.querySelector('code').textContent, token.recoveryKey);
  assert.equal(saved, false); assert.equal(authenticated, false);
  await act(async () => container.querySelector('button').click());
  assert.equal(saved, true); assert.equal(authenticated, true);
});

test('recovery without SMTP asks for a saved key and never directs the user to Docker logs', async () => {
  api.requestPasswordReset = async () => ({ ok: true, deliveryMode: 'recovery_key', message: 'Usa tu clave guardada.' });
  await act(async () => root.render(createElement(AuthAccessForm, { activeTab: 'recover' })));
  await input('recover-email', 'ana@example.org'); await submit();
  const keyInput = container.querySelector('input[maxlength="48"]');
  assert.ok(keyInput); assert.equal(container.textContent.includes('docker logs'), false);
  assert.equal(container.textContent.includes('omega_backend_java'), false);
});

test('the login gate offers no accountless entry even when an older backend advertises it', async () => {
  api.getAuthConfig = async () => ({ tenantSelfRegistrationEnabled: true, localAccessEnabled: true, smtpConfigured: false });
  await act(async () => root.render(createElement(AuthModulePanel, { gateMode: true, apiOnline: true, localAccessEnabled: true })));
  assert.equal(container.textContent.includes('Entrar sin cuenta'), false);
  assert.equal(container.textContent.includes('Espacio local'), false);
  assert.ok(container.querySelector('input[type="password"]'));
});
