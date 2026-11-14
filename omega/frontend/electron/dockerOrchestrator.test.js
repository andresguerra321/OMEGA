import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildComposeArgs,
  DockerOrchestrator,
  loadOrCreateDesktopSecrets,
  parseComposePsOutput,
  parseDotEnvContent,
  sanitizeLogLine,
} from './dockerOrchestrator.js';

function createTempComposeDir({ withProd = true, envContent = 'POSTGRES_PASSWORD=localpass\n' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-compose-test-'));
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services:\n  postgres: {}\n');
  if (withProd) {
    fs.writeFileSync(path.join(dir, 'docker-compose.prod.yml'), 'services:\n  postgres: {}\n');
  }
  if (envContent !== null) {
    fs.writeFileSync(path.join(dir, '.env'), envContent);
  }
  return dir;
}

test('parseDotEnvContent y loadOrCreateDesktopSecrets respetan .env existente y persisten secretos faltantes', () => {
  const composeDir = createTempComposeDir({
    envContent: '# comentario\nPOSTGRES_PASSWORD="mi_pg_clave"\nJAVA_BACKEND_PORT=8089\n',
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-userdata-test-'));
  try {
    const dotEnv = parseDotEnvContent(fs.readFileSync(path.join(composeDir, '.env'), 'utf8'));
    assert.equal(dotEnv.POSTGRES_PASSWORD, 'mi_pg_clave');
    assert.equal(dotEnv.JAVA_BACKEND_PORT, '8089');

    const first = loadOrCreateDesktopSecrets(userDataDir, dotEnv, {});
    assert.equal(first.envOverrides.POSTGRES_PASSWORD, undefined);
    assert.ok(first.envOverrides.INTERNAL_SERVICE_TOKEN.length >= 64);
    assert.ok(first.envOverrides.OMEGA_JWT_SECRET.length >= 64);
    assert.ok(first.envOverrides.OMEGA_BOOTSTRAP_SECRET.length >= 64);

    // Reutilizar mismos secretos entre reinicios para no invalidar JWTs emitidos
    const second = loadOrCreateDesktopSecrets(userDataDir, dotEnv, {});
    assert.equal(second.envOverrides.OMEGA_JWT_SECRET, first.envOverrides.OMEGA_JWT_SECRET);
    assert.equal(second.envOverrides.INTERNAL_SERVICE_TOKEN, first.envOverrides.INTERNAL_SERVICE_TOKEN);
  } finally {
    fs.rmSync(composeDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('parseComposePsOutput y buildComposeArgs manejan NDJSON/JSON y override prod.yml', () => {
  const composeDir = createTempComposeDir({ withProd: true });
  try {
    const stdArgs = buildComposeArgs(composeDir, { prodMode: false, subArgs: ['up', '-d'] });
    assert.equal(stdArgs.includes('-f'), true);
    assert.equal(stdArgs.some((a) => a.endsWith('docker-compose.prod.yml')), false);

    const prodArgs = buildComposeArgs(composeDir, { prodMode: true, subArgs: ['up', '-d'] });
    assert.equal(prodArgs.some((a) => a.endsWith('docker-compose.prod.yml')), true);

    const ndjson = [
      '{"Service":"postgres","State":"running","Health":"healthy"}',
      '{"Service":"forensic-worker","State":"running","Health":"starting"}',
      '{"Service":"backend-java","State":"created","Health":""}',
    ].join('\n');

    const parsed = parseComposePsOutput(ndjson);
    assert.equal(parsed.postgres.healthy, true);
    assert.equal(parsed['forensic-worker'].running, true);
    assert.equal(parsed['forensic-worker'].healthy, false);
    assert.equal(parsed['backend-java'].running, false);
  } finally {
    fs.rmSync(composeDir, { recursive: true, force: true });
  }
});

test('DockerOrchestrator no toma ownership ni ejecuta down si el backend ya estaba UP', async () => {
  const composeDir = createTempComposeDir();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-orch-ext-'));
  const dockerCalls = [];
  const states = [];

  try {
    const orchestrator = new DockerOrchestrator({
      userDataDir,
      electronDir: path.join(composeDir, 'frontend', 'electron'),
      findComposeRootFn: () => composeDir,
      probeHttpHealthFn: async () => ({ healthy: true, statusCode: 200 }),
      checkDockerFn: async () => {
        throw new Error('No debe exigir docker info si salud ya está UP');
      },
      runCommandFn: async (args) => {
        dockerCalls.push(args);
        return { code: 0, stdout: '', stderr: '' };
      },
      onStateChange: (s) => states.push(s.phase),
    });

    const res = await orchestrator.start();
    assert.equal(res.ok, true);
    assert.equal(res.alreadyRunning, true);
    assert.equal(orchestrator.shouldStopOnQuit(), false);

    const stopRes = await orchestrator.shutdownStack();
    assert.equal(stopRes.stopped, false);
    assert.equal(dockerCalls.some((a) => a.includes('down')), false);
    assert.equal(states.at(-1), 'ready');
  } finally {
    fs.rmSync(composeDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('DockerOrchestrator reporta error accionable si Docker Desktop está apagado', async () => {
  const composeDir = createTempComposeDir();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-orch-nodocker-'));

  try {
    const orchestrator = new DockerOrchestrator({
      userDataDir,
      electronDir: path.join(composeDir, 'frontend', 'electron'),
      findComposeRootFn: () => composeDir,
      probeHttpHealthFn: async () => ({ healthy: false, statusCode: 0 }),
      checkDockerFn: async () => {
        const err = new Error('Docker Desktop cerrado');
        err.code = 'DOCKER_DAEMON_DOWN';
        throw err;
      },
    });

    const res = await orchestrator.start();
    assert.equal(res.ok, false);
    assert.equal(res.errorCode, 'DOCKER_DAEMON_DOWN');
    assert.equal(orchestrator.getState().phase, 'error');
    assert.equal(orchestrator.getState().canRetry, true);
    assert.equal(orchestrator.shouldStopOnQuit(), false);
  } finally {
    fs.rmSync(composeDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('DockerOrchestrator levanta servicios backend, espera healthchecks y ejecuta down sin -v al cerrar', async () => {
  const composeDir = createTempComposeDir({ withProd: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-orch-full-'));
  const dockerCalls = [];
  let healthPollCount = 0;
  let upCalled = false;

  try {
    const orchestrator = new DockerOrchestrator({
      userDataDir,
      electronDir: path.join(composeDir, 'frontend', 'electron'),
      findComposeRootFn: () => composeDir,
      checkDockerFn: async () => {},
      sleepFn: async () => {},
      probeHttpHealthFn: async () => {
        healthPollCount += 1;
        if (healthPollCount >= 3) return { healthy: true, statusCode: 200 };
        return { healthy: false, statusCode: 0 };
      },
      runCommandFn: async (args, opts) => {
        dockerCalls.push({ args, env: opts?.env });
        if (args.includes('up')) {
          upCalled = true;
          opts?.onLine?.('Container omega_postgres Starting');
          return { code: 0, stdout: '', stderr: '' };
        }
        if (args.includes('ps')) {
          if (!upCalled) {
            return { code: 0, stdout: '', stderr: '' };
          }
          return {
            code: 0,
            stdout: [
              '{"Service":"postgres","State":"running","Health":"healthy"}',
              '{"Service":"forensic-worker","State":"running","Health":"healthy"}',
              '{"Service":"backend-java","State":"running","Health":"starting"}',
            ].join('\n'),
            stderr: '',
          };
        }
        if (args.includes('down')) {
          return { code: 0, stdout: '', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    const res = await orchestrator.start({ prodMode: true });
    assert.equal(res.ok, true);
    assert.equal(res.startedByElectron, true);
    assert.equal(orchestrator.shouldStopOnQuit(), true);
    assert.equal(orchestrator.getState().phase, 'ready');

    const upCall = dockerCalls.find((c) => c.args.includes('up'));
    assert.ok(upCall);
    assert.equal(upCall.args.includes('-d'), true);
    assert.equal(upCall.args.includes('frontend'), false);
    assert.equal(upCall.args.some((a) => a.endsWith('docker-compose.prod.yml')), true);
    assert.ok(upCall.env.INTERNAL_SERVICE_TOKEN.length >= 64);
    assert.ok(upCall.env.OMEGA_JWT_SECRET.length >= 64);

    const stopRes = await orchestrator.shutdownStack();
    assert.equal(stopRes.stopped, true);
    const downCall = dockerCalls.find((c) => c.args.includes('down'));
    assert.ok(downCall);
    assert.equal(downCall.args.includes('-v'), false);
    assert.equal(downCall.args.includes('--volumes'), false);
    assert.equal(orchestrator.shouldStopOnQuit(), false);
  } finally {
    fs.rmSync(composeDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('sanitizeLogLine redacta secretos antes de mostrar logs en la UI', () => {
  const clean = sanitizeLogLine('Error token super_secret_token_12345 failed', ['super_secret_token_12345']);
  assert.equal(clean.includes('super_secret_token_12345'), false);
  assert.equal(clean.includes('***'), true);
});
