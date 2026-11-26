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
  'loginWithPassword', 'registerAccount', 'requestPasswordReset', 'resendMfaEmail', 'verifyMfaLogin',
  'googleAuthConfig', 'pendingGoogleAction', 'startGoogleAuth', 'finishGoogleAuth'];
const api = {};
globalThis.__omegaRecoveryTestApi = api;
const apiUrl = new URL('./__recovery_api_mock__.js', import.meta.url).href;
const stubUrl = new URL('./__recovery_ui_mock__.js', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === componentUrl.href) {
      if (specifier === '../lib/api' || specifier === '../lib/googleAuth') return { url: apiUrl, shortCircuit: true };
      if (specifier === './CommercialDocumentsPanel' || specifier === './DossierExportButtons' || specifier === './OmegaLogo' || specifier === './OmegaBrandMark' || specifier === './SaasFleetCard' || specifier === './BillingPanel') return { url: stubUrl, shortCircuit: true };
      if (specifier.startsWith('../lib/')) return { url: new URL(`${specifier}.js`, componentUrl).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === componentUrl.href) return { format: 'module', source: code, shortCircuit: true };
    if (url === stubUrl) return { format: 'module', source: 'export default () => null; export const OmegaLogo = () => null; export const OmegaBrandMark = () => null; export const SaasFleetCard = () => null; export const BillingPanel = () => null; export const CommercialDocumentsPanel = () => null;', shortCircuit: true };
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
  api.googleAuthConfig = async () => ({ enabled: false, registrationEnabled: false });
  api.pendingGoogleAction = () => null;
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

test('desktop login accurately describes memory-only sessions instead of promising thirty days', async () => {
  dom.window.__TAURI_INTERNALS__ = { invoke: async () => ({}) };
  try {
    await act(async () => root.render(createElement(AuthAccessForm)));
    assert.match(container.textContent, /mientras la app está abierta/);
    assert.doesNotMatch(container.textContent, /30 días/);
  } finally { delete dom.window.__TAURI_INTERNALS__; }
});
async function submit() {
  await act(async () => container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
}

test('registration shows the saved key before publishing the authenticated session', async () => {
  const token = { accessToken: 'token', recoveryKey: 'a'.repeat(48) };
  let registeredProfile;
  api.registerAccount = async ({ profile }) => { registeredProfile = profile; return token; };
  let authenticated = false, saved = false;
  api.saveAuthSession = session => { saved = true; return session; };
  await act(async () => root.render(createElement(AuthAccessForm, { defaultTab: 'register', onAuthenticated: () => { authenticated = true; } })));
  const legalOption = [...container.querySelectorAll('[role="radio"]')].find(button => button.textContent.startsWith('Legal'));
  assert.match(legalOption.textContent, /expedientes y documentos/i);
  assert.match(legalOption.textContent, /Requiere Pro o Enterprise/);
  await act(async () => legalOption.click());
  await input('reg-name', 'Ana Martinez'); await input('reg-email', 'ana@example.org'); await input('reg-password', 'Secure-password-123');
  await submit();
  assert.equal(registeredProfile, 'LEGAL');
  assert.equal(container.querySelector('code').textContent, token.recoveryKey);
  assert.equal(saved, false); assert.equal(authenticated, false);
  await act(async () => container.querySelector('button').click());
  assert.equal(saved, true); assert.equal(authenticated, true);
});

test('Google login with a pending second factor uses the existing MFA form', async () => {
  api.pendingGoogleAction = () => 'LOGIN';
  api.finishGoogleAuth = async () => ({ action: 'LOGIN', session: {
    mfaRequired: true, mfaChallengeToken: 'challenge', mfaMethod: 'EMAIL', maskedEmail: 'd***@gmail.com',
  } });
  let authenticated = false;
  await act(async () => root.render(createElement(AuthAccessForm, { onAuthenticated: () => { authenticated = true; } })));
  assert.match(container.textContent, /d\*\*\*@gmail\.com/);
  assert.equal(authenticated, false);
});

test('the circular Google button has an accessible label and starts login', async () => {
  api.googleAuthConfig = async () => ({ enabled: true });
  let action;
  api.startGoogleAuth = async intent => { action = intent; };
  await act(async () => root.render(createElement(AuthAccessForm)));
  const button = container.querySelector('button[aria-label="Continuar con Google"]');
  assert.ok(button);
  assert.match(container.textContent, /O continúa con/);
  assert.equal(button.querySelector('img').getAttribute('src'), '/google-signin-round.svg');
  assert.equal(button.querySelector('img').getAttribute('alt'), '');
  await act(async () => button.click());
  assert.equal(action, 'LOGIN');
});

test('Desktop offers Google access and routes the return through the existing MFA screen', async () => {
  dom.window.__TAURI_INTERNALS__ = { invoke: async () => ({}) };
  try {
    api.googleAuthConfig = async () => ({ enabled: true, desktopEnabled: true });
    api.startGoogleAuth = async (action, fields, terms, signal) => {
      assert.equal(action, 'LOGIN');
      assert.equal(signal.aborted, false);
      return { action, session: { mfaRequired: true, mfaChallengeToken: 'challenge', mfaMethod: 'EMAIL', maskedEmail: 'a***@gmail.com' } };
    };
    let authenticated = false;
    await act(async () => root.render(createElement(AuthAccessForm, { onAuthenticated: () => { authenticated = true; } })));
    const button = container.querySelector('[aria-label="Continuar con Google"]');
    assert.ok(button);
    await act(async () => button.click());
    assert.match(container.textContent, /a\*\*\*@gmail\.com/);
    assert.equal(authenticated, false);
  } finally { delete dom.window.__TAURI_INTERNALS__; }
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
