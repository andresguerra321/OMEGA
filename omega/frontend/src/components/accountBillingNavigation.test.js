import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { after, afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const accountUrl = new URL('./AccountSettingsPanel.jsx', import.meta.url);
const billingUrl = new URL('./BillingPanel.jsx', import.meta.url);
const gateUrl = new URL('./MembershipGate.jsx', import.meta.url);
const transformed = new Map();
for (const url of [accountUrl, billingUrl, gateUrl]) transformed.set(url.href, (await transformWithOxc(await fs.readFile(url, 'utf8'), fileURLToPath(url), { jsx: { runtime: 'automatic' } })).code);
const apiUrl = new URL('./__billing_navigation_api_mock__.js', import.meta.url).href;
const stubUrl = new URL('./__billing_navigation_ui_mock__.js', import.meta.url).href;
const names = ['cancelBillingSubscription', 'classifyAccountType', 'createBillingCheckout', 'fetchBillingHistory', 'fetchBillingPlans', 'fetchBillingSummary', 'fetchCurrentPrincipal', 'refreshBilling', 'restoreCookieAuthSession', 'updateTenantProfile'];
const api = {};
globalThis.__omegaBillingNavigationApi = api;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === accountUrl.href) {
      if (specifier === './BillingPanel') return { url: billingUrl.href, shortCircuit: true };
      if (specifier.startsWith('./') && !specifier.endsWith('.js')) return { url: stubUrl, shortCircuit: true };
    }
    if (context.parentURL === billingUrl.href && specifier === './CommercialDocumentsPanel') return { url: stubUrl, shortCircuit: true };
    if (context.parentURL === gateUrl.href && specifier === './OmegaBrandMark') return { url: stubUrl, shortCircuit: true };
    if ([gateUrl.href, billingUrl.href].includes(context.parentURL) && specifier === '../lib/api.js') return { url: apiUrl, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (transformed.has(url)) return { format: 'module', source: transformed.get(url), shortCircuit: true };
    if (url === apiUrl) return { format: 'module', source: names.map((name) => `export const ${name}=(...args)=>globalThis.__omegaBillingNavigationApi.${name}(...args);`).join('\n'), shortCircuit: true };
    if (url === stubUrl) return { format: 'module', source: 'export default ()=>null; export const OmegaBrandMark=()=>null; export const SettingsPanel=()=>null; export const buildProfileInitials=()=>"AP"; export const RecoveryKeyCard=()=>null; export const SaasFleetCard=()=>null; export const ApiTokensCard=()=>null; export const PilotWorkspaceCard=()=>null; export const ProfessionalReportsPanel=()=>null; export const CommercialBillingPanel=()=>null; export const CommercialDocumentsPanel=()=>null;', shortCircuit: true };
    return next(url, context);
  },
});
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
const globals = new Map();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
  globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AccountSettingsPanel } = await import('./AccountSettingsPanel.jsx');
const { MembershipGate } = await import('./MembershipGate.jsx');
let root, container, profile;
beforeEach(() => {
  for (const name of names) api[name] = async () => ({});
  api.fetchBillingPlans = async () => ({ mode: 'disabled', enforced: true, operations: [], plans: [
    { plan_code: 'PRO', interval: 'MONTHLY', name: 'Pro', price: 59900, credits: 500, max_users: 1, max_devices: 5 },
    { plan_code: 'ENTERPRISE', interval: 'MONTHLY', name: 'Enterprise', price: 299900, credits: 3000, max_users: 5, max_devices: 25 },
  ] });
  api.fetchBillingSummary = async () => ({ accountType: 'INDIVIDUAL', workspaceAccess: profile === 'GENERAL', profile, planCode: 'FREE', balance: 30, reserved: 0, canManage: true, checkouts: [], buckets: [], movements: [] });
  api.fetchBillingHistory = async () => [];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
after(() => {
  hooks.deregister(); dom.window.close(); delete globalThis.__omegaBillingNavigationApi;
  for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
});

for (const selectedProfile of ['GENERAL', 'DEVELOPER', 'LEGAL']) test(`${selectedProfile}: an individual account can open real pricing from the account menu`, async () => {
  profile = selectedProfile;
  await act(async () => root.render(createElement(AccountSettingsPanel, {
    authSession: { tenantId: 'account-test', email: 'ana@example.org', profile, role: 'ANALYST', accountType: 'INDIVIDUAL', canManageAccount: true },
    profileConfig: { profile }, onSwitchProfile: async () => {},
  })));
  const entry = [...container.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Mi plan y créditos');
  assert.ok([...container.querySelectorAll('button')].some(button => button.textContent.trim() === 'Informes'));
  assert.ok([...container.querySelectorAll('button')].some(button => button.textContent.trim() === 'Documentos y facturación'));
  assert.ok(entry, 'Pricing must be reachable from the actual account sidebar');
  await act(async () => { entry.click(); });
  assert.equal(container.querySelector('#billing-title')?.textContent.trim(), 'Mi plan y créditos');
  assert.match(container.textContent, /59\.900/);
  assert.match(container.textContent, /299\.900/);
  assert.match(container.textContent, /Los pagos aún no están disponibles/);
  assert.equal(container.querySelectorAll('[role="radio"]').length, 2);
});

for (const accountType of ['INDIVIDUAL', 'ORGANIZATION']) {
  for (const selectedProfile of ['GENERAL', 'DEVELOPER', 'LEGAL']) {
    test(`membership gate: ${accountType} ${selectedProfile} only enters with eligible access`, async () => {
      profile = selectedProfile;
      let paid = false;
      api.fetchBillingSummary = async () => ({ accountType, profile, planCode: paid ? 'PRO' : 'FREE',
        workspaceAccess: paid || (accountType === 'INDIVIDUAL' && profile === 'GENERAL'), canManage: true, balance: 30 });
      await act(async () => root.render(createElement(MembershipGate, {
        authSession: { tenantId: 'membership-test', userId: 'owner', accountType, profile },
      }, createElement('div', { id: 'private-module' }, 'Workspace'))));
      const free = accountType === 'INDIVIDUAL' && profile === 'GENERAL';
      assert.equal(Boolean(container.querySelector('#private-module')), free);
      if (!free) {
        assert.match(container.textContent, /Elige tu membresía/);
        assert.match(container.textContent, /Sin membresía activa/);
        assert.equal(container.textContent.includes('Continuar con General gratis'), accountType === 'INDIVIDUAL');
        paid = true;
        await act(async () => window.dispatchEvent(new Event('omega:billing-updated')));
        assert.ok(container.querySelector('#private-module'), 'Verified membership opens the selected workspace');
      }
      paid = false;
      await act(async () => window.dispatchEvent(new Event('omega:billing-updated')));
      assert.equal(Boolean(container.querySelector('#private-module')), free, 'Expired membership locks paid workspaces again');
    });
  }
}

test('membership lookup failure never exposes private modules', async () => {
  api.fetchBillingSummary = async () => { throw new Error('Sin conexión'); };
  await act(async () => root.render(createElement(MembershipGate, {
    authSession: { tenantId: 'offline-test', userId: 'owner' },
  }, createElement('div', { id: 'private-module' }, 'Workspace'))));
  assert.equal(container.querySelector('#private-module'), null);
  assert.match(container.querySelector('[role=alert]').textContent, /Sin conexión/);
});
