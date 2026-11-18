import net from 'node:net';

const SERVICES = { omega_postgres: 'postgres', omega_forensic_worker: 'forensic-worker',
  omega_backend_java: 'backend-java', omega_frontend: 'frontend', omega_omniroute: 'omniroute' };
const LEGACY_IMAGES = { postgres: 'pgvector/pgvector:pg16', 'forensic-worker': 'omega-forensic-worker:latest',
  'backend-java': 'omega-backend-java:latest', omniroute: 'ghcr.io/diegosouzapw/omniroute:latest' };
const FORMAT = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"labels":{{json .Config.Labels}},"state":{{json .State}},"networks":{{json .NetworkSettings.Networks}},"ports":{{json .NetworkSettings.Ports}},"mounts":{{json .Mounts}}}';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function records(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  try { return text.startsWith('[') ? JSON.parse(text) : text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
  catch { fail('DOCKER_INSPECTION_FAILED', 'Docker no pudo describir los componentes existentes. Reintenta cuando termine de iniciar.'); }
}

export function canBindPort(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

function portNumber(value, fallback) {
  const number = Number(value || fallback);
  if (!Number.isInteger(number) || number < 1024 || number > 65535) fail('INVALID_PORT', 'La configuración local de puertos no es válida.');
  return number;
}

export async function inspectDesktopEnvironment({ env, run, runtimeState = {}, probePort = canBindPort }) {
  const next = { ...env };
  const project = next.COMPOSE_PROJECT_NAME || runtimeState.composeProject || 'omega';
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) fail('INVALID_PROJECT', 'La instalación local de OMEGA tiene un identificador inválido.');
  next.COMPOSE_PROJECT_NAME = project;
  const usesOmni = String(next.OMNIROUTE_ENABLED || '').toLowerCase() === 'true' || String(next.OMNIROUTE_BASE_URL || '').includes('omniroute:20128');
  const options = { env: next, timeoutMs: 15000 };
  const listed = await run(['ps', '-a', '--format', '{{json .}}'], options);
  if (listed.code !== 0) fail('DOCKER_INSPECTION_FAILED', 'No se pudieron comprobar los contenedores existentes.');
  const present = records(listed.stdout).map(item => String(item.Names || '').replace(/^\//, '')).filter(name =>
    SERVICES[name] && SERVICES[name] !== 'frontend' && (SERVICES[name] !== 'omniroute' || usesOmni));
  const containers = [];
  for (const name of present) {
    const result = await run(['container', 'inspect', '--format', FORMAT, name], options);
    const item = result.code === 0 ? records(result.stdout)[0] : null;
    if (!item?.id) fail('DOCKER_INSPECTION_FAILED', 'Un componente cambió durante la comprobación. Pulsa Reintentar.');
    const state = typeof item.state === 'string' ? item.state : item.state?.Status;
    const health = item.health || item.state?.Health?.Status || null;
    const labels = item.labels || {};
    if (labels['com.docker.compose.project'] !== project || labels['com.docker.compose.service'] !== SERVICES[name]) {
      fail('CONTAINER_NAME_CONFLICT', `El nombre ${name} pertenece a otra instalación. OMEGA la dejó intacta; cierra esa instalación y pulsa Reintentar.`);
    }
    if (labels['io.omega.managed'] !== 'true' && item.image !== LEGACY_IMAGES[SERVICES[name]]) {
      fail('CONTAINER_IDENTITY_UNVERIFIED', 'Un componente existente no se reconoce como parte de OMEGA. Se dejó intacto para proteger esa instalación.');
    }
    if (['removing', 'dead'].includes(state)) fail('CONTAINER_NOT_READY', 'Docker está reparando o retirando un componente de OMEGA. Espera y pulsa Reintentar.');
    containers.push({ ...item, state, health, service: SERVICES[name] });
  }
  for (const name of ['omega-private', 'omega-public']) {
    const result = await run(['network', 'inspect', `${project}_${name}`], options);
    if (result.code !== 0 && /no such network|not found/i.test(result.stderr || '')) continue;
    if (result.code !== 0) fail('DOCKER_INSPECTION_FAILED', 'No se pudo comprobar la red local de OMEGA.');
    const network = records(result.stdout)[0];
    if (!network || network.Labels?.['com.docker.compose.project'] !== project || network.Labels?.['com.docker.compose.network'] !== name) {
      fail('NETWORK_CONFLICT', 'Una red existente utiliza el nombre de OMEGA y pertenece a otra instalación. No se modificó.');
    }
  }
  const database = containers.find(item => item.service === 'postgres');
  const mounted = database?.mounts?.find(item => item.Destination === '/var/lib/postgresql/data');
  if (database && (!mounted || mounted.Type !== 'volume' || !mounted.Name)) {
    fail('DATABASE_STORAGE_CONFLICT', 'La base existente utiliza un almacenamiento distinto. Se conservaron sus datos y se detuvo el cambio automático.');
  }
  const volumeName = mounted?.Name || next.OMEGA_PG_VOLUME_NAME || runtimeState.databaseVolume || `${project}_omega_pgdata`;
  const volumeResult = await run(['volume', 'inspect', volumeName], options);
  const volume = volumeResult.code === 0 ? records(volumeResult.stdout)[0] : null;
  if (volumeResult.code !== 0 && !/no such volume|not found/i.test(volumeResult.stderr || '')) {
    fail('DOCKER_INSPECTION_FAILED', 'No se pudo comprobar el almacenamiento de tus datos.');
  }
  if (volumeResult.code === 0 && (!volume || (volume.Labels?.['com.docker.compose.project'] && volume.Labels['com.docker.compose.project'] !== project))) {
    fail('DATABASE_STORAGE_CONFLICT', 'El volumen existente pertenece a otra instalación. No se modificó.');
  }
  next.OMEGA_PG_VOLUME_NAME = volumeName;
  let recoveredDatabase = null;
  if (database) {
    const result = await run(['container', 'inspect', '--format', '{{json .Config.Env}}', database.id], options);
    let values;
    try { values = JSON.parse(result.stdout); } catch { values = null; }
    if (result.code !== 0 || !Array.isArray(values)) fail('DATABASE_CREDENTIALS_UNAVAILABLE', 'No se pudo recuperar la configuración de la base existente. Sus datos se conservaron.');
    const previous = Object.fromEntries(values.map(value => { const index = value.indexOf('='); return [value.slice(0, index), value.slice(index + 1)]; }));
    const candidates = [...new Set([next.POSTGRES_PASSWORD, previous.POSTGRES_PASSWORD].filter(Boolean))];
    const user = previous.POSTGRES_USER || next.POSTGRES_USER || 'omega_admin';
    const db = previous.POSTGRES_DB || next.POSTGRES_DB || 'omega_cti';
    let password = candidates[0];
    if (database.state === 'running') {
      const network = database.networks?.[`${project}_omega-private`] || Object.values(database.networks || {}).find(item => item.IPAddress || item.GlobalIPv6Address);
      const address = network?.IPAddress || network?.GlobalIPv6Address;
      if (!address || !net.isIP(address) || address.startsWith('127.') || address === '::1') {
        fail('DATABASE_NETWORK_UNAVAILABLE', 'La base existente no tiene una red disponible para comprobar sus credenciales. Espera a Docker y pulsa Reintentar.');
      }
      password = null;
      for (const candidate of candidates) {
        if (/[\r\n\0]/.test(candidate)) continue;
        // Password stays on stdin; never interpolate credentials into a command or log.
        const probe = await run(['exec', '-i', database.id, 'sh', '-c',
          'IFS= read -r PGPASSWORD; export PGPASSWORD; export PGCONNECT_TIMEOUT=3; export PGOPTIONS="-c statement_timeout=3000 -c lock_timeout=3000"; exec psql -h "$3" -U "$1" -d "$2" -Atqc "SELECT 1"', 'omega-check', user, db, address],
          { ...options, inputText: `${candidate}\n`, timeoutMs: 10000 });
        if (probe.code === 0 && probe.stdout.trim() === '1') { password = candidate; break; }
      }
      if (!password) fail('DATABASE_AUTH_FAILED', 'La base de OMEGA existe, pero sus credenciales no coinciden. Tus datos se conservaron; no se reinició ni borró el volumen.');
    } else {
      password = previous.POSTGRES_PASSWORD || password;
    }
    if (!password) fail('DATABASE_CREDENTIALS_UNAVAILABLE', 'No se pudo recuperar la clave de la base existente. Tus datos están intactos.');
    recoveredDatabase = { POSTGRES_USER: user, POSTGRES_DB: db, POSTGRES_PASSWORD: password };
    Object.assign(next, recoveredDatabase);
  } else if (volume && next.OMEGA_DATABASE_PASSWORD_KNOWN !== true) {
    fail('DATABASE_CREDENTIALS_UNAVAILABLE', 'Se encontraron datos de una instalación anterior, pero falta su configuración segura. Se conservaron sin crear una base vacía.');
  }
  delete next.OMEGA_DATABASE_PASSWORD_KNOWN;
  const backend = containers.find(item => item.service === 'backend-java');
  let recoveredGateway = null;
  if (backend) {
    const result = await run(['container', 'inspect', '--format', '{{json .Config.Env}}', backend.id], options);
    let values;
    try { values = JSON.parse(result.stdout); } catch { values = null; }
    if (result.code !== 0 || !Array.isArray(values)) fail('DOCKER_INSPECTION_FAILED', 'No se pudo comprobar la configuración del servicio existente.');
    const entry = values.find(value => value.startsWith('OMEGA_JWT_SECRET='));
    const secret = entry?.slice('OMEGA_JWT_SECRET='.length);
    if (secret?.length >= 32 && !secret.includes('omega-dev-')) {
      next.OMEGA_JWT_SECRET = secret;
      recoveredGateway = { OMEGA_JWT_SECRET: secret };
    }
  }
  const existingPort = backend?.ports?.['8080/tcp']?.find(binding => ['127.0.0.1', '0.0.0.0', '::', ''].includes(binding.HostIp))?.HostPort;
  let port = portNumber(existingPort || next.JAVA_BACKEND_PORT || runtimeState.backendPort, 8080);
  if (!existingPort) {
    for (let attempt = 0; !(await probePort(port)); attempt++) {
      if (attempt >= 99 || port === 65535) fail('PORT_UNAVAILABLE', 'No hay un puerto local disponible para OMEGA. Cierra otra instancia y pulsa Reintentar.');
      port++;
    }
  }
  next.JAVA_BACKEND_PORT = String(port);
  const omni = containers.find(item => item.service === 'omniroute');
  if (usesOmni && !omni?.ports?.['20128/tcp']?.length && !(await probePort(portNumber(next.OMNIROUTE_PORT, 20128)))) {
    fail('OMNIROUTE_PORT_CONFLICT', 'Otra aplicación está usando el puerto del motor de IA. OMEGA no la detuvo.');
  }
  const versionMismatch = containers.some(item => ['backend-java', 'forensic-worker'].includes(item.service) &&
    ((next.OMEGA_DESKTOP_VERSION && item.labels?.['io.omega.version'] !== next.OMEGA_DESKTOP_VERSION) ||
     (next.OMEGA_DESKTOP_RELEASE_ID && item.labels?.['io.omega.release'] !== next.OMEGA_DESKTOP_RELEASE_ID)));
  return { env: next, containers, recoveredDatabase, recoveredGateway, project, volumeName, backendPort: port, versionMismatch,
    canReuse: ['postgres', 'forensic-worker', 'backend-java'].every(service => containers.some(item => item.service === service && item.state === 'running' && item.health === 'healthy')) };
}
