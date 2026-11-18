import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { hmacSignature } from './securityHardening.js';

export function exchange(endpoint, message) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let raw = '';
    const fail = (error) => { socket.destroy(); reject(error); };
    socket.setTimeout(120000, () => fail(new Error('Tiempo del sensor agotado')));
    socket.once('error', fail);
    socket.once('connect', () => socket.write(`${JSON.stringify(message)}\n`));
    socket.on('data', (chunk) => {
      raw += chunk.toString('utf8');
      if (raw.length > 2 * 1024 * 1024) return fail(new Error('Respuesta del sensor demasiado grande'));
      if (raw.endsWith('\n')) {
        try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
        socket.destroy();
      }
    });
    socket.once('end', () => { if (!raw.endsWith('\n')) fail(new Error('Respuesta incompleta del sensor')); });
  });
}

export async function connectHostSensor({ root, tenant, endpoint, python = 'python', userSid }) {
  const serviceEndpoint = Boolean(endpoint);
  let child, directory;
  let secret = crypto.randomBytes(32).toString('hex');
  if (!endpoint) {
    const id = crypto.randomBytes(16).toString('hex');
    if (process.platform === 'win32') endpoint = `\\\\.\\pipe\\omega-agent-${id}`;
    else {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-agent-'));
      fs.chmodSync(directory, 0o700);
      endpoint = path.join(directory, 'sensor.sock');
    }
    const env = { ...process.env, OMEGA_NATIVE_SENSOR: '1', OMEGA_HOST_OWNER_TENANT_ID: tenant,
      OMEGA_HOST_IOC_SOURCE: 'gateway', OMEGA_SENSOR_USER_SID: userSid || '' };
    delete env.INTERNAL_SERVICE_TOKEN;
    delete env.PYTHONPATH;
    delete env.PYTHONSTARTUP;
    child = spawn(python, ['-I', '-S', path.join(root, 'api', 'sensor_bootstrap.py'), '--endpoint', endpoint], {
      cwd: root, env, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true,
    });
    child.stdin.end(secret);
    child.stdin.on('error', () => {});
    let failure;
    child.on('error', (error) => { failure = error; });
    child.stderr.on('data', () => {}); // Do not send sensor diagnostics or secrets to the renderer.
    child.once('exit', () => { if (directory) { try { fs.rmdirSync(directory); } catch {} } });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failure || child.exitCode !== null) throw failure || new Error('El sensor rechazó el arranque; comprueba la integridad y dependencias');
      try { await exchange(endpoint, {}); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
      if (attempt === 99) { child.kill(); throw new Error('El sensor no está disponible'); }
    }
  } else {
    const response = await exchange(endpoint, { bootstrap: true });
    if (!/^[a-f0-9]{64}$/.test(response.secret)) throw new Error('Bootstrap del servicio inválido');
    secret = response.secret;
  }
  return {
    async request(method, target, payload, forwardedHeaders = {}, retry = true) {
      const body = payload === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(payload));
      const stamp = String(Math.floor(Date.now() / 1000));
      const nonce = crypto.randomBytes(16).toString('hex');
      const response = await exchange(endpoint, { method, target, body: body.toString('base64'), headers: {
        ...(forwardedHeaders['x-host-actor'] ? { 'x-host-actor': forwardedHeaders['x-host-actor'] } : {}),
        'content-type': 'application/json', 'x-host-tenant': tenant, 'x-omega-time': stamp, 'x-omega-nonce': nonce,
        'x-omega-signature': hmacSignature(secret, 'request', method, target, stamp, nonce, body),
      } });
      if (response.status === 401 && serviceEndpoint && retry &&
          (method === 'GET' || target === '/api/host/iocs/sync')) {
        const refreshed = await exchange(endpoint, { bootstrap: true });
        if (!/^[a-f0-9]{64}$/.test(refreshed.secret)) throw new Error('Bootstrap del servicio inválido');
        secret = refreshed.secret;
        return this.request(method, target, payload, forwardedHeaders, false);
      }
      const decoded = Buffer.from(response.body, 'base64');
      const expected = hmacSignature(secret, 'response', String(response.status), target, stamp, nonce, decoded);
      const supplied = response.headers['x-omega-signature'] || '';
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
        throw new Error('Respuesta del sensor sin autenticación válida');
      }
      if (response.status >= 400) {
        const error = new Error(`El sensor rechazó la solicitud (${response.status})`);
        error.status = response.status;
        throw error;
      }
      return JSON.parse(decoded.toString('utf8'));
    },
    close() { child?.kill(); if (directory) { try { fs.rmdirSync(directory); } catch { /* Sensor removes its socket on exit. */ } } },
  };
}
