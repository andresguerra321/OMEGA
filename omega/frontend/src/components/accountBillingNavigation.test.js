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
const googleUrl = new URL('./GoogleAccountLink.jsx', import.meta.url);
const transformed = new Map();
for (const url of [accountUrl, billingUrl, gateUrl, googleUrl]) transformed.set(url.href, (await transformWithOxc(await fs.readFile(url, 'utf8'), fileURLToPath(url), { jsx: { runtime: 'automatic' } })).code);
const apiUrl = new URL('./__billing_navigation_api_mock__.js', import.meta.url).href;
const stubUrl = new URL('./__billing_navigation_ui_mock__.js', import.meta.url).href;
const googleApiUrl = new URL('./__billing_navigation_google_mock__.js', import.meta.url).href;
const googleNames = ['finishGoogleAuth', 'googleConnection', 'pendingGoogleAction', 'startGoogleAuth'];
const names = ['cancelBillingSubscription', 'classifyAccountType', 'createBillingCheckout', 'fetchBillingHistory', 'fetchBillingPlans', 'fetchBillingSummary', 'fetchCurrentPrincipal', 'refreshBilling', 'restoreCookieAuthSession', 'updateTenantProfile'];
const api = {};
globalThis.__omegaBillingNavigationApi = api;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if ([accountUrl.href, gateUrl.href].includes(context.parentURL) && specifier === './GoogleAccountLink') return { url: googleUrl.href, shortCircuit: true };
    if (context.parentURL === googleUrl.href && specifier === '../lib/googleAuth.js') return { url: googleApiUrl, shortCircuit: true };
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
    if (url === googleApiUrl) return { format: 'module', source: googleNames.map((name) => `export const ${name}=(...args)=>globalThis.__omegaBillingNavigationApi.${name}(...args);`).join('\n'), shortCircuit: true };
    if (url === stubUrl) return { format: 'module', source: 'export default ()=>null; export const OmegaBrandMark=()=>null; export const SettingsPanel=()=>null; export const buildProfileInitials=()=>"AP"; export const RecoveryKeyCard=()=>null; export const SaasFleetCard=()=>null; export const ApiTokensCard=()=>null; export const PilotWorkspaceCard=()=>null; export const ProfessionalReportsPanel=()=>null; export const CommercialBillingPanel=()=>null; export const CommercialDocumentsPanel=()=>null; export const GoogleAccountLink=()=>null;', shortCircuit: true };
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
  api.pendingGoogleAction = () => null;
  api.googleConnection = async () => ({ enabled: false, linked: false });
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

test('billing settings compare plans and keep the selection through payment verification', async () => {
  profile = 'GENERAL';
  const getPlans = api.fetchBillingPlans;
  const getSummary = api.fetchBillingSummary;
  const url = 'https://www.mercadopago.com.co/suscripciones';
  let pending = false;
  let paid = false;
  let request;
  api.fetchBillingPlans = async () => {
    const catalog = await getPlans();
    return {
      ...catalog,
      mode: 'test',
      needsTestPayerEmail: false,
      plans: [...catalog.plans, ...catalog.plans.map(offer => ({ ...offer, interval: 'ANNUAL', price: offer.price * 10 }))],
      operations: [{ code: 'LEGAL_INDEX', label: 'Indexación documental', scope: 'Cada 10 páginas: texto 1; OCR 3', credits: 1 }],
    };
  };
  api.fetchBillingSummary = async () => ({
    ...(await getSummary()),
    planCode: paid ? 'ENTERPRISE' : 'FREE',
    checkouts: pending && !paid ? [{ kind: 'SUBSCRIPTION', status: 'PENDING', checkout_url: url }] : [],
  });
  api.createBillingCheckout = async body => { request = body; pending = true; return { checkoutUrl: url }; };
  await act(async () => root.render(createElement(AccountSettingsPanel, {
    authSession: { tenantId: 'checkout-test', profile, role: 'ANALYST', accountType: 'INDIVIDUAL', canManageAccount: true },
    initialSection: 'plan', onSwitchProfile: async () => {},
  })));
  const button = text => [...container.querySelectorAll('button')].find(item => item.textContent.trim() === text);
  const choice = container.querySelector('[aria-label="Resumen de tu elección"]');
  assert.match(choice.textContent, /Pro · Mensual/);
  const enterprise = [...container.querySelectorAll('[role="radio"]')].find(item => item.textContent.startsWith('Enterprise'));
  assert.match(enterprise.textContent, /5 usuarios/);
  assert.match(container.textContent, /Cada 10 páginas: texto 1; OCR 3/);
  await act(async () => { enterprise.click(); button('Anual').click(); });
  assert.match(choice.textContent, /Enterprise · Anual/);
  assert.match(choice.textContent, /2\.999\.000/);
  assert.match(choice.textContent, /Los créditos se entregan cada mes/);
  assert.equal(container.querySelector('[role="radio"][aria-checked="true"]').textContent.includes('Seleccionado'), true);

  await act(async () => button('Preparar pago en Mercado Pago').click());
  assert.deepEqual(request, { planCode: 'ENTERPRISE', interval: 'ANNUAL', topup: false, payerEmail: undefined });
  const status = container.querySelector('[aria-label="Estado del pago"]');
  assert.match(status.textContent, /Enterprise · Anual · \$2\.999\.000 COP/);
  assert.equal(container.querySelector('[aria-current="step"]').textContent.trim(), '2Abre Mercado Pago');
  const checkoutLink = status.querySelector('a');
  assert.equal(checkoutLink.href, url);
  checkoutLink.addEventListener('click', event => event.preventDefault(), { once: true });
  await act(async () => checkoutLink.click());
  assert.match(container.querySelector('[aria-current="step"]').textContent, /Verifica la activación/);
  await act(async () => button('Verificar mi pago').click());
  assert.match(container.textContent, /aún no ha confirmado la activación/);
  api.refreshBilling = async () => { paid = true; };
  await act(async () => button('Verificar mi pago').click());
  assert.match(container.textContent, /Tu plan Enterprise está activo/);
  await act(async () => button('Elegir perfil de trabajo').click());
  assert.match(container.textContent, /Cambia tu perfil de trabajo/);
});

test('account settings exposes Google linking and can retry a failed status lookup', async () => {
  api.googleConnection = async () => { throw new Error('Sin conexión'); };
  await act(async () => root.render(createElement(AccountSettingsPanel, {
    authSession: { tenantId: 'account-test', email: 'ana@example.org', profile: 'GENERAL' },
  })));
  const google = container.querySelector('section[aria-label="Acceso con Google"]');
  assert.ok(google);
  assert.match(google.textContent, /No se pudo consultar/);
  api.googleConnection = async () => ({ enabled: true, linked: false });
  await act(async () => google.querySelector('button').click());
  const disclosure = google.querySelector('button');
  assert.equal(disclosure.textContent, 'Vincular Google');
  assert.equal(disclosure.getAttribute('aria-expanded'), 'false');
  const form = document.getElementById(disclosure.getAttribute('aria-controls'));
  assert.equal(form.hidden, true);
  await act(async () => disclosure.click());
  assert.equal(disclosure.getAttribute('aria-expanded'), 'true');
  assert.equal(form.hidden, false);
  assert.ok(form.querySelector('input[type="password"]')?.required);
});

test('personal accounts show the work profile and teams also see their permissions', async () => {
  const session = { tenantSlug: 'abogado', email: 'ana@example.org', profile: 'GENERAL', role: 'ANALYST', accountType: 'INDIVIDUAL', canManageAccount: true };
  const renderProfile = (profile, accountType = 'INDIVIDUAL') => createElement(AccountSettingsPanel, {
    authSession: { ...session, accountType }, profileConfig: { profile }, onSwitchProfile: async () => {},
  });
  await act(async () => root.render(renderProfile('GENERAL')));
  const header = container.querySelector('header');
  assert.match(header.textContent, /Espacio @abogado/);
  assert.match(header.textContent, /Cuenta personal/);
  assert.doesNotMatch(header.textContent, /Analista/);
  assert.match(header.textContent, /Perfil activo General/);
  assert.match(container.querySelector('button[aria-pressed="true"]').textContent, /General Activo/);
  const legalOption = [...container.querySelectorAll('button[aria-pressed]')].find(button => button.textContent.startsWith('Legal'));
  assert.match(legalOption.textContent, /expedientes y documentos/i);
  assert.match(legalOption.textContent, /Requiere Pro o Enterprise/);
  await act(async () => root.render(renderProfile('LEGAL')));
  assert.match(header.textContent, /Perfil activo Legal/);
  assert.match(container.querySelector('button[aria-pressed="true"]').textContent, /Legal Activo/);
  await act(async () => root.render(renderProfile('LEGAL', 'ORGANIZATION')));
  assert.match(header.textContent, /Permisos en el equipo Analista/);
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

test('sandbox puts the required payer beside the membership action', async () => {
  profile = 'DEVELOPER';
  const plans = api.fetchBillingPlans;
  api.fetchBillingPlans = async () => ({ ...(await plans()), mode: 'test', needsTestPayerEmail: true });
  await act(async () => root.render(createElement(MembershipGate, {
    authSession: { tenantId: 'sandbox-account', userId: 'owner', profile },
  })));
  const payer = container.querySelector('input[type="email"]');
  const checkout = [...container.querySelectorAll('button')].find(button => button.textContent.includes('en Mercado Pago'));
  assert.ok(payer?.required);
  assert.ok(checkout?.disabled);
  assert.ok(checkout.parentElement.contains(payer));
});
