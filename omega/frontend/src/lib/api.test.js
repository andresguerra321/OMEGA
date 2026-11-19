import assert from 'node:assert/strict';
import { test } from 'node:test';

test('desktop follows the selected local backend port and rejects injected origins', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  try {
    for (const [index, search, port] of [[1, '?omegaBackendPort=8087', 8087], [2, '?omegaBackendPort=8080%40evil.example', 8080]]) {
      globalThis.window = { location: { protocol: 'file:', search } };
      let requested;
      globalThis.fetch = async url => { requested = url; return { ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}) }; };
      const api = await import(`./api.js?port-check=${index}`);
      await api.getHostRealtimeStatus();
      assert.equal(requested, `http://127.0.0.1:${port}/api/v1/forensics/host/realtime/status`);
    }
  } finally { globalThis.window = previousWindow; globalThis.fetch = previousFetch; }
});

function installMockBrowserEnvironment({ seedLegacy = true } = {}) {
  const lsStore = new Map();
  const ssStore = new Map();
  const events = [];

  globalThis.localStorage = {
    getItem(k) {
      return lsStore.has(k) ? lsStore.get(k) : null;
    },
    setItem(k, v) {
      lsStore.set(k, String(v));
    },
    removeItem(k) {
      lsStore.delete(k);
    },
    clear() {
      lsStore.clear();
    },
  };

  globalThis.sessionStorage = {
    getItem(k) {
      return ssStore.has(k) ? ssStore.get(k) : null;
    },
    setItem(k, v) {
      ssStore.set(k, String(v));
    },
    removeItem(k) {
      ssStore.delete(k);
    },
    clear() {
      ssStore.clear();
    },
  };

  if (seedLegacy) {
    lsStore.set('omega_auth_session_v1', '{"stale":true}');
    lsStore.set('omega_sandbox_creds_v1', '{"stale":true}');
    lsStore.set('omega_research_sessions_v2', '[]');
  }
  ssStore.set('transient_note', 'sensitive');

  globalThis.window = {
    location: { protocol: 'https:' },
    dispatchEvent(evt) {
      events.push(evt?.type);
    },
  };
  globalThis.CustomEvent = class MockCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => url.endsWith('/auth/csrf')
      ? { token: 'csrf-test-token', headerName: 'X-XSRF-TOKEN' }
      : { loggedOut: true, cookieCleared: true },
  });

  return { lsStore, ssStore, events };
}

function makeFutureJwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: '11111111-1111-1111-1111-111111111111',
      tid: '22222222-2222-2222-2222-222222222222',
      email: 'analista@redaccion.org',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  return `${header}.${payload}.sig`;
}

test('cookie writes obtain a fresh CSRF token and send it with credentials', async () => {
  installMockBrowserEnvironment({ seedLegacy: false });
  const api = await import('./api.js?csrf-cookie');
  api.restoreCookieAuthSession({ role: 'ADMIN' });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(url.endsWith('/auth/csrf')
      ? { headerName: 'X-XSRF-TOKEN', token: `masked-token-${calls.length}` }
      : { enabled: true }), { headers: { 'content-type': 'application/json' } });
  };
  await api.getHostRealtimeStatus();
  await api.toggleHostRealtime(true);
  await api.toggleHostRealtime(false);
  assert.equal(calls.length, 5);
  assert.equal(calls[1].url, '/api/v1/auth/csrf');
  assert.equal(calls[1].options.credentials, 'include');
  assert.equal(calls[2].options.headers.get('X-XSRF-TOKEN'), 'masked-token-2');
  assert.equal(calls[2].options.credentials, 'include');
  assert.equal(calls[4].options.headers.get('X-XSRF-TOKEN'), 'masked-token-4');
});

test('failed CSRF bootstrap prevents the state-changing request', async () => {
  installMockBrowserEnvironment({ seedLegacy: false });
  const api = await import('./api.js?csrf-failure');
  api.restoreCookieAuthSession({ role: 'ADMIN' });
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  };
  await assert.rejects(api.toggleHostRealtime(true), /protección de la sesión/);
  assert.deepEqual(calls, ['/api/v1/auth/csrf']);
});

test('desktop login explicitly uses bearer-only mode without cookies or CSRF bootstrap', async () => {
  installMockBrowserEnvironment({ seedLegacy: false });
  window.__TAURI_INTERNALS__ = { invoke: async () => ({}) };
  const api = await import('./api.js?csrf-desktop');
  api.clearAuthSession();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ accessToken: makeFutureJwt(), expiresInSeconds: 3600 }),
      { headers: { 'content-type': 'application/json' } });
  };
  await api.loginWithPassword({ tenantSlug: 'test', email: 'user@example.org', password: 'password' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8080/api/v1/auth/login');
  assert.equal(calls[0].options.headers.get('X-Omega-Auth-Mode'), 'bearer');
  assert.equal(calls[0].options.headers.has('X-XSRF-TOKEN'), false);
  assert.equal(calls[0].options.credentials, 'omit');
});

test('cliente web/desktop nunca persiste JWT o credenciales en localStorage y limpia legados al iniciar', async () => {
  const env = installMockBrowserEnvironment();
  const api = await import('./api.js');

  assert.equal(env.lsStore.has('omega_auth_session_v1'), false);
  assert.equal(env.lsStore.has('omega_sandbox_creds_v1'), false);
  assert.equal(env.lsStore.has('omega_research_sessions_v2'), false);

  const session = api.saveAuthSession({
    accessToken: makeFutureJwt(),
    expiresInSeconds: 3600,
    userId: '11111111-1111-1111-1111-111111111111',
    tenantId: '22222222-2222-2222-2222-222222222222',
    tenantSlug: 'redaccion-sur',
    email: 'analista@redaccion.org',
    role: 'ADMIN',
  });

  assert.equal(api.isAuthenticated(), true);
  assert.equal(session.tenantSlug, 'redaccion-sur');
  assert.equal(env.lsStore.size, 0);

  await api.panicPurgeClient();
  assert.equal(api.getAuthSession(), null);
  assert.equal(api.isAuthenticated(), false);
  assert.equal(env.ssStore.size, 0);
  assert.ok(env.events.includes('omega:panic-purge'));
});

test('restoreCookieAuthSession restaura sesión respaldada por cookie HttpOnly sin bearer en localStorage', async () => {
  const env = installMockBrowserEnvironment({ seedLegacy: false });
  const api = await import('./api.js');

  const restored = api.restoreCookieAuthSession({
    userId: '11111111-1111-1111-1111-111111111111',
    tenantId: '22222222-2222-2222-2222-222222222222',
    tenantSlug: 'redaccion-sur',
    email: 'reporter@redaccion.org',
    role: 'ANALYST',
  });

  assert.equal(restored.cookieBacked, true);
  assert.equal(restored.accessToken, '');
  assert.equal(api.isAuthenticated(), true);
  assert.equal(env.lsStore.size, 0);

  env.lsStore.set('omega_auth_session_v1', '{"legacy":true}');
  await api.logoutSession();
  assert.equal(api.isAuthenticated(), false);
  assert.equal(env.lsStore.size, 0);
});

test('host protection uses authenticated gateway routes and explicit JSON toggle', async () => {
  installMockBrowserEnvironment({ seedLegacy: false });
  const api = await import('./api.js');
  api.saveAuthSession({ accessToken: makeFutureJwt(), expiresInSeconds: 3600, role: 'ADMIN' });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ enabled: false }) };
  };
  await api.getHostRealtimeStatus();
  await api.toggleHostRealtime(false);
  await api.auditHostPersistence();
  assert.equal(calls[0].url, '/api/v1/forensics/host/realtime/status');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers.get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(calls[1].options.body), { enabled: false });
  assert.match(calls[1].options.headers.get('Authorization'), /^Bearer /);
  assert.equal(calls[2].url, '/api/v1/forensics/host/persistence/audit');
  assert.equal(calls[2].options.headers.get('Content-Type'), 'application/json');
});

test('containment preview never implies execute and active link probing is explicit', async () => {
  installMockBrowserEnvironment({ seedLegacy: false });
  const api = await import('./api.js');
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}) };
  };
  const candidate = { actionType: 'BLOCK_NETWORK_INDICATOR', target: { indicator: '93.184.216.34' } };
  await api.previewContainment(candidate);
  await api.executeContainment(candidate, 'plan-token', { currentPassword: 'fixture' });
  await api.verifySuspiciousLink('https://example.com');
  await api.verifySuspiciousLink('https://example.com', null, true);
  assert.equal(JSON.parse(calls[0].options.body).dryRun, true);
  assert.equal(JSON.parse(calls[1].options.body).dryRun, false);
  assert.equal(JSON.parse(calls[1].options.body).previewToken, 'plan-token');
  assert.equal(calls[0].options.headers.get('Content-Type'), 'application/json');
  assert.equal(JSON.parse(calls[2].options.body).activeProbe, false);
  assert.equal(JSON.parse(calls[3].options.body).activeProbe, true);
});
test('dossier export downloads authenticated binary data and preserves permission errors', async () => {
  installMockBrowserEnvironment({ seedLegacy: false });
  const api = await import('./api.js');
  api.saveAuthSession({ accessToken: makeFutureJwt(), expiresInSeconds: 3600, role: 'ANALYST' });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(new Blob(['%PDF-fixture'], { type: 'application/pdf' }), { status: 200, headers: { 'content-type': 'application/pdf' } });
  };
  const blob = await api.exportExpedienteDossier('case-id', 'pdf');
  assert.equal(await blob.text(), '%PDF-fixture');
  assert.equal(calls[0].url, '/api/v1/expedientes/case-id/export/pdf');
  assert.match(calls[0].options.headers.get('Authorization'), /^Bearer /);
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Sin permisos sobre el expediente' }), { status: 403, headers: { 'content-type': 'application/json' } });
  await assert.rejects(api.exportExpedienteDossier('case-id', 'json'), error => error.status === 403);
});

test('enterLocalWorkspace requests local-session once and marks session as local workspace', async () => {
  installMockBrowserEnvironment({ seedLegacy: false });
  const api = await import(`./api.js?local-ws=${Date.now()}`);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options?.method || 'GET' });
    if (String(url).endsWith('/auth/csrf')) {
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ token: 'csrf-tok', headerName: 'X-XSRF-TOKEN' }) };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        accessToken: makeFutureJwt(),
        expiresInSeconds: 3600,
        userId: '11111111-1111-1111-1111-111111111111',
        tenantId: '22222222-2222-2222-2222-222222222222',
        tenantSlug: 'espacio-local',
        email: 'operador@omega.local',
        role: 'ADMIN',
      }),
    };
  };
  const [first, second] = await Promise.all([api.enterLocalWorkspace(), api.enterLocalWorkspace()]);
  assert.equal(first.isLocalWorkspace, true);
  assert.equal(second.tenantSlug, 'espacio-local');
  const postCalls = calls.filter((c) => c.url.endsWith('/auth/local-session'));
  assert.equal(postCalls.length, 1);
});
