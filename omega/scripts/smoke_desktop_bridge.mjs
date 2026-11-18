// Test-only: start the bundled sensor without elevation; no service is installed.
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connectHostSensor } from '../frontend/electron/hostSensor.js';
import { createHostRelay } from '../frontend/electron/hostRelay.js';

if (process.platform !== 'win32') throw new Error('This smoke test requires Windows Docker Desktop');
const run = promisify(execFile);
const root = path.resolve(process.argv[2]);
const tenant = crypto.randomUUID();
const endpoint = `\\\\.\\pipe\\omega-agent-${crypto.randomBytes(16).toString('hex')}`;
const { stdout } = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
const sid = stdout.match(/S-1-5-21-(?:\d+-){3}\d+/)[0];
const sensor = spawn(path.join(root, 'sensor_runtime/omega-sensor.exe'), ['--service', '--endpoint', endpoint], {
  windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  env: { ...process.env, OMEGA_SENSOR_USER_SID: sid, OMEGA_HOST_OWNER_TENANT_ID: tenant,
    OMEGA_REALTIME_ENABLED: 'false', OMEGA_CONTAINMENT_ENABLED: 'false' },
});
sensor.stderr.on('data', chunk => process.stderr.write(chunk));
let relay;
try {
  let client;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { client = await connectHostSensor({ endpoint, tenant }); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!client) throw new Error('Bundled sensor did not start');
  relay = await createHostRelay();
  relay.bind(tenant, client);
  const program = `import sys,json,time,secrets,hashlib,hmac,urllib.request
c=json.load(sys.stdin); target='/api/host/realtime/status'; stamp=str(int(time.time())); nonce=secrets.token_hex(16)
key=hashlib.sha256(c['token'].encode()).digest()
def sign(direction,method,body):
 return hmac.new(key,'\\n'.join([direction,method,target,stamp,nonce,hashlib.sha256(body).hexdigest()]).encode(),hashlib.sha256).hexdigest()
r=urllib.request.Request(c['url']+target,headers={'X-Omega-Time':stamp,'X-Omega-Nonce':nonce,'X-Host-Tenant':c['tenant'],'X-Omega-Signature':sign('request','GET',b'')})
with urllib.request.urlopen(r,timeout=15) as response:
 body=response.read(); assert hmac.compare_digest(response.headers['X-Omega-Signature'],sign('response','200',body)); assert json.loads(body)['scope']=='native-host'
print('Docker -> Electron -> bundled sensor: authenticated roundtrip verified')`;
  const container = spawn('docker', ['run', '--rm', '--add-host', 'host.docker.internal:host-gateway', '-i',
    'python:3.11-slim', 'python', '-c', program], { windowsHide: true, stdio: ['pipe', 'inherit', 'inherit'] });
  container.stdin.end(JSON.stringify({ url: relay.environment.OMEGA_HOST_WORKER_URL,
    token: relay.environment.OMEGA_HOST_INTERNAL_SERVICE_TOKEN, tenant }));
  const status = await new Promise((resolve, reject) => { container.once('error', reject); container.once('exit', resolve); });
  if (status !== 0) throw new Error('Docker bridge smoke test failed');
} finally {
  sensor.kill();
  if (relay) await relay.close();
}
