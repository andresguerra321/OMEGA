import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { after, afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const panelUrl = new URL('./MvtVerifierPanel.jsx', import.meta.url);
const primitivesUrl = new URL('./PanelStatePrimitives.jsx', import.meta.url);
const source = (await transformWithOxc(await fs.readFile(panelUrl, 'utf8'), fileURLToPath(panelUrl),
  { jsx: { runtime: 'automatic' } })).code;
const primitivesSource = (await transformWithOxc(await fs.readFile(primitivesUrl, 'utf8'), fileURLToPath(primitivesUrl),
  { jsx: { runtime: 'automatic' } })).code;
const api = {};
globalThis.__mvtUsbApi = api;
const names = ['analyzeLiveDeviceSnapshot', 'analyzePcLiveSnapshot', 'resolveEncryptedIosManifestTargets',
  'resolveIosManifestTargets', 'runParallelTriage', 'syncStixFeeds', 'verifyMvtText'];
const stubNames = ['AndroidStepVisual', 'IosStepVisual', 'PcStepVisual', 'MobileUsbAuditCard',
  'OmegaWebIntelCard', 'ContainmentButton', 'EmergencyGuidance', 'useScrollReveal'];
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === panelUrl.href) {
      if (specifier === '../lib/api') return { url: 'omega-test:api', shortCircuit: true };
      if (['./DeviceSetupVisuals', './MobileUsbAuditCard', './OmegaWebIntelCard', './ContainmentPanel',
        '../lib/useScrollReveal'].includes(specifier)) return { url: 'omega-test:stubs', shortCircuit: true };
      if (specifier.startsWith('.')) {
        return next(`${specifier}${specifier.includes('PanelStatePrimitives') ? '.jsx' : '.js'}`, context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === panelUrl.href) return { format: 'module', source, shortCircuit: true };
    if (url === 'omega-test:api') return { format: 'module', shortCircuit: true,
      source: names.map(name => `export const ${name} = (...args) => globalThis.__mvtUsbApi.${name}(...args);`).join('\n') };
    if (url === 'omega-test:stubs') return { format: 'module', shortCircuit: true,
      source: stubNames.map(name => `export const ${name} = () => null;`).join('\n') };
    if (url.endsWith('/PanelStatePrimitives.jsx')) return { format: 'module', source: primitivesSource, shortCircuit: true };
    return next(url, context);
  },
});
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://tauri.localhost' });
const previous = new Map();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MvtVerifierPanel } = await import('./MvtVerifierPanel.jsx');
let root, container, calls, responses, analyzed;
const backup = { path: 'C:/backup', deviceName: 'Test iPhone' };
const targets = [{ file_id: 'a'.repeat(40), relative_path: 'Library/SMS/sms.db' }];
beforeEach(() => {
  calls = []; analyzed = [];
  responses = {
    check_adb_status: { connected: true, serial: 'android-2', model: 'Pixel', devices: [{ serial: 'android-2', state: 'device' }] },
    check_ios_status: { connected: true, device: { udid: 'iphone-2', name: 'Test iPhone' }, local_backups: [] },
    collect_device_snapshot: { platform: 'android', device: { serial: 'android-2' } },
    collect_ios_snapshot: { platform: 'ios', device: { udid: 'iphone-2' } },
    pick_ios_backup_dir: { valid: true, backup },
    read_ios_backup_manifest: { encrypted: false, manifest_b64: 'manifest', manifest_plist_b64: 'plist', backup },
    read_ios_backup_artifacts: { platform: 'ios', device: { name: 'Test iPhone' }, binary_artifacts: [] },
  };
  window.__TAURI_INTERNALS__ = { invoke: async (cmd, args) => {
    calls.push([cmd, args]);
    assert.ok(cmd in responses, `Unexpected native command: ${cmd}`);
    if (responses[cmd] instanceof Error) throw responses[cmd];
    return structuredClone(responses[cmd]);
  } };
  for (const name of names) api[name] = () => { throw new Error(`Unexpected API call: ${name}`); };
  api.analyzeLiveDeviceSnapshot = async snapshot => {
    analyzed.push(snapshot);
    return { device_summary: { platform: snapshot.platform }, triage: {} };
  };
  api.resolveIosManifestTargets = async manifest => { assert.equal(manifest, 'manifest'); return { targets }; };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
after(() => {
  hooks.deregister(); dom.window.close(); delete globalThis.__mvtUsbApi;
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
});
async function render(initialTab) { await act(async () => root.render(createElement(MvtVerifierPanel, { initialTab }))); }
function button(text) { return [...container.querySelectorAll('button')].find(el => el.textContent.includes(text)); }
async function click(text) { const el = button(text); assert.ok(el, `Missing button: ${text}`); await act(async () => el.click()); }
async function settle(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  assert.ok(predicate());
}

for (const platform of ['android', 'ios']) {
  test(`${platform} USB sends the selected device snapshot to authenticated triage`, async () => {
    await render(platform);
    const label = platform === 'android' ? 'Analizar teléfono' : 'Analizar iPhone';
    await settle(() => button(label));
    await click(label);
    assert.equal(analyzed.length, 1);
    assert.equal(analyzed[0].platform, platform);
    assert.ok(calls.some(([cmd, args]) => platform === 'android'
      ? cmd === 'collect_device_snapshot' && args.serial === 'android-2'
      : cmd === 'collect_ios_snapshot' && args.udid === 'iphone-2'));
  });
}

test('selecting an iOS backup resolves its manifest and reads targeted artifacts', async () => {
  responses.check_ios_status.connected = false;
  await render('ios');
  await click('Elegir');
  assert.equal(analyzed.length, 1);
  assert.ok(calls.some(([cmd, args]) => cmd === 'read_ios_backup_artifacts'
    && args.backupPath === backup.path && !args.encrypted && JSON.stringify(args.targets) === JSON.stringify(targets)));
});

test('Android reports missing authorization and exposes the scan after retry', async () => {
  const authorized = responses.check_adb_status;
  responses.check_adb_status = { connected: false, status_code: 'UNAUTHORIZED' };
  await render('android');
  await settle(() => container.textContent.includes('Toca «Permitir»'));
  assert.equal(button('Analizar teléfono'), undefined);
  assert.equal(button('Ayuda para conectar por USB').getAttribute('aria-expanded'), 'false');
  responses.check_adb_status = authorized;
  await click('Buscar teléfono por USB');
  await click('Analizar teléfono');
  assert.equal(analyzed.length, 1);
});

test('manual Android search distinguishes Windows file transfer from ADB authorization', async () => {
  responses.check_adb_status = { connected: false, status_code: 'NO_DEVICE' };
  await render('android');
  await settle(() => container.textContent.includes('ADB no detecta un Android'));
  responses.check_adb_status = {
    connected: false, status_code: 'NO_DEVICE', windows_file_transfer: true, windows_device_name: 'Redmi de prueba',
  };
  await click('Buscar teléfono por USB');
  assert.ok(calls.some(([cmd, args]) => cmd === 'check_adb_status' && args.waitForUsb === true));
  assert.match(container.textContent, /Windows detectó el equipo\. Depuración pendiente/);
  assert.match(container.textContent, /Windows reconoció Redmi de prueba para transferir archivos/);
  assert.equal(button('Analizar teléfono'), undefined);
  assert.equal(analyzed.length, 0);
});

test('a disconnected iPhone can be found again without opening a backup', async () => {
  const connected = responses.check_ios_status;
  responses.check_ios_status = { connected: false, tools_available: true, status_code: 'UNPAIRED' };
  await render('ios');
  await settle(() => container.textContent.includes('Toca «Confiar»'));
  assert.equal(button('Analizar iPhone'), undefined);
  responses.check_ios_status = connected;
  await click('Buscar iPhone por USB');
  await click('Analizar iPhone');
  assert.equal(analyzed.length, 1);
  assert.ok(!calls.some(([cmd]) => cmd === 'pick_ios_backup_dir'));
});

test('iPhone setup installs the connector and checks USB again', async () => {
  const connected = responses.check_ios_status;
  responses.check_ios_status = { tools_available: false, connected: false, status_code: 'TOOLS_MISSING' };
  responses.install_ios_connector = { ok: true };
  await render('ios');
  await settle(() => button('Instalar conector para iPhone'));
  assert.equal(button('Copiar comando'), undefined);
  responses.check_ios_status = connected;
  await click('Instalar conector para iPhone');
  const install = calls.findIndex(([cmd]) => cmd === 'install_ios_connector');
  assert.ok(install >= 0);
  assert.ok(calls.slice(install + 1).some(([cmd]) => cmd === 'check_ios_status'));
  assert.ok(button('Analizar iPhone'));
});

test('missing Python and Apple USB support show official downloads', async () => {
  responses.check_ios_status = { tools_available: false, connected: false, status_code: 'TOOLS_MISSING', apple_driver_present: false };
  responses.install_ios_connector = { ok: false, code: 'PYTHON_REQUIRED', error: 'Instala Python primero.' };
  responses.open_ios_prerequisite = null;
  await render('ios');
  await settle(() => button('Instalar conector para iPhone'));
  await click('Instalar conector para iPhone');
  assert.match(container.textContent, /Instala Python primero/);
  await click('Obtener Python');
  await click('Descargar desde Apple');
  assert.deepEqual(calls.filter(([cmd]) => cmd === 'open_ios_prerequisite'), [
    ['open_ios_prerequisite', { prerequisite: 'python' }], ['open_ios_prerequisite', { prerequisite: 'apple' }],
  ]);
});

test('an interrupted Android scan shows the error by the USB action and sends no snapshot', async () => {
  responses.collect_device_snapshot = new Error('El Android dejó de responder por USB.');
  await render('android');
  await settle(() => button('Analizar teléfono'));
  await click('Analizar teléfono');
  assert.equal(analyzed.length, 0);
  assert.match(button('Analizar teléfono').closest('section').textContent, /El Android dejó de responder por USB/);
});

test('canceling backup selection does not read files or call triage', async () => {
  responses.check_ios_status.connected = false;
  responses.pick_ios_backup_dir = { canceled: true };
  await render('ios');
  await click('Elegir');
  assert.equal(analyzed.length, 0);
  assert.ok(!calls.some(([cmd]) => cmd.startsWith('read_ios_backup')));
});

test('encrypted backup waits for a password, clears it on failure, and retries with the unlock token', async () => {
  responses.check_ios_status.connected = false;
  responses.read_ios_backup_manifest.encrypted = true;
  let attempts = 0;
  api.resolveEncryptedIosManifestTargets = async (plist, manifest, password) => {
    assert.equal(plist, 'plist'); assert.equal(manifest, 'manifest'); assert.equal(password, 'backup-secret');
    if (++attempts === 1) throw new Error('Contraseña incorrecta');
    return { targets, unlock_token: 'ephemeral-token' };
  };
  await render('ios');
  await click('Elegir');
  assert.equal(analyzed.length, 0);
  for (let attempt = 0; attempt < 2; attempt++) {
    const input = container.querySelector('input[type="password"]');
    assert.ok(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'backup-secret');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await act(async () => input.closest('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    if (attempt === 0) {
      assert.match(container.textContent, /Contraseña incorrecta/);
      assert.equal(input.value, '');
      assert.equal(analyzed.length, 0);
    }
  }
  assert.equal(analyzed.length, 1);
  assert.equal(analyzed[0].ios_unlock_token, 'ephemeral-token');
  assert.ok(!JSON.stringify(analyzed[0]).includes('backup-secret'));
  assert.equal(container.querySelector('input[type="password"]'), null);
});

test('web keeps local USB operations unavailable', async () => {
  delete window.__TAURI_INTERNALS__;
  await render('android');
  assert.match(container.textContent, /El análisis por USB requiere OMEGA Desktop/);
  assert.equal(button('Analizar teléfono'), undefined);
  assert.equal(button('Ayuda para conectar por USB'), undefined);
  let opened = false;
  container.querySelector('input[type="file"]').addEventListener('click', () => { opened = true; });
  await click('Elegir archivo o respaldo');
  assert.equal(opened, true);
  assert.deepEqual(calls, []);
});

test('insufficient credits on mobile scan explains the reason inline and opens plans only when requested', async () => {
  const err = new Error('Créditos insuficientes para "Análisis forense estándar": requiere 15 créditos y tu saldo disponible es de 5. Recarga créditos o contrata un plan en Mi plan y créditos.');
  err.status = 402;
  err.billingRequired = true;
  api.analyzeLiveDeviceSnapshot = async () => { throw err; };

  const billingEvents = [];
  const onBilling = (event) => billingEvents.push(event?.detail?.reason || '');
  window.addEventListener('omega:billing-required', onBilling);
  try {
    await render('ios');
    await settle(() => button('Analizar iPhone'));
    await click('Analizar iPhone');
    assert.equal(billingEvents.length, 0, '402 must not hijack navigation automatically');
    assert.match(container.textContent, /requiere 15 créditos y tu saldo disponible es de 5/);
    const goPlans = button('Ir a planes y créditos');
    assert.ok(goPlans, 'Inline CTA to open plans and credits must be rendered');
    await act(async () => goPlans.click());
    assert.equal(billingEvents.length, 1);
    assert.match(billingEvents[0], /requiere 15 créditos/);
  } finally {
    window.removeEventListener('omega:billing-required', onBilling);
  }
});
