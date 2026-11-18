import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { inspectDesktopEnvironment } from './dockerPreflight.js';
import { checkDockerAvailability } from './dockerOrchestrator.js';

const names = { postgres: 'omega_postgres', 'forensic-worker': 'omega_forensic_worker', 'backend-java': 'omega_backend_java' };
function container(service, state = 'running') {
  return { id: `${service}-id`, name: `/${names[service]}`, state, health: 'healthy',
    labels: { 'com.docker.compose.project': 'omega', 'com.docker.compose.service': service, 'io.omega.version': '1.9.0', 'io.omega.managed': 'true' },
    ports: service === 'backend-java' ? { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8080' }] } : {},
    networks: { 'omega_omega-private': { IPAddress: '172.18.0.2' } },
    mounts: service === 'postgres' ? [{ Type: 'volume', Name: 'omega_omega_pgdata', Destination: '/var/lib/postgresql/data' }] : [] };
}
function fixture({ containers = [], volume = null, foreignNetwork = false, password = 'existing-secret' } = {}) {
  const calls = [];
  async function run(args, options) {
    calls.push({ args, options });
    const ok = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
    if (args[0] === 'ps') return { code: 0, stdout: containers.map(item => JSON.stringify({ Names: item.name.slice(1) })).join('\n'), stderr: '' };
    if (args[0] === 'container' && args[3] === '{{json .Config.Env}}') return ok([`POSTGRES_PASSWORD=${password}`, 'POSTGRES_USER=omega_admin', 'POSTGRES_DB=omega_cti']);
    if (args[0] === 'container') return ok(containers.find(item => item.name.slice(1) === args.at(-1)));
    if (args[0] === 'network') return foreignNetwork
      ? ok([{ Labels: { 'com.docker.compose.project': 'foreign' } }]) : { code: 1, stdout: '', stderr: 'No such network' };
    if (args[0] === 'volume') return volume ? ok([volume]) : { code: 1, stdout: '', stderr: 'No such volume' };
    if (args[0] === 'exec') return { code: options.inputText === `${password}\n` ? 0 : 1, stdout: options.inputText === `${password}\n` ? '1\n' : '', stderr: '' };
    assert.fail(`Unexpected command: ${JSON.stringify(args)}`);
  }
  return { calls, run, probePort: async () => true, env: { POSTGRES_PASSWORD: 'new-secret', OMEGA_DESKTOP_VERSION: '1.9.0' } };
}

test('fresh startup checks resources without creating, removing or stopping anything', async () => {
  const options = fixture();
  const result = await inspectDesktopEnvironment(options);
  assert.equal(result.project, 'omega');
  assert.equal(result.volumeName, 'omega_omega_pgdata');
  assert.equal(result.backendPort, 8080);
  assert.equal(result.canReuse, false);
  assert.ok(options.calls.every(({ args }) => ['ps', 'network', 'volume'].includes(args[0])));
});

test('containers with matching names but foreign ownership are never adopted or deleted', async () => {
  for (const mismatch of ['project', 'service']) {
    const item = container('postgres');
    item.labels[`com.docker.compose.${mismatch}`] = 'foreign';
    const options = fixture({ containers: [item] });
    await assert.rejects(inspectDesktopEnvironment(options), { code: 'CONTAINER_NAME_CONFLICT' });
    assert.ok(options.calls.every(({ args }) => !['exec', 'rm', 'stop', 'unpause'].includes(args[0])));
  }
});

test('unmarked legacy containers require a recognized OMEGA image', async () => {
  const item = container('postgres', 'exited');
  delete item.labels['io.omega.managed'];
  item.image = 'unrelated-image:latest';
  await assert.rejects(inspectDesktopEnvironment(fixture({ containers: [item] })), { code: 'CONTAINER_IDENTITY_UNVERIFIED' });
  item.image = 'pgvector/pgvector:pg16';
  assert.equal((await inspectDesktopEnvironment(fixture({ containers: [item] }))).env.POSTGRES_PASSWORD, 'existing-secret');
});

test('a different release fingerprint rebuilds stale images even when the version number is unchanged', async () => {
  const options = fixture({ containers: Object.keys(names).map(service => container(service)) });
  options.env.OMEGA_DESKTOP_RELEASE_ID = 'new-release';
  assert.equal((await inspectDesktopEnvironment(options)).versionMismatch, true);
});

test('a healthy owned installation preserves its database password, volume and bound port', async () => {
  const options = fixture({ containers: Object.keys(names).map(service => container(service)),
    volume: { Name: 'omega_omega_pgdata', Labels: { 'com.docker.compose.project': 'omega' } } });
  options.probePort = () => assert.fail('The port is already owned by the verified backend');
  const result = await inspectDesktopEnvironment(options);
  assert.equal(result.canReuse, true);
  assert.equal(result.env.POSTGRES_PASSWORD, 'existing-secret');
  assert.equal(result.env.OMEGA_PG_VOLUME_NAME, 'omega_omega_pgdata');
  assert.equal(result.versionMismatch, false);
  const checks = options.calls.filter(({ args }) => args[0] === 'exec');
  assert.equal(checks.length, 2);
  assert.ok(checks.every(({ args }) => !args.join(' ').includes('existing-secret') && !args.join(' ').includes('new-secret')));
  assert.ok(checks.every(({ args }) => args.at(-1) === '172.18.0.2' && !args.includes('127.0.0.1')));
});

test('reusing an existing gateway retains its strong signing key so sessions survive reconfiguration', async () => {
  const options = fixture({ containers: [container('backend-java')] });
  const previous = 'existing-strong-signing-key-12345678901234567890';
  const run = options.run;
  options.run = (args, settings) => args[0] === 'container' && args[3] === '{{json .Config.Env}}'
    ? Promise.resolve({ code: 0, stdout: JSON.stringify([`OMEGA_JWT_SECRET=${previous}`]), stderr: '' }) : run(args, settings);
  const result = await inspectDesktopEnvironment(options);
  assert.equal(result.env.OMEGA_JWT_SECRET, previous);
  assert.deepEqual(result.recoveredGateway, { OMEGA_JWT_SECRET: previous });
});

test('existing database authentication failure never resets the data volume', async () => {
  const options = fixture({ containers: [container('postgres')] });
  const run = options.run;
  options.run = (args, settings) => args[0] === 'exec' ? Promise.resolve({ code: 1, stdout: '', stderr: 'password authentication failed' }) : run(args, settings);
  await assert.rejects(inspectDesktopEnvironment(options), { code: 'DATABASE_AUTH_FAILED' });
  assert.ok(options.calls.every(({ args }) => !args.includes('rm') && !args.includes('down')));
});

test('a stopped database keeps its original credentials without opening or replacing its data', async () => {
  const options = fixture({ containers: [container('postgres', 'exited')] });
  const result = await inspectDesktopEnvironment(options);
  assert.equal(result.env.POSTGRES_PASSWORD, 'existing-secret');
  assert.ok(options.calls.every(({ args }) => args[0] !== 'exec'));
});

test('Docker state objects without a healthcheck remain valid inspection records', async () => {
  const item = container('postgres');
  item.state = { Status: 'running' };
  delete item.health;
  const result = await inspectDesktopEnvironment(fixture({ containers: [item] }));
  assert.equal(result.containers[0].state, 'running');
  assert.equal(result.containers[0].health, null);
  assert.equal(result.canReuse, false);
});

test('existing data without its original credentials blocks initialization rather than creating an empty database', async () => {
  const options = fixture({ volume: { Name: 'omega_omega_pgdata', Labels: {} } });
  await assert.rejects(inspectDesktopEnvironment(options), { code: 'DATABASE_CREDENTIALS_UNAVAILABLE' });
  const result = await inspectDesktopEnvironment({ ...options, env: { ...options.env, OMEGA_DATABASE_PASSWORD_KNOWN: true } });
  assert.equal(result.volumeName, 'omega_omega_pgdata');
});

test('foreign networks and database bind mounts block automatic replacement', async () => {
  await assert.rejects(inspectDesktopEnvironment(fixture({ foreignNetwork: true })), { code: 'NETWORK_CONFLICT' });
  const item = container('postgres');
  item.mounts[0].Type = 'bind';
  await assert.rejects(inspectDesktopEnvironment(fixture({ containers: [item] })), { code: 'DATABASE_STORAGE_CONFLICT' });
});

test('an occupied local port is bypassed automatically and the other application remains running', async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const options = fixture();
    delete options.probePort;
    options.env.JAVA_BACKEND_PORT = String(port);
    const result = await inspectDesktopEnvironment(options);
    assert.ok(result.backendPort > port);
    assert.equal(result.env.JAVA_BACKEND_PORT, String(result.backendPort));
    assert.equal(server.listening, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('version differences force reconciliation and unhealthy services cannot be reused', async () => {
  const items = Object.keys(names).map(service => container(service));
  items.at(-1).labels['io.omega.version'] = 'old';
  items[1].health = 'unhealthy';
  const result = await inspectDesktopEnvironment(fixture({ containers: items }));
  assert.equal(result.versionMismatch, true);
  assert.equal(result.canReuse, false);
});

test('Docker must have a Linux engine and a working Compose plugin', async () => {
  await assert.rejects(checkDockerAvailability(async (_, args) => ({ stdout: args[0] === 'info' ? 'windows\n' : '' })), { code: 'DOCKER_WRONG_ENGINE' });
  await assert.rejects(checkDockerAvailability(async (_, args) => { if (args[0] === 'compose') throw new Error('missing'); return { stdout: 'linux\n' }; }), { code: 'DOCKER_COMPOSE_MISSING' });
  await checkDockerAvailability(async () => ({ stdout: 'linux\n' }));
});
