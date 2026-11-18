import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { SECURE_WEB_PREFERENCES, httpsUrl, allowedNavigation, assertTrustedIpcSender, validateIpc, verifyRelease,
  hmacSignature, encryptedStorage } from './securityHardening.js';
import { loadOrCreateDesktopSecrets, readDotEnv } from './dockerOrchestrator.js';

test('all BrowserWindows enforce isolation, sandbox and web security', () => {
  assert.deepEqual(SECURE_WEB_PREFERENCES, { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true });
  const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.equal((main.match(/new BrowserWindow\(/g) || []).length, 2);
  assert.equal((main.match(/\.\.\.SECURE_WEB_PREFERENCES/g) || []).length, 2);
  assert.match(main, /on\('will-navigate', blockNavigation\)/);
  assert.equal((main.match(/on\('will-navigate'/g) || []).length, 2);
  assert.match(main, /setWindowOpenHandler/);
});

test('external links only permit HTTPS and internal navigation uses exact document URLs', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://example.com', 'ms-msdt:test',
    'smb://host/share', 'https://user:pass@example.com', 'https://example.com\n']) assert.equal(httpsUrl(url), null);
  assert.equal(httpsUrl('https://example.com/path'), 'https://example.com/path');
  assert.ok(allowedNavigation('file:///app/index.html#screen', ['file:///app/index.html']));
  assert.ok(!allowedNavigation('file:///etc/passwd', ['file:///app/index.html']));
  assert.ok(!allowedNavigation('https://evil.example', ['http://localhost:5174/']));
});

test('main IPC accepts only the authorized top frame of the application window', () => {
  const frame = { url: 'file:///app/index.html' };
  const sender = { mainFrame: frame };
  const win = { webContents: sender };
  const locations = ['file:///app/index.html'];
  const event = { sender, senderFrame: frame };
  assert.doesNotThrow(() => assertTrustedIpcSender(event, win, locations));
  assert.throws(() => assertTrustedIpcSender(event, null, locations));
  assert.throws(() => assertTrustedIpcSender({ ...event, sender: { mainFrame: frame } }, win, locations));
  assert.throws(() => assertTrustedIpcSender({ ...event, senderFrame: { url: frame.url } }, win, locations));
  assert.throws(() => assertTrustedIpcSender({ ...event, senderFrame: null }, win, locations));
  frame.url = 'https://attacker.example/';
  assert.throws(() => assertTrustedIpcSender(event, win, locations));
  const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /assertTrustedIpcSender\(event, mainWindow, rendererLocations\)/);
});

test('preload exposes explicit APIs and validates payloads without exposing ipcRenderer', () => {
  let bridge;
  const calls = [];
  const ipcRenderer = { invoke: (...args) => calls.push(args), on() {}, removeListener() {} };
  vm.runInNewContext(fs.readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8'), {
    require: (name) => { assert.equal(name, 'electron'); return { ipcRenderer, contextBridge: { exposeInMainWorld: (_, api) => { bridge = api; } } }; },
    process: { platform: 'win32' }, URL,
  });
  assert.equal(bridge.ipcRenderer, undefined);
  assert.equal(bridge.invoke, undefined);
  assert.throws(() => bridge.openExternalUrl('file:///etc/passwd'));
  assert.throws(() => bridge.collectDeviceSnapshot({ shell: 'evil' }));
  bridge.openExternalUrl('https://example.com');
  assert.equal(calls.length, 1);
  assert.throws(() => validateIpc('omega:unknown', [{}]));
  assert.throws(() => validateIpc('omega:backend-retry', [{ prodMode: 'true' }]));
  assert.throws(() => validateIpc('omega:ios-read-backup-artifacts', [{ targets: [null] }]));
});

test('DOMPurify removes raw HTML, SVG and handler payloads before markdown rendering', () => {
  const window = new JSDOM('').window;
  const purify = createDOMPurify(window);
  const clean = purify.sanitize('<img src=x onerror=alert(1)><svg onload=alert(1)>x</svg><script>evil()</script>hello', { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  assert.equal(clean, 'hello');
  const component = fs.readFileSync(new URL('../src/components/MarkdownMessage.jsx', import.meta.url), 'utf8');
  assert.match(component, /DOMPurify\.sanitize/);
  assert.match(component, /skipHtml/);
  assert.match(component, /urlTransform=\{\(url\) => safeHttps\(url\)\}/);
  window.close();
});

test('Ed25519 manifest rejects injected, changed, missing files and untrusted signatures', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-integrity-'));
  try {
    fs.mkdirSync(path.join(root, 'api'));
    const file = path.join(root, 'api/sensor.py');
    fs.writeFileSync(file, 'safe');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const publicRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
    const raw = Buffer.from(JSON.stringify({ version: 1, files: { 'api/sensor.py': crypto.createHash('sha256').update('safe').digest('hex') } }));
    fs.writeFileSync(path.join(root, 'integrity-manifest.json'), raw);
    fs.writeFileSync(path.join(root, 'integrity-manifest.sig'), crypto.sign(null, raw, privateKey).toString('base64'));
    assert.ok(verifyRelease(root, publicRaw));
    fs.writeFileSync(path.join(root, 'api/injected.py'), 'evil');
    assert.throws(() => verifyRelease(root, publicRaw));
    fs.unlinkSync(path.join(root, 'api/injected.py'));
    fs.writeFileSync(file, 'tampered');
    assert.throws(() => verifyRelease(root, publicRaw));
    fs.unlinkSync(file);
    assert.throws(() => verifyRelease(root, publicRaw));
    assert.throws(() => verifyRelease(root, crypto.randomBytes(32).toString('base64')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('native authentication secret is RAM-only and durable keys use safeStorage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-secret-'));
  try {
    const storage = { encrypt: (value) => Buffer.from(value).toString('base64'), decrypt: (value) => Buffer.from(value, 'base64').toString() };
    const result = loadOrCreateDesktopSecrets(dir, {}, {}, storage);
    const persisted = fs.readFileSync(result.secretsPath, 'utf8');
    assert.equal(JSON.parse(persisted).version, 2);
    assert.ok(!persisted.includes(result.envOverrides.INTERNAL_SERVICE_TOKEN));
    assert.ok(!storage.decrypt(JSON.parse(persisted).ciphertext).includes('INTERNAL_SERVICE_TOKEN'));
    assert.throws(() => encryptedStorage({ isEncryptionAvailable: () => false }));
    assert.throws(() => encryptedStorage({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' }));
    const main = fs.readFileSync(new URL('./hostSensor.js', import.meta.url), 'utf8');
    assert.match(main, /child\.stdin\.end\(secret\)/);
    assert.doesNotMatch(main, /env\.[A-Z_]+\s*=\s*secret/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('request and response HMAC bind direction, target, nonce and exact body', () => {
  const key = '11'.repeat(32);
  const first = hmacSignature(key, 'request', 'POST', '/api/host/test', '1', '22'.repeat(16), Buffer.from('{}'));
  assert.equal(first, crypto.createHmac('sha256', Buffer.from(key, 'hex')).update('request\nPOST\n/api/host/test\n1\n' + '22'.repeat(16) + '\n' + crypto.createHash('sha256').update('{}').digest('hex')).digest('hex'));
  assert.notEqual(first, hmacSignature(key, 'response', 'POST', '/api/host/test', '1', '22'.repeat(16), Buffer.from('{}')));
  assert.notEqual(first, hmacSignature(key, 'request', 'POST', '/api/host/test', '1', '33'.repeat(16), Buffer.from('{}')));
});

test('desktop migrates legacy .env credentials into the protected store and removes static IPC tokens', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-env-'));
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'OPENAI_API_KEY=provider-secret\nINTERNAL_SERVICE_TOKEN=legacy-static\nJAVA_BACKEND_PORT=8080\n');
    const storage = { encrypt: (value) => Buffer.from(value).toString('base64'), decrypt: (value) => Buffer.from(value, 'base64').toString() };
    const env = readDotEnv(dir, dir, storage);
    assert.equal(env.OPENAI_API_KEY, 'provider-secret');
    assert.equal(env.INTERNAL_SERVICE_TOKEN, undefined);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, '.env'), 'utf8'), /provider-secret|legacy-static/);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'omega-protected-env.json'), 'utf8'), /provider-secret|legacy-static/);
    assert.equal(readDotEnv(dir, dir, storage).OPENAI_API_KEY, 'provider-secret');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
