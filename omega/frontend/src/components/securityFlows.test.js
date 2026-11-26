import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { after, afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

// Exercise the actual JSX with the project's compiler and React, mocking only the API boundary.
const names = ['getAuthSession', 'prepareDesktopHostSensor', 'containmentChallenge', 'containmentHistory', 'executeContainment',
  'previewContainment', 'rollbackContainment', 'getHostRealtimeStatus', 'toggleHostRealtime',
  'auditHostPersistence', 'fetchMobileUsbDevices', 'startMobileUsbAudit', 'fetchMobileUsbAuditJob'];
const api = {};
globalThis.__omegaSecurityTestApi = api;
const sources = new Map();
for (const name of ['ContainmentPanel', 'HostProtectionPanel', 'MobileUsbAuditCard']) {
  const url = new URL(`./${name}.jsx`, import.meta.url);
  sources.set(url.href, (await transformWithOxc(await fs.readFile(url, 'utf8'), fileURLToPath(url), { jsx: { runtime: 'automatic' } })).code);
}
const apiUrl = new URL('./__security_api_mock__.js', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (sources.has(context.parentURL) && specifier === '../lib/api') return { url: apiUrl, shortCircuit: true };
    if (sources.has(context.parentURL) && specifier === '../lib/containment') return { url: new URL('../lib/containment.js', import.meta.url).href, shortCircuit: true };
    if (sources.has(context.parentURL) && specifier === './ContainmentPanel') return { url: new URL('./ContainmentPanel.jsx', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (sources.has(url)) return { format: 'module', source: sources.get(url), shortCircuit: true };
    if (url === apiUrl) return { format: 'module', source: names.map(name =>
      `export const ${name} = (...args) => globalThis.__omegaSecurityTestApi.${name}(...args);`).join('\n'), shortCircuit: true };
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
const { ContainmentPanel } = await import('./ContainmentPanel.jsx');
const { HostProtectionPanel } = await import('./HostProtectionPanel.jsx');
const { MobileUsbAuditCard } = await import('./MobileUsbAuditCard.jsx');
let root, container;
const candidate = { actionType: 'BLOCK_NETWORK_INDICATOR', target: { indicator: '8.8.4.4' } };
const nativeStatus = { scope: 'native-host', enabled: true, active: true, alerts: [], hostname: 'test-host' };

beforeEach(() => {
  for (const name of names) api[name] = () => { throw new Error(`Unexpected API call: ${name}`); };
  api.getAuthSession = () => ({ role: 'ADMIN' });
  api.prepareDesktopHostSensor = async () => ({ ready: true });
  api.containmentHistory = async () => ({ actions: [] });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
after(() => {
  hooks.deregister();
  dom.window.close();
  delete globalThis.__omegaSecurityTestApi;
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});
async function render(component, props) { await act(async () => root.render(createElement(component, props))); }
function button(text) { return [...document.querySelectorAll('button')].find(node => node.textContent.includes(text)); }
async function click(node) { assert.ok(node, 'Expected button'); await act(async () => node.click()); }
async function settle(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  }
  assert.ok(predicate(), 'UI did not reach the expected state');
}
async function input(node, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
}

test('host protection hides machine-wide data from non-administrators without calling the sensor', async () => {
  await render(HostProtectionPanel, { session: { role: 'ANALYST', tenantId: 'other' }, expanded: true });
  assert.equal(container.textContent, '');
});

test('container scope disables host surveillance and persistence audit', async () => {
  api.getHostRealtimeStatus = async () => ({ ...nativeStatus, scope: 'container' });
  await render(HostProtectionPanel, { session: { role: 'ADMIN', tenantId: 'owner' }, expanded: true });
  assert.equal(button('Pausar vigilancia').disabled, true);
  assert.equal(button('Revisar procesos').disabled, true);
  assert.match(container.textContent, /Abre la aplicación de escritorio para vigilar esta computadora/);
});

test('an unavailable sensor is displayed without claiming preparation or protection succeeded', async () => {
  api.prepareDesktopHostSensor = async () => ({ ready: false, status: {
    scope: 'container', active: false, enabled: false, alerts: [], notice: 'Sensor nativo no conectado',
  } });
  await render(HostProtectionPanel, { session: { role: 'ADMIN', tenantId: 'owner', email: 'owner@example.org' } });
  await settle(() => container.textContent.includes('Sensor nativo no conectado'));
  assert.equal(button('Activar vigilancia').disabled, true);
  assert.equal(container.querySelector('[role="alert"]'), null);
  assert.equal(container.textContent.includes('Vigilancia activa'), false);
});

test('sensor failure removes host actions and exposes the actual error', async () => {
  api.getHostRealtimeStatus = async () => { throw new Error('Sensor identity rejected'); };
  await render(HostProtectionPanel, { session: { role: 'ADMIN', tenantId: 'owner' }, expanded: true });
  assert.match(container.textContent, /Sensor identity rejected/);
  assert.equal(button('Activar vigilancia').disabled, true);
});

test('desktop preparation failure offers an application retry without repeatedly requesting Windows consent', async () => {
  let attempts = 0;
  api.prepareDesktopHostSensor = async () => { if (++attempts === 1) throw new Error('Windows no autorizó la preparación'); return { ready: true }; };
  api.getHostRealtimeStatus = async () => nativeStatus;
  await render(HostProtectionPanel, { session: { role: 'ADMIN', tenantId: 'owner' }, expanded: true });
  assert.match(container.textContent, /Windows no autorizó/);
  assert.equal(attempts, 1);
  await click(button('Reintentar preparación'));
  assert.equal(attempts, 2);
  assert.match(container.textContent, /Vigilancia activa/);
  assert.equal(button('Pausar vigilancia').disabled, false);
});

test('containment preview and cancel never execute the action', async () => {
  let previews = 0;
  api.previewContainment = async () => { previews++; return { impact: 'Block this IP', executionEnabled: true, previewToken: 'preview' }; };
  await render(ContainmentPanel, { enabled: true, candidates: [candidate] });
  await click(button('Aislar y bloquear'));
  assert.equal(previews, 1);
  assert.ok(document.querySelector('[role="dialog"]'));
  await submit(); // Even a synthetic submit without a password must not execute.
  await click(button('Cancelar'));
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test('containment requires the password challenge and MFA before executing the exact preview', async () => {
  const calls = [];
  api.previewContainment = async () => ({ impact: 'Block this IP', executionEnabled: true, previewToken: 'bound-preview' });
  api.containmentChallenge = async password => { calls.push(['challenge', password]); return { mfaRequired: true, challengeToken: 'bound-challenge', method: 'TOTP' }; };
  api.executeContainment = async (...args) => { calls.push(['execute', ...args]); return { status: 'ACTIVE' }; };
  await render(ContainmentPanel, { enabled: true, candidates: [candidate] });
  await click(button('Aislar y bloquear'));
  await input(document.querySelector('input[type="password"]'), 'current-password');
  await submit();
  assert.equal(calls.length, 1);
  await input(document.querySelector('input[autocomplete="one-time-code"]'), '123456');
  await submit();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].slice(0, 3), ['execute', { ...candidate, expedienteId: null }, 'bound-preview']);
  assert.equal(calls[1][3].challengeToken, 'bound-challenge');
  assert.equal(calls[1][3].code, '123456');
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.querySelector('input[type="password"]'), null);
});

test('a late preview cannot reopen a panel after its host context is disabled', async () => {
  let resolve;
  api.previewContainment = () => new Promise(done => { resolve = done; });
  await render(ContainmentPanel, { enabled: true, candidates: [candidate] });
  await click(button('Aislar y bloquear'));
  await render(ContainmentPanel, { enabled: false });
  await act(async () => resolve({ executionEnabled: true }));
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test('USB analysis cannot start before the phone is authorized', async () => {
  api.fetchMobileUsbDevices = async () => ({ devices: [{ id: 'phone', platform: 'IOS', authorized: false, deviceName: 'Test phone' }] });
  await render(MobileUsbAuditCard);
  await settle(() => button('Iniciar análisis'));
  assert.equal(button('Iniciar análisis').disabled, true);
  await click(button('Iniciar análisis'));
});

test('USB analysis erases the backup password after failure and allows a retry', async () => {
  api.fetchMobileUsbDevices = async () => ({ devices: [{ id: 'phone', platform: 'IOS', authorized: true, deviceName: 'Test phone' }] });
  let request;
  api.startMobileUsbAudit = async payload => { request = payload; throw new Error('Backup decryption rejected'); };
  await render(MobileUsbAuditCard);
  await settle(() => document.querySelector('input[type="password"]'));
  await input(document.querySelector('input[type="password"]'), 'backup-secret');
  await click(button('Iniciar análisis'));
  assert.equal(request.backupPassword, 'backup-secret');
  assert.equal(document.querySelector('input[type="password"]').value, '');
  assert.equal(button('Iniciar análisis').disabled, false);
  assert.match(container.textContent, /Backup decryption rejected/);
});
