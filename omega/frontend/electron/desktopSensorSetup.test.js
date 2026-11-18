import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import test from 'node:test';
import { createDesktopSensorSetup, installationCommand } from './desktopSensorSetup.js';
import { createHostRelay } from './hostRelay.js';
import { hmacSignature } from './securityHardening.js';
import { connectHostSensor } from './hostSensor.js';

const tenant = '12345678-1234-1234-1234-123456789abc';
const sid = 'S-1-5-21-100-200-300-1001';
function setup(overrides = {}) {
  const calls = [];
  const sensor = { request: async (...args) => { calls.push(['request', ...args]); return {}; } };
  const options = { root: 'C:/OMEGA', platform: 'win32',
    authenticate: async () => ({ role: 'ADMIN', tenantId: tenant }),
    verify: () => { calls.push(['verify']); },
    run: async (...args) => { calls.push(['run', ...args]); return { stdout: sid }; },
    bind: (...args) => calls.push(['bind', ...args]), connect: async () => sensor, sleep: async () => {},
    releaseId: () => null, ...overrides };
  return { calls, sensor, manager: createDesktopSensorSetup(options) };
}

test('an installed sensor is reused without asking Windows for elevation', async () => {
  const { calls, manager } = setup();
  assert.deepEqual(await manager.ensure('session'), { ready: true });
  assert.equal(calls.filter(call => call[0] === 'run').length, 1);
  assert.equal(calls.find(call => call[0] === 'run')[1], 'whoami.exe');
  await manager.ensure('session');
  assert.equal(calls.filter(call => call[0] === 'bind').length, 1);
});

test('first use prepares the service automatically using the verified tenant and current Windows account', async () => {
  let attempts = 0;
  const { manager, calls } = setup({ connect: async () => {
    if (attempts++ === 0) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return { request: async () => ({}) };
  } });
  await Promise.all([manager.ensure('session'), manager.ensure('session')]);
  const elevated = calls.filter(call => call[0] === 'run' && call[1] === 'powershell.exe');
  assert.equal(elevated.length, 1);
  const outer = Buffer.from(elevated[0][2].at(-1), 'base64').toString('utf16le');
  assert.match(outer, /-Verb RunAs/);
  const encoded = outer.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)[1];
  const installer = Buffer.from(encoded, 'base64').toString('utf16le');
  assert.ok(installer.includes(tenant));
  assert.ok(installer.includes(sid));
  assert.match(installer, /-EnsureInstalled/);
  assert.doesNotMatch(installer, /PythonPath|session/);
});

test('untrusted accounts and compromised payloads cannot request elevation', async () => {
  const denied = setup({ authenticate: async () => ({ role: 'ANALYST', tenantId: tenant }) });
  await assert.rejects(denied.manager.ensure('session'), /administradora/);
  assert.equal(denied.calls.length, 0);
  const tampered = setup({ verify: () => { throw new Error('integrity'); } });
  await assert.rejects(tampered.manager.ensure('session'), /integrity/);
  assert.equal(tampered.calls.length, 0);
  assert.throws(() => installationCommand('C:/OMEGA', 'injected', sid));
});

test('cancelled Windows consent produces a recoverable application error', async () => {
  const { manager } = setup({ connect: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
    run: async file => { if (file === 'whoami.exe') return { stdout: sid }; throw new Error('UAC cancelled'); } });
  await assert.rejects(manager.ensure('session'), /Reintentar/);
  await assert.rejects(manager.ensure('session'), /Reintentar/);
});

test('an older bundled sensor is automatically upgraded instead of silently reused', async () => {
  let version = 0;
  const { manager, calls } = setup({ releaseId: () => 'new-release',
    connect: async () => { const releaseId = version++ ? 'new-release' : 'old-release'; return { request: async () => ({ releaseId }) }; } });
  await manager.ensure('session');
  assert.equal(calls.filter(call => call[0] === 'run' && call[1] === 'powershell.exe').length, 1);
});

test('an already bound computer cannot be silently assigned to a different tenant', async () => {
  let current = tenant;
  const { manager } = setup({ authenticate: async () => ({ role: 'ADMIN', tenantId: current }) });
  await manager.ensure('session');
  current = '87654321-4321-4321-4321-cba987654321';
  await assert.rejects(manager.ensure('other-session'), /otra cuenta/);
});

test('Docker relay enforces HMAC, nonce, owner and route and signs its response', async () => {
  const relay = await createHostRelay();
  try {
    const url = new URL(relay.environment.OMEGA_HOST_WORKER_URL);
    const origin = `http://127.0.0.1:${url.port}`;
    const key = crypto.createHash('sha256').update(relay.environment.OMEGA_HOST_INTERNAL_SERVICE_TOKEN).digest('hex');
    let requests = 0;
    relay.bind(tenant, { request: async () => { requests++; return { scope: 'native-host' }; } });
    const target = '/api/host/realtime/status';
    assert.equal((await fetch(origin + target)).status, 401);
    function headers(path, owner = tenant) {
      const stamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomBytes(16).toString('hex');
      return { 'x-omega-time': stamp, 'x-omega-nonce': nonce, 'x-host-tenant': owner,
        'x-omega-signature': hmacSignature(key, 'request', 'GET', path, stamp, nonce) };
    }
    const auth = headers(target);
    const response = await fetch(origin + target, { headers: auth });
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-omega-signature'), hmacSignature(key, 'response', '200', target, auth['x-omega-time'], auth['x-omega-nonce'], body));
    assert.equal((await fetch(origin + target, { headers: auth })).status, 401);
    assert.equal((await fetch(origin + target, { headers: headers(target, 'other') })).status, 403);
    assert.equal((await fetch(origin + '/api/arbitrary', { headers: headers('/api/arbitrary') })).status, 403);
    assert.equal(requests, 1);
    assert.equal(url.hostname, 'host.docker.internal');
  } finally { await relay.close(); }
});

test('sensor restart renews an expired IPC key for reads without replaying containment actions', async () => {
  let secret = crypto.randomBytes(32).toString('hex'), bootstraps = 0, requests = 0;
  const server = net.createServer(socket => {
    let raw = '';
    socket.on('data', chunk => {
      raw += chunk.toString();
      if (!raw.endsWith('\n')) return;
      const message = JSON.parse(raw);
      if (message.bootstrap) { bootstraps++; socket.end(JSON.stringify({ secret }) + '\n'); return; }
      requests++;
      const headers = message.headers;
      const valid = headers['x-omega-signature'] === hmacSignature(secret, 'request', message.method, message.target,
        headers['x-omega-time'], headers['x-omega-nonce'], Buffer.from(message.body, 'base64'));
      const body = Buffer.from(JSON.stringify({ ok: valid }));
      const responseHeaders = valid ? { 'x-omega-signature': hmacSignature(secret, 'response', '200', message.target,
        headers['x-omega-time'], headers['x-omega-nonce'], body) } : {};
      socket.end(JSON.stringify({ status: valid ? 200 : 401, headers: responseHeaders, body: body.toString('base64') }) + '\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = await connectHostSensor({ endpoint: { host: '127.0.0.1', port: server.address().port }, tenant });
    secret = crypto.randomBytes(32).toString('hex');
    assert.deepEqual(await client.request('GET', '/api/health'), { ok: true });
    assert.equal(bootstraps, 2);
    secret = crypto.randomBytes(32).toString('hex');
    await assert.rejects(client.request('POST', '/api/containment/execute', { action: 'test' }));
    assert.equal(bootstraps, 2);
    assert.equal(requests, 3);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
