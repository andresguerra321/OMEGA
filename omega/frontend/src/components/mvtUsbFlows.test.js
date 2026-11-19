import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { after, afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const panelUrl = new URL('./MvtVerifierPanel.jsx', import.meta.url);
const source = (await transformWithOxc(await fs.readFile(panelUrl, 'utf8'), fileURLToPath(panelUrl),
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
    if (url.endsWith('/PanelStatePrimitives.jsx')) return { format: 'module', shortCircuit: true,
      source: 'export const ActionConfirmationBanner = () => null; export const PanelEmptyState = () => null; export const PanelErrorBanner = () => null; export const PanelSkeleton = () => null;' };
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
    const label = platform === 'android' ? 'Iniciar revisión segura' : 'Iniciar revisión de iPhone';
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
  assert.equal(button('Iniciar revisión segura'), undefined);
  assert.deepEqual(calls, []);
});
