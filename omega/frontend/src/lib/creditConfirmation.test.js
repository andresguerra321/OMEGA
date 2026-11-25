import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmCreditSpend, registerCreditConfirmation } from './creditConfirmation.js';

test('credit confirmation fails closed without a mounted application', async () => {
  await assert.rejects(confirmCreditSpend(10, 'REPO_SCAN'), /confirmar/);
});

test('API retries only after explicit acceptance of the server quote', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const calls = [];
  let quoted;
  const unregister = registerCreditConfirmation(async (value) => { quoted = value; return true; });
  try {
    globalThis.window = { location: { protocol: 'file:', search: '' } };
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(calls.length === 1 ? { detail: 'OMEGA_CREDIT_QUOTE:10:REPO_SCAN' } : { status: 'COMPLETED' }), {
        status: calls.length === 1 ? 409 : 200, headers: { 'content-type': 'application/json' },
      });
    };
    const { apiFetch } = await import('./api.js?credit-confirm-accepted');
    await apiFetch('/repo/scan-url', { method: 'POST', body: { repoUrl: 'https://github.com/example/repository' } });
    assert.deepEqual(quoted, { credits: 10, operation: 'REPO_SCAN' });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.headers.get('X-Omega-Credit-Limit'), null);
    assert.equal(calls[1].options.headers.get('X-Omega-Credit-Limit'), '10');
    assert.equal(calls[0].options.body, calls[1].options.body);
  } finally {
    unregister(); globalThis.window = previousWindow; globalThis.fetch = previousFetch;
  }
});

test('cancelled quote never retries the billable request', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  const unregister = registerCreditConfirmation(async () => false);
  try {
    globalThis.window = { location: { protocol: 'file:', search: '' } };
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ detail: 'OMEGA_CREDIT_QUOTE:15:FORENSIC_STANDARD' }), { status: 409, headers: { 'content-type': 'application/json' } });
    };
    const { apiFetch } = await import('./api.js?credit-confirm-cancelled');
    await assert.rejects(apiFetch('/forensics/triage', { method: 'POST', body: {} }), (error) => error.cancelled === true);
    assert.equal(calls, 1);
  } finally {
    unregister(); globalThis.window = previousWindow; globalThis.fetch = previousFetch;
  }
});
