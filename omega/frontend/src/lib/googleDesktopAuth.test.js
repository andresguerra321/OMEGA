import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { startGoogleAuth } from './googleAuth.js';

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

const callbackHtml = readFileSync(new URL('../../public/google-desktop-return.html', import.meta.url), 'utf8');

for (const scenario of [
  { query: 'code=test-code', code: 'test-code', reply: 204, state: 'success', title: 'Autenticación completada' },
  { query: 'error=access_denied', code: null, reply: 204, state: 'error', title: 'No se pudo completar el acceso' },
  { query: 'code=expired', code: 'expired', reply: 401, state: 'error', title: 'No se pudo completar el acceso' },
]) test(`standalone Desktop callback ${scenario.query}`, async t => {
  const { window } = new JSDOM(callbackHtml, {
    url: `https://omega.test/google/callback?state=${state}&${scenario.query}`, runScripts: 'outside-only',
  });
  t.after(window.close.bind(window));
  const requests = [];
  window.fetch = async (endpoint, request) => {
    requests.push([endpoint, request, window.location.search]);
    if (endpoint.endsWith('/auth/csrf')) return Response.json({ token: 'csrf', headerName: 'X-XSRF-TOKEN' });
    return new Response(null, { status: scenario.reply });
  };
  const { document } = window;
  assert.equal(document.querySelectorAll('script[src], link[href], img[src]').length, 0);
  window.eval(document.querySelector('script').textContent);
  for (let count = 0; count < 10 && requests.length < 2; count++) await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.deepEqual(requests.map(([path, , search]) => [path, search]), [
    ['/api/v1/auth/csrf', ''], ['/api/v1/auth/google/desktop/relay', ''],
  ]);
  assert.equal(requests[1][1].headers['X-XSRF-TOKEN'], 'csrf');
  assert.deepEqual(JSON.parse(requests[1][1].body), { state, code: scenario.code });
  assert.equal(document.querySelector('main').dataset.state, scenario.state);
  assert.equal(document.querySelector('h1').textContent, scenario.title);
  let triedClose = false;
  window.close = () => { triedClose = true; };
  document.querySelector('#close').click();
  assert.equal(triedClose, true);
  assert.match(document.querySelector('#note').textContent, /desde tu navegador/);
});
