import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildComposeArgs,
  DockerOrchestrator,
  loadOrCreateDesktopSecrets,
  maskSecretHint,
  parseComposePsOutput,
  parseDotEnvContent,
  readDotEnv,
  readRuntimeState,
  resolveComposeEnvFilePath,
  sanitizeLogLine,
  upsertDotEnvContent,
  writeRuntimeState,
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
    assert.equal(first.envOverrides.OMEGA_BOOTSTRAP_SECRET, undefined);

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

test('readDotEnv y resolveComposeEnvFilePath soportan .env opcional en userData para app empaquetada', () => {
  const composeDir = createTempComposeDir({ withProd: false, envContent: null });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-userdata-env-'));
  try {
    assert.equal(resolveComposeEnvFilePath(composeDir, userDataDir), null);

    const userEnvPath = path.join(userDataDir, '.env');
    fs.writeFileSync(userEnvPath, 'GROQ_API_KEY=gsk_test_value_12345\nJAVA_BACKEND_PORT=8091\n');

    const loaded = readDotEnv(composeDir, userDataDir);
    assert.equal(loaded.GROQ_API_KEY, 'gsk_test_value_12345');
    assert.equal(loaded.JAVA_BACKEND_PORT, '8091');

    const resolvedEnv = resolveComposeEnvFilePath(composeDir, userDataDir);
    assert.equal(resolvedEnv, userEnvPath);

    const args = buildComposeArgs(composeDir, {
      envFilePath: resolvedEnv,
      subArgs: ['up', '-d'],
    });
    const envFlagIdx = args.indexOf('--env-file');
    assert.ok(envFlagIdx >= 0);
    assert.equal(args[envFlagIdx + 1], userEnvPath);
  } finally {
    fs.rmSync(composeDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('DockerOrchestrator falla rápido con logs si un servicio entra en bucle restarting', async () => {
  const composeDir = createTempComposeDir();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-orch-restarting-'));

  try {
    const orchestrator = new DockerOrchestrator({
      userDataDir,
      electronDir: path.join(composeDir, 'frontend', 'electron'),
      findComposeRootFn: () => composeDir,
      probeHttpHealthFn: async () => ({ healthy: false, statusCode: 0 }),
      checkDockerFn: async () => {},
      pollIntervalMs: 5,
      startupTimeoutMs: 5000,
      runCommandFn: async (args) => {
        if (args.includes('ps')) {
          return {
            code: 0,
            stdout: [
              '{"Service":"postgres","State":"running","Health":"healthy"}',
              '{"Service":"forensic-worker","State":"running","Health":"healthy"}',
              '{"Service":"backend-java","State":"restarting","Health":""}',
            ].join('\n'),
            stderr: '',
          };
        }
        if (args.includes('logs')) {
          return {
            code: 0,
            stdout: 'FATAL: password authentication failed for user "omega_admin"',
            stderr: '',
          };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    const res = await orchestrator.start();
    assert.equal(res.ok, false);
    assert.equal(res.errorCode, 'SERVICE_UNHEALTHY');
    assert.match(orchestrator.getState().detail, /password authentication failed/i);
  } finally {
    fs.rmSync(composeDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('DockerOrchestrator reutiliza servicios cuando coincide la versión y reconstruye con --build al subir de 1.4.0 a 1.5.0', async () => {
  const composeDir = createTempComposeDir();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-orch-upgrade-'));
  const dockerCalls = [];

  try {
    writeRuntimeState(userDataDir, { lastVersion: '1.4.0' });

    // Caso 1: misma versión 1.4.0 con backend ya UP -> sigue adelante sin reconstruir
    const sameVer = new DockerOrchestrator({
      userDataDir,
      electronDir: path.join(composeDir, 'frontend', 'electron'),
      appVersion: '1.4.0',
      findComposeRootFn: () => composeDir,
      probeHttpHealthFn: async () => ({ healthy: true, statusCode: 200 }),
      runCommandFn: async (args) => {
        dockerCalls.push(args);
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const sameRes = await sameVer.start();
    assert.equal(sameRes.ok, true);
    assert.equal(sameRes.alreadyRunning, true);
    assert.equal(sameRes.upgraded, false);
    assert.equal(dockerCalls.some((a) => a.includes('--build')), false);

    // Caso 2: sube a 1.5.0 aunque 1.4.0 estuviera UP -> ejecuta up -d --build y actualiza estado a 1.5.0
    dockerCalls.length = 0;
    let probeCalls = 0;
    const upgraded = new DockerOrchestrator({
      userDataDir,
      electronDir: path.join(composeDir, 'frontend', 'electron'),
      appVersion: '1.5.0',
      findComposeRootFn: () => composeDir,
      pollIntervalMs: 5,
      checkDockerFn: async () => {},
      probeHttpHealthFn: async () => {
        probeCalls += 1;
        // 1a sonda pre-check responde UP (v1.4.0 viejo); tras up -d --build responde UP (v1.5.0)
        return { healthy: probeCalls !== 2, statusCode: 200 };
      },
      runCommandFn: async (args) => {
        dockerCalls.push(args);
        if (args.includes('ps')) {
          return {
            code: 0,
            stdout: [
              '{"Service":"postgres","State":"running","Health":"healthy"}',
              '{"Service":"forensic-worker","State":"running","Health":"healthy"}',
              '{"Service":"backend-java","State":"running","Health":"healthy"}',
            ].join('\n'),
            stderr: '',
          };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const upRes = await upgraded.start();
    assert.equal(upRes.ok, true);
    assert.equal(upRes.upgraded, true);
    assert.equal(dockerCalls.some((a) => a.includes('up') && a.includes('--build')), true);
    assert.equal(readRuntimeState(userDataDir).lastVersion, '1.5.0');
  } finally {
    fs.rmSync(composeDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('DockerOrchestrator activa perfil omniroute automáticamente cuando OMNIROUTE_BASE_URL apunta al servicio', async () => {
  const composeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-omni-compose-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-omni-ud-'));
  let capturedEnv = null;
  let started = false;
  try {
    fs.mkdirSync(path.join(composeDir, 'frontend', 'electron'), { recursive: true });
    fs.writeFileSync(path.join(composeDir, 'docker-compose.yml'), 'services:\n  backend-java: {}\n');
    fs.writeFileSync(
      path.join(composeDir, '.env'),
      'OMNIROUTE_BASE_URL=http://omniroute:20128/v1\nOMNIROUTE_MODEL=auto\n',
    );
    const orchestrator = new DockerOrchestrator({
      userDataDir,
      electronDir: path.join(composeDir, 'frontend', 'electron'),
      findComposeRootFn: () => composeDir,
      pollIntervalMs: 5,
      checkDockerFn: async () => {},
      probeHttpHealthFn: async () => ({ healthy: started, statusCode: started ? 200 : 0 }),
      runCommandFn: async (args, opts) => {
        capturedEnv = opts?.env || null;
        if (args.includes('up')) {
          started = true;
        }
        return {
          code: 0,
          stdout: [
            '{"Service":"postgres","State":"running","Health":"healthy"}',
            '{"Service":"forensic-worker","State":"running","Health":"healthy"}',
            '{"Service":"backend-java","State":"running","Health":"healthy"}',
          ].join('\n'),
          stderr: '',
        };
      },
    });
    const res = await orchestrator.start();
    assert.equal(res.ok, true);
    assert.equal(capturedEnv?.COMPOSE_PROFILES, 'omniroute');
  } finally {
    fs.rmSync(composeDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('upsertDotEnvContent sanitiza inyección de líneas y maskSecretHint enmascara API keys', () => {
  const original = '# Comentario\nPOSTGRES_PASSWORD=keep_secret\nGROQ_API_KEY=gsk_oldkey1234\n';
  const next = upsertDotEnvContent(original, {
    GROQ_API_KEY: 'gsk_newkey5678\nEVIL_KEY=injected',
    GROQ_MODEL: 'openai/gpt-oss-120b',
    OMNIROUTE_BASE_URL: null,
  });
  const parsed = parseDotEnvContent(next);
  assert.equal(parsed.POSTGRES_PASSWORD, 'keep_secret');
  assert.equal(parsed.GROQ_API_KEY, 'gsk_newkey5678EVIL_KEY=injected');
  assert.equal(parsed.EVIL_KEY, undefined);
  assert.equal(parsed.GROQ_MODEL, 'openai/gpt-oss-120b');
  assert.equal(maskSecretHint('gsk_abc12345wxyz'), 'gsk_••••wxyz');
  assert.equal(maskSecretHint(''), '');
});

test('reapplyAiConfig persiste clave Groq en userData/.env y recarga backend-java', async () => {
  const composeDir = createTempComposeDir({ envContent: null });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-ai-ud-'));
  const dockerCalls = [];
  try {
    const orchestrator = new DockerOrchestrator({
      userDataDir,
      electronDir: path.join(composeDir, 'frontend', 'electron'),
      findComposeRootFn: () => composeDir,
      pollIntervalMs: 5,
      checkDockerFn: async () => {},
      probeHttpHealthFn: async () => ({ healthy: true, statusCode: 200 }),
      runCommandFn: async (args) => {
        dockerCalls.push(args);
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const res = await orchestrator.reapplyAiConfig({
      groqApiKey: 'gsk_testvalue9999',
      groqModel: 'llama-3.3-70b-versatile',
    });
    assert.equal(res.ok, true);
    assert.equal(res.config.groqConfigured, true);
    assert.equal(res.config.groqHint, 'gsk_••••9999');
    assert.equal(res.config.activeProvider, 'groq');
    assert.equal(dockerCalls.some((a) => a.includes('up') && a.includes('backend-java')), true);
  } finally {
    fs.rmSync(composeDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
