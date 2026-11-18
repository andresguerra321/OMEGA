import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { connectHostSensor } from './hostSensor.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

export function installationCommand(root, tenant, sid) {
  if (!UUID.test(tenant) || !/^S-1-5-21-(?:\d+-){3}\d+$/.test(sid)) throw new Error('Identidad del equipo inválida');
  const script = path.join(root, 'scripts', 'install_host_sensor.ps1');
  const command = `& ${quote(script)} -TenantId ${quote(tenant)} -UserSid ${quote(sid)} -EnsureInstalled; if (-not $?) { exit 1 }`;
  const payload = Buffer.from(command, 'utf16le').toString('base64');
  const elevated = `$ErrorActionPreference='Stop'; try { $p=Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${payload}'; exit $p.ExitCode } catch { exit 1223 }`;
  return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(elevated, 'utf16le').toString('base64')]];
}

export function createDesktopSensorSetup({ root, run, verify, authenticate, bind, connect = connectHostSensor,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), platform = process.platform,
  releaseId = () => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'integrity-manifest.json'))).digest('hex') }) {
  let pending = null, boundTenant = null, installed = null;
  return {
    ensure(accessToken) {
      if (pending) return pending;
      pending = (async () => {
        if (platform !== 'win32') return { ready: false, message: 'La preparación automática del sensor está disponible en Windows.' };
        const me = await authenticate(accessToken);
        if (me.role !== 'ADMIN' || !UUID.test(me.tenantId || '')) throw new Error('La protección del equipo requiere una cuenta administradora.');
        if (boundTenant && boundTenant !== me.tenantId) throw new Error('Esta computadora ya está vinculada a otra cuenta OMEGA.');
        if (installed) return { ready: true };
        verify(root);
        const { stdout } = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 10000 });
        const sid = stdout.match(/S-1-5-21-(?:\d+-){3}\d+/)?.[0];
        if (!sid) throw new Error('OMEGA no pudo identificar la cuenta de Windows.');
        const endpoint = `\\\\.\\pipe\\omega-agent-${me.tenantId}`;
        let sensor;
        let install = false;
        try {
          sensor = await connect({ endpoint, tenant: me.tenantId });
          const expected = releaseId();
          if (expected && (await sensor.request('GET', '/api/health')).releaseId !== expected) install = true;
        }
        catch (error) {
          if (!['ENOENT', 'ECONNREFUSED', 'EBUSY'].includes(error.code)) throw error;
          install = true;
        }
        if (install) {
          sensor = null;
          const [file, args] = installationCommand(root, me.tenantId, sid);
          try { await run(file, args, { windowsHide: true, timeout: 240000 }); }
          catch { throw new Error('Windows no autorizó la preparación de la protección. Pulsa Reintentar para volver a solicitar permiso.'); }
          for (let attempt = 0; attempt < 60; attempt++) {
            try { sensor = await connect({ endpoint, tenant: me.tenantId }); break; }
            catch { await sleep(500); }
          }
          if (!sensor) throw new Error('La protección todavía no está lista. Pulsa Reintentar.');
          const expected = releaseId();
          if (expected && (await sensor.request('GET', '/api/health')).releaseId !== expected) {
            throw new Error('La actualización de la protección no terminó. Pulsa Reintentar.');
          }
        }
        await sensor.request('GET', '/api/host/realtime/status');
        boundTenant = me.tenantId;
        installed = sensor;
        bind(me.tenantId, sensor);
        return { ready: true };
      })().finally(() => { pending = null; });
      return pending;
    },
  };
}
