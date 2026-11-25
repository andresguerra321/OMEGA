import assert from 'node:assert/strict';
import test from 'node:test';
import { clearAuthSession, ensurePersonalWorkspace, restoreCookieAuthSession } from './api.js';
test('personal uploads select the owner workspace even when a shared case appears first', async () => {
  const previous = globalThis.fetch;
  restoreCookieAuthSession({ userId: 'owner-one', tenantId: 'tenant-one', role: 'ANALYST', email: 'qa@example.invalid' });
  globalThis.fetch = async () => new Response(JSON.stringify([
    { id: 'shared-case', ownerUserId: 'someone-else', title: 'Espacio personal' },
    { id: 'own-case', ownerUserId: 'owner-one', title: 'Espacio personal' },
  ]), { headers: { 'content-type': 'application/json' } });
  try { assert.equal((await ensurePersonalWorkspace()).id, 'own-case'); }
  finally { globalThis.fetch = previous; clearAuthSession(); }
});
