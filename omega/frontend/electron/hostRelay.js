import crypto from 'node:crypto';
import http from 'node:http';
import { hmacSignature } from './securityHardening.js';

const MAX_BODY = 1024 * 1024;
const ALLOWED = /^(?:GET \/api\/(?:health|host\/realtime\/status|containment\/history)|POST \/api\/(?:host\/(?:iocs\/sync|realtime\/toggle|persistence\/audit)|containment\/execute|containment\/rollback\/[a-f0-9-]{36}))$/;

/** Docker gateway -> authenticated loopback bridge -> ACL-protected native sensor. */
export async function createHostRelay() {
  const token = crypto.randomBytes(32).toString('hex');
  const key = crypto.createHash('sha256').update(token).digest('hex');
  const nonces = new Map();
  let client = null, owner = null;
  const server = http.createServer(async (request, response) => {
    const stamp = request.headers['x-omega-time'], nonce = request.headers['x-omega-nonce'];
    const supplied = request.headers['x-omega-signature'];
    const target = request.url;
    const reply = (status, value, signed = false) => {
      const body = Buffer.from(JSON.stringify(value));
      const headers = { 'Content-Type': 'application/json', 'Content-Length': body.length };
      if (signed) headers['X-Omega-Signature'] = hmacSignature(key, 'response', String(status), target, stamp, nonce, body);
      response.writeHead(status, headers); response.end(body);
    };
    if (!/^\d{10}$/.test(stamp || '') || Math.abs(Date.now() / 1000 - Number(stamp)) > 30 ||
        !/^[a-f0-9]{32}$/.test(nonce || '') || !/^[a-f0-9]{64}$/.test(supplied || '')) {
      request.resume(); reply(401, { detail: 'Invalid sensor signature' }); return;
    }
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY) { reply(413, { detail: 'Request too large' }); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const expected = hmacSignature(key, 'request', request.method, target, stamp, nonce, body);
      for (const [entry, expiry] of nonces) if (expiry < Date.now()) nonces.delete(entry);
      if (!crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) || nonces.has(nonce) || nonces.size >= 10000) {
        reply(401, { detail: 'Invalid sensor signature or replay' }); return;
      }
      nonces.set(nonce, Date.now() + 61000);
      if (!ALLOWED.test(`${request.method} ${target}`)) { reply(403, { detail: 'Sensor route denied' }, true); return; }
      if (!client) { reply(503, { detail: 'OMEGA está preparando la protección de esta computadora.' }, true); return; }
      if (request.headers['x-host-tenant'] !== owner) { reply(403, { detail: 'Esta computadora pertenece a otra cuenta.' }, true); return; }
      const result = await client.request(request.method, target, body.length ? JSON.parse(body.toString('utf8')) : undefined,
        { 'x-host-actor': request.headers['x-host-actor'] });
      reply(200, result, true);
    } catch (error) {
      reply(error.status || 503, { detail: 'No se pudo completar la operación del sensor. Reintenta desde OMEGA.' }, true);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    environment: { OMEGA_HOST_WORKER_URL: `http://host.docker.internal:${server.address().port}`, OMEGA_HOST_INTERNAL_SERVICE_TOKEN: token },
    bind(tenant, sensor) { owner = tenant; client = sensor; },
    close() { client = null; server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); },
  };
}
