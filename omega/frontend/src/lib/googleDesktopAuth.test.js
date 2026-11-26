import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relayDesktopGoogleReturn, startGoogleAuth } from './googleAuth.js';

const state = `D_${'s'.repeat(41)}`;
const proof = 'p'.repeat(43);

test('Desktop uses the native browser and keeps the proof out of the browser URL', async t => {
  const calls = [];
  const url = `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`;
  globalThis.window = {
    location: { protocol: 'http:' },
    __TAURI_INTERNALS__: { invoke: async (command, args) => calls.push([command, args]) },
  };
  t.after(() => delete globalThis.window);
  t.mock.method(globalThis, 'fetch', async (endpoint, request) => {
    assert.equal(request.credentials, 'omit');
    assert.equal(request.headers.get('X-Omega-Auth-Mode'), 'bearer');
    const body = JSON.parse(request.body);
    if (endpoint.endsWith('/desktop/start')) {
      assert.deepEqual(body, { action: 'LOGIN' });
      return Response.json({ url, proof });
    }
    assert.ok(endpoint.endsWith('/desktop/finish'));
    assert.deepEqual(body, { state, proof });
    return Response.json({ action: 'LOGIN', session: { accessToken: 'test-session' } });
  });
  assert.equal((await startGoogleAuth('LOGIN')).session.accessToken, 'test-session');
  assert.deepEqual(calls, [['open_google_authorization', { url }]]);
});

test('browser return clears the URL and relays only the code and attempt state', async t => {
  let cleaned = false;
  globalThis.window = {
    location: { pathname: '/google/callback', search: `?state=${state}&code=test-code`, protocol: 'http:' },
    history: { replaceState: (_state, _unused, path) => { cleaned = path === '/'; } },
  };
  t.after(() => delete globalThis.window);
  t.mock.method(globalThis, 'fetch', async (endpoint, request) => {
    assert.ok(cleaned);
    if (endpoint.endsWith('/auth/csrf')) return Response.json({ token: 'csrf', headerName: 'X-XSRF-TOKEN' });
    assert.ok(endpoint.endsWith('/desktop/relay'));
    assert.deepEqual(JSON.parse(request.body), { state, code: 'test-code' });
    return new Response(null, { status: 204 });
  });
  await relayDesktopGoogleReturn();
  assert.equal(cleaned, true);
});
