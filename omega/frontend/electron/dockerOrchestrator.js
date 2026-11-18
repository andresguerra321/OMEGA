import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { inspectDesktopEnvironment } from './dockerPreflight.js';

const execFileAsync = promisify(execFile);

export const BACKEND_SERVICES = ['postgres', 'forensic-worker', 'backend-java'];
const DEFAULT_SECRETS_FILENAME = 'omega-desktop-secrets.json';
const runtimeSecrets = new Map();
const DEFAULT_RUNTIME_STATE_FILENAME = 'omega-desktop-state.json';
const HEALTHCHECK_POLL_MS = 1000;
const STARTUP_TIMEOUT_MS = 180_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;

export function readRuntimeState(userDataDir) {
  if (!userDataDir) return {};
  const statePath = path.join(userDataDir, DEFAULT_RUNTIME_STATE_FILENAME);
  if (!fs.existsSync(statePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeRuntimeState(userDataDir, patch = {}) {
  if (!userDataDir) return null;
  const statePath = path.join(userDataDir, DEFAULT_RUNTIME_STATE_FILENAME);
  const next = {
    ...readRuntimeState(userDataDir),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // No bloquear arranque si userData es de solo lectura
  }
  return next;
}

export function parseDotEnvContent(rawText) {
  const result = {};
  if (!rawText || typeof rawText !== 'string') return result;
  for (const rawLine of rawLineSplit(rawText)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

function rawLineSplit(text) {
  return text.split(/\r?\n/);
}

function readDotEnvFile(envPath) {
  if (!envPath) return {};
  try {
    if (!fs.existsSync(envPath)) return {};
    return parseDotEnvContent(fs.readFileSync(envPath, 'utf8'));
  } catch {
    return {};
  }
}

const sensitiveEnvKey = (key) => /(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(key);

function readProtectedEnv(userDataDir, storage) {
  const file = path.join(userDataDir, 'omega-protected-env.json');
  return fs.existsSync(file) ? JSON.parse(storage.decrypt(JSON.parse(fs.readFileSync(file, 'utf8')).ciphertext)) : {};
}

function writeProtectedEnv(userDataDir, storage, values) {
  fs.mkdirSync(userDataDir, { recursive: true });
  atomicPrivateWrite(path.join(userDataDir, 'omega-protected-env.json'), JSON.stringify({ version: 1,
    ciphertext: storage.encrypt(JSON.stringify(values)) }));
}

function atomicPrivateWrite(file, content) {
  const temporary = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function readDotEnv(composeRoot, userDataDir = null, storage = null) {
  const baseEnv = composeRoot ? readDotEnvFile(path.join(composeRoot, '.env')) : {};
  const userEnv = userDataDir ? readDotEnvFile(path.join(userDataDir, '.env')) : {};
  const merged = { ...baseEnv, ...userEnv };
  if (!storage || !userDataDir) return merged;
  const protectedValues = readProtectedEnv(userDataDir, storage);
  const removals = {};
  for (const [key, value] of Object.entries(merged)) {
    if (!sensitiveEnvKey(key)) continue;
    if (key !== 'INTERNAL_SERVICE_TOKEN') protectedValues[key] = value;
    removals[key] = null;
  }
  delete protectedValues.INTERNAL_SERVICE_TOKEN;
  if (Object.keys(removals).length) {
    writeProtectedEnv(userDataDir, storage, protectedValues);
    for (const directory of [composeRoot, userDataDir].filter(Boolean)) {
      const file = path.join(directory, '.env');
      if (fs.existsSync(file) && !writeDotEnvUpdates(file, removals)) throw new Error('No se pudieron retirar credenciales heredadas de .env');
    }
  }
  delete merged.INTERNAL_SERVICE_TOKEN;
  return { ...merged, ...protectedValues };
}

export function resolveComposeEnvFilePath(composeRoot, userDataDir = null) {
  if (composeRoot && fs.existsSync(path.join(composeRoot, '.env'))) {
    return null;
  }
  if (userDataDir) {
    const userEnvPath = path.join(userDataDir, '.env');
    if (fs.existsSync(userEnvPath)) {
      return userEnvPath;
    }
  }
  return null;
}

export function maskSecretHint(secret) {
  const clean = String(secret || '').trim();
  if (!clean) return '';
  if (clean.length <= 8) return '••••••••';
  const prefix = clean.startsWith('gsk_') ? 'gsk_' : clean.startsWith('sk-') ? 'sk-' : '';
  return `${prefix}••••${clean.slice(-4)}`;
}

export function sanitizeDotEnvValue(raw) {
  return String(raw ?? '')
    .replace(/[\r\n\0]/g, '')
    .trim();
}

export function upsertDotEnvContent(rawText, updates = {}) {
  const lines = rawText ? rawLineSplit(rawText) : [];
  const remaining = new Map();
  for (const [k, v] of Object.entries(updates)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    remaining.set(k, v === null ? null : sanitizeDotEnvValue(v));
  }

  const nextLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const eqIdx = trimmed.indexOf('=');
    if (!trimmed || trimmed.startsWith('#') || eqIdx <= 0) {
      nextLines.push(line);
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    if (!remaining.has(key)) {
      nextLines.push(line);
      continue;
    }
    const nextVal = remaining.get(key);
    remaining.delete(key);
    if (nextVal !== null && nextVal !== '') {
      nextLines.push(`${key}=${nextVal}`);
    }
  }

  for (const [key, val] of remaining.entries()) {
    if (val !== null && val !== '') {
      nextLines.push(`${key}=${val}`);
    }
  }

  return `${nextLines.join('\n').replace(/\n+$/, '')}\n`;
}

function writeDotEnvUpdates(envPath, updates) {
  if (!envPath) return false;
  try {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const next = upsertDotEnvContent(existing, updates);
    fs.writeFileSync(envPath, next, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export function findComposeRoot(electronDir, processEnv = process.env, resourcesPath = process.resourcesPath) {
  const candidates = [
    processEnv?.OMEGA_COMPOSE_DIR,
    electronDir ? path.resolve(electronDir, '..', '..') : null,
    resourcesPath ? path.join(resourcesPath, 'omega') : null,
    resourcesPath || null,
  ].filter(Boolean);

  for (const dir of candidates) {
    const resolved = path.resolve(dir);
    if (fs.existsSync(path.join(resolved, 'docker-compose.yml'))) {
      return resolved;
    }
  }
  return null;
}

export function loadOrCreateDesktopSecrets(userDataDir, dotEnv = {}, processEnv = process.env, storage = null, { persist = true } = {}) {
  const secretsPath = userDataDir ? path.join(userDataDir, DEFAULT_SECRETS_FILENAME) : null;
  const cacheKey = userDataDir || '<volatile>';
  let stored = runtimeSecrets.get(cacheKey);
  if (!stored) {
    stored = {};
    if (secretsPath && fs.existsSync(secretsPath)) {
      const raw = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
      if (raw.version === 2) {
        if (!storage) throw new Error('Se requiere el almac?n seguro del sistema');
        stored = JSON.parse(storage.decrypt(raw.ciphertext));
      } else {
        if (!storage) throw new Error('Migra los secretos existentes con safeStorage');
        // Migrate only durable database/JWT keys; discard the legacy IPC credential.
        for (const key of ['POSTGRES_PASSWORD', 'OMEGA_JWT_SECRET']) {
          if (typeof raw[key] === 'string') stored[key] = raw[key];
        }
      }
    }
    stored.INTERNAL_SERVICE_TOKEN = crypto.randomBytes(32).toString('hex');
    runtimeSecrets.set(cacheKey, stored);
  }
  const generatedEnv = { INTERNAL_SERVICE_TOKEN: stored.INTERNAL_SERVICE_TOKEN };
  const databasePasswordKnown = Boolean(processEnv.POSTGRES_PASSWORD || dotEnv.POSTGRES_PASSWORD ||
    (stored.POSTGRES_PASSWORD && !stored.databasePasswordGenerated));
  for (const key of ['OMEGA_JWT_SECRET', 'POSTGRES_PASSWORD']) {
    if (processEnv?.[key] || dotEnv?.[key]) continue;
    if (!stored[key]) {
      stored[key] = crypto.randomBytes(32).toString('hex');
      if (key === 'POSTGRES_PASSWORD') stored.databasePasswordGenerated = true;
    }
    generatedEnv[key] = stored[key];
  }
  if (persist && storage && secretsPath) {
    const { INTERNAL_SERVICE_TOKEN: _ephemeral, ...durable } = stored;
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    atomicPrivateWrite(secretsPath, JSON.stringify({ version: 2, ciphertext: storage.encrypt(JSON.stringify(durable)) }));
  }
  return { envOverrides: generatedEnv, secretsPath, generatedKeys: Object.keys(generatedEnv), databasePasswordKnown };
}

export function parseComposePsOutput(stdout) {
  const services = Object.fromEntries(
    BACKEND_SERVICES.map((name) => [
      name,
      { service: name, state: 'absent', health: 'unknown', running: false, healthy: false },
    ]),
  );

  const trimmed = String(stdout || '').trim();
  if (!trimmed) return services;

  let records = [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) records = parsed;
    } catch {
      records = [];
    }
  } else {
    for (const line of rawLineSplit(trimmed)) {
      const clean = line.trim();
      if (!clean.startsWith('{')) continue;
      try {
        records.push(JSON.parse(clean));
      } catch {
        // Ignorar líneas no JSON
      }
    }
  }

  for (const rec of records) {
    const svc = String(rec.Service || rec.service || '').trim();
    if (!services[svc]) continue;
    const state = String(rec.State || rec.state || 'unknown').toLowerCase();
    const health = String(rec.Health || rec.health || '').toLowerCase() || 'unknown';
    const running = state === 'running';
    const healthy = running && health === 'healthy';
    services[svc] = { service: svc, state, health, running, healthy };
  }

  return services;
}

export function buildComposeArgs(
  composeRoot,
  { prodMode = false, envFilePath = null, subArgs = [] } = {},
) {
  const baseFile = path.join(composeRoot, 'docker-compose.yml');
  const prodFile = path.join(composeRoot, 'docker-compose.prod.yml');
  const args = ['compose', '--project-directory', composeRoot];
  if (envFilePath && fs.existsSync(envFilePath)) {
    args.push('--env-file', envFilePath);
  }
  args.push('-f', baseFile);
  if (prodMode && fs.existsSync(prodFile)) {
    args.push('-f', prodFile);
  }
  return [...args, ...subArgs];
}

export function sanitizeLogLine(line, secretValues = []) {
  let clean = String(line || '').replace(/\r/g, '').trim();
  if (!clean) return '';
  for (const secret of secretValues) {
    if (secret && secret.length >= 8 && clean.includes(secret)) {
      clean = clean.split(secret).join('***');
    }
  }
  return clean.length > 180 ? `${clean.slice(0, 177)}...` : clean;
}

export function probeBackendHttpHealth(port = 8080, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: '/actuator/health',
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length < 4096) body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve({ healthy: false, statusCode: res.statusCode });
            return;
          }
          try {
            const parsed = JSON.parse(body);
            resolve({ healthy: parsed?.status === 'UP', statusCode: 200 });
          } catch {
            resolve({ healthy: false, statusCode: 200 });
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ healthy: false, statusCode: 0 });
    });
    req.on('error', () => {
      resolve({ healthy: false, statusCode: 0 });
    });
  });
}

export async function checkDockerAvailability(run = execFileAsync) {
  try {
    await run('docker', ['--version'], { timeout: 4000, windowsHide: true });
  } catch (err) {
    if (err?.code === 'ENOENT') {
      const error = new Error('Docker CLI no está instalado en este equipo.');
      error.code = 'DOCKER_CLI_MISSING';
      throw error;
    }
    const error = new Error(`No se pudo consultar Docker CLI: ${err?.message || err}`);
    error.code = 'DOCKER_CLI_ERROR';
    throw error;
  }

  try {
    const result = await run('docker', ['info', '--format', '{{.OSType}}'], {
      timeout: 15000,
      windowsHide: true,
    });
    if (result.stdout.trim() !== 'linux') {
      throw Object.assign(new Error('OMEGA necesita el modo Linux containers de Docker Desktop. Cambia ese modo y pulsa Reintentar.'), { code: 'DOCKER_WRONG_ENGINE' });
    }
  } catch (err) {
    if (err.code === 'DOCKER_WRONG_ENGINE') throw err;
    const error = new Error(
      'Docker Desktop o el daemon de Docker no está ejecutándose. Ábrelo y vuelve a intentarlo.',
    );
    error.code = 'DOCKER_DAEMON_DOWN';
    error.detail = err?.stderr ? String(err.stderr).trim() : err?.message;
    throw error;
  }
  try { await run('docker', ['compose', 'version', '--short'], { timeout: 5000, windowsHide: true }); }
  catch { throw Object.assign(new Error('Docker Compose no está disponible. Actualiza Docker Desktop y pulsa Reintentar.'), { code: 'DOCKER_COMPOSE_MISSING' }); }
}

function defaultRunCommand(args, { cwd, env, timeoutMs = 120_000, onLine, inputText } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      cwd,
      env,
      windowsHide: true,
      stdio: [inputText === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    if (inputText !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(inputText); }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, timeoutMs)
      : null;

    const handleChunk = (chunk, target) => {
      const text = chunk.toString('utf8');
      if (target === 'stdout') stdout += text;
      else stderr += text;
      if (onLine) {
        for (const line of rawLineSplit(text)) {
          if (line.trim()) onLine(line);
        }
      }
    };

    child.stdout?.on('data', (c) => handleChunk(c, 'stdout'));
    child.stderr?.on('data', (c) => handleChunk(c, 'stderr'));

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        const err = new Error(`El comando docker ${args.slice(0, 3).join(' ')} excedió el tiempo límite.`);
        err.code = 'DOCKER_TIMEOUT';
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createInitialServicesMap(allHealthy = false) {
  return Object.fromEntries(
    BACKEND_SERVICES.map((name) => [
      name,
      {
        service: name,
        state: allHealthy ? 'running' : 'pending',
        health: allHealthy ? 'healthy' : 'unknown',
        running: allHealthy,
        healthy: allHealthy,
      },
    ]),
  );
}

export class DockerOrchestrator {
  constructor({
    userDataDir,
    electronDir,
    onStateChange,
    probeHttpHealthFn = probeBackendHttpHealth,
    checkDockerFn = checkDockerAvailability,
    runCommandFn = defaultRunCommand,
    sleepFn = defaultSleep,
    findComposeRootFn = findComposeRoot,
    appVersion = null,
    secretStorage = null,
    runtimeEnvOverrides = {},
    preflightFn = inspectDesktopEnvironment,
    startupTimeoutMs = STARTUP_TIMEOUT_MS,
    pollIntervalMs = HEALTHCHECK_POLL_MS,
  }) {
    this.userDataDir = userDataDir;
    this.secretStorage = secretStorage;
    this.runtimeEnvOverrides = runtimeEnvOverrides;
    this.preflightFn = preflightFn;
    this.servicesStarted = [];
    this.electronDir = electronDir;
    this.appVersion = appVersion ? String(appVersion).trim() : null;
    this.onStateChange = typeof onStateChange === 'function' ? onStateChange : () => {};
    this.probeHttpHealthFn = probeHttpHealthFn;
    this.checkDockerFn = checkDockerFn;
    this.runCommandFn = runCommandFn;
    this.sleepFn = sleepFn;
    this.findComposeRootFn = findComposeRootFn;
    this.startupTimeoutMs = startupTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;

    this.startedByElectron = false;
    this.activeComposeRoot = null;
    this.activeEnvFilePath = null;
    this.activeChildEnv = null;
    this.prodMode = process.env.OMEGA_DESKTOP_PROD === '1';
    this.aborted = false;
    this.inFlight = null;
    this.shutdownPromise = null;
    this.secretValues = [];

    this.state = {
      phase: 'idle',
      message: 'Preparando arranque de OMEGA…',
      detail: '',
      errorCode: null,
      canRetry: false,
      prodMode: this.prodMode,
      startedByElectron: false,
      alreadyRunning: false,
      secretsGenerated: false,
      services: createInitialServicesMap(false),
      logLines: [],
    };
  }

  getState() {
    return {
      backendPort: Number(this.activeChildEnv?.JAVA_BACKEND_PORT || 8080),
      ...this.state,
      services: { ...this.state.services },
      logLines: [...this.state.logLines],
    };
  }

  shouldStopOnQuit() {
    return Boolean(this.startedByElectron && this.activeComposeRoot);
  }

  abortStartup() {
    this.aborted = true;
  }

  #updateState(patch) {
    this.state = {
      ...this.state,
      ...patch,
      startedByElectron: this.startedByElectron,
      prodMode: this.prodMode,
    };
    this.onStateChange(this.getState());
  }

  #pushLog(line) {
    const clean = sanitizeLogLine(line, this.secretValues);
    if (!clean) return;
    const next = [...this.state.logLines, clean].slice(-10);
    this.#updateState({ logLines: next });
  }

  async #inspectComposePs(composeRoot, prodMode, childEnv) {
    try {
      const args = buildComposeArgs(composeRoot, {
        prodMode,
        envFilePath: this.activeEnvFilePath,
        subArgs: ['ps', '--all', '--format', 'json', ...BACKEND_SERVICES],
      });
      const res = await this.runCommandFn(args, {
        cwd: composeRoot,
        env: childEnv,
        timeoutMs: 8000,
      });
      if (res.code === 0) {
        return parseComposePsOutput(res.stdout);
      }
    } catch {
      // No fatal durante sondeo de estado
    }
    return null;
  }

  async #collectFailureTail(composeRoot, prodMode, childEnv, serviceName) {
    try {
      const args = buildComposeArgs(composeRoot, {
        prodMode,
        envFilePath: this.activeEnvFilePath,
        subArgs: ['logs', '--no-color', '--tail=10', serviceName],
      });
      const res = await this.runCommandFn(args, {
        cwd: composeRoot,
        env: childEnv,
        timeoutMs: 6000,
      });
      const lines = rawLineSplit(res.stdout || res.stderr || '')
        .map((l) => sanitizeLogLine(l, this.secretValues))
        .filter(Boolean);
      return lines.slice(-6).join('\n');
    } catch {
      return '';
    }
  }

  start({ prodMode } = {}) {
    if (this.inFlight) return this.inFlight;
    if (typeof prodMode === 'boolean') {
      this.prodMode = prodMode;
    }
    this.aborted = false;
    this.inFlight = this.#executeStart().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async #executeStart() {
    const composeRoot = this.findComposeRootFn(this.electronDir);
    const dotEnv = readDotEnv(composeRoot, this.userDataDir, this.secretStorage);
    const envFilePath = resolveComposeEnvFilePath(composeRoot, this.userDataDir);
    let javaPort = Number(process.env.JAVA_BACKEND_PORT || dotEnv.JAVA_BACKEND_PORT || 8080);
    const runtimeState = readRuntimeState(this.userDataDir);
    const previousVersion = runtimeState?.lastVersion ? String(runtimeState.lastVersion).trim() : null;
    let isAppUpgrade = Boolean(this.appVersion && previousVersion && previousVersion !== this.appVersion);

    this.#updateState({
      phase: 'checking_existing',
      message: 'Comprobando si OMEGA ya está en ejecución…',
      detail: isAppUpgrade
        ? `Actualización detectada (${previousVersion} → ${this.appVersion}): validando contenedores existentes.`
        : '',
      errorCode: null,
      canRetry: false,
      alreadyRunning: false,
      services: createInitialServicesMap(false),
      logLines: [],
    });

    if (!composeRoot) {
      this.#updateState({
        phase: 'error',
        message: 'No se encontró docker-compose.yml de OMEGA.',
        detail: 'Verifica la carpeta del proyecto o define OMEGA_COMPOSE_DIR.',
        errorCode: 'COMPOSE_NOT_FOUND',
        canRetry: true,
      });
      return { ok: false, errorCode: 'COMPOSE_NOT_FOUND' };
    }

    // 2. Verificar Docker CLI + Daemon encendido
    this.#updateState({
      phase: 'checking_docker',
      message: 'Verificando Docker Engine…',
      detail: 'Comprobando que Docker Desktop o el motor local esté activo.',
    });
    try {
      await this.checkDockerFn();
    } catch (err) {
      this.#updateState({
        phase: 'error',
        message: err?.message || 'Docker no está disponible.',
        detail: err?.message || 'Inicia Docker Desktop y espera unos segundos antes de pulsar Reintentar.',
        errorCode: err?.code || 'DOCKER_DAEMON_DOWN',
        canRetry: true,
      });
      return { ok: false, errorCode: err?.code || 'DOCKER_DAEMON_DOWN' };
    }

    if (this.aborted) {
      return { ok: false, aborted: true };
    }

    // 3. Preparar secretos criptográficos en userData (sin alterar .env existente)
    const secretsResult = loadOrCreateDesktopSecrets(this.userDataDir, dotEnv, process.env, this.secretStorage, { persist: false });
    this.secretValues = [
      ...Object.values(this.runtimeEnvOverrides),
      ...Object.values(secretsResult.envOverrides),
      dotEnv.POSTGRES_PASSWORD,
      dotEnv.INTERNAL_SERVICE_TOKEN,
      dotEnv.OMEGA_JWT_SECRET,
      dotEnv.OMEGA_BOOTSTRAP_SECRET,
      dotEnv.GROQ_API_KEY,
      dotEnv.OPENAI_API_KEY,
      dotEnv.OMNIROUTE_API_KEY,
      dotEnv.CUSTOM_LLM_API_KEY,
    ].filter(Boolean);

    let childEnv = {
      ...dotEnv,
      ...process.env,
      ...secretsResult.envOverrides,
      ...this.runtimeEnvOverrides,
    };

    let inspected;
    try {
      inspected = await this.preflightFn({ env: { ...childEnv,
        OMEGA_DESKTOP_VERSION: this.appVersion || '', OMEGA_DATABASE_PASSWORD_KNOWN: secretsResult.databasePasswordKnown },
        run: this.runCommandFn, runtimeState });
    } catch (error) {
      this.#updateState({ phase: 'error', message: error.message, detail: error.message,
        errorCode: error.code || 'DOCKER_INSPECTION_FAILED', canRetry: true });
      return { ok: false, errorCode: error.code || 'DOCKER_INSPECTION_FAILED' };
    }
    childEnv = inspected.env;
    javaPort = inspected.backendPort;
    isAppUpgrade ||= inspected.versionMismatch;
    this.secretValues.push(childEnv.POSTGRES_PASSWORD, childEnv.OMEGA_JWT_SECRET);
    this.activeComposeRoot = composeRoot;
    this.activeEnvFilePath = envFilePath;
    this.activeChildEnv = childEnv;
    const cached = runtimeSecrets.get(this.userDataDir || '<volatile>');
    cached.POSTGRES_PASSWORD = childEnv.POSTGRES_PASSWORD;
    cached.OMEGA_JWT_SECRET = childEnv.OMEGA_JWT_SECRET;
    cached.databasePasswordGenerated = false;
    if (this.secretStorage && (inspected.recoveredDatabase || inspected.recoveredGateway)) {
      writeProtectedEnv(this.userDataDir, this.secretStorage, {
        ...readProtectedEnv(this.userDataDir, this.secretStorage), ...inspected.recoveredDatabase, ...inspected.recoveredGateway,
      });
    }
    loadOrCreateDesktopSecrets(this.userDataDir, childEnv, {}, this.secretStorage);
    writeRuntimeState(this.userDataDir, { composeProject: inspected.project,
      databaseVolume: inspected.volumeName, backendPort: javaPort });
    const preHealth = await this.probeHttpHealthFn(javaPort, 2000);
    if (inspected.canReuse && preHealth.healthy && !isAppUpgrade && Object.keys(this.runtimeEnvOverrides).length === 0) {
      this.startedByElectron = this.servicesStarted.length > 0;
      if (this.appVersion) writeRuntimeState(this.userDataDir, { lastVersion: this.appVersion });
      this.#updateState({ phase: 'ready', message: 'Servicios de OMEGA activos.',
        detail: 'Se comprobó y reutilizó tu instalación existente.', alreadyRunning: true,
        services: createInitialServicesMap(true) });
      return { ok: true, alreadyRunning: true, startedByElectron: this.startedByElectron, upgraded: false };
    }
    if (this.aborted) return { ok: false, aborted: true };
    for (const container of inspected.containers.filter(item => item.state === 'paused')) {
      const resumed = await this.runCommandFn(['unpause', container.id], { env: childEnv, timeoutMs: 15000 });
      if (resumed.code !== 0) {
        this.#updateState({ phase: 'error', message: 'No se pudo reanudar un servicio de OMEGA.', errorCode: 'CONTAINER_PAUSED', canRetry: true });
        return { ok: false, errorCode: 'CONTAINER_PAUSED' };
      }
    }

    const wantsOmniRoute =
      String(childEnv.OMNIROUTE_ENABLED || '').toLowerCase() === 'true' ||
      String(childEnv.OMNIROUTE_BASE_URL || '').includes('omniroute:20128');
    if (wantsOmniRoute) {
      const existingProfiles = String(childEnv.COMPOSE_PROFILES || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!existingProfiles.includes('omniroute')) {
        childEnv.COMPOSE_PROFILES = [...existingProfiles, 'omniroute'].join(',');
      }
    }
    this.activeComposeRoot = composeRoot;
    this.activeEnvFilePath = envFilePath;
    this.activeChildEnv = childEnv;

    // Determinar si alguno de los servicios backend ya estaba corriendo antes de invocar up -d
    const prePs = await this.#inspectComposePs(composeRoot, this.prodMode, childEnv);
    const requestedServices = wantsOmniRoute ? [...BACKEND_SERVICES, 'omniroute'] : BACKEND_SERVICES;
    const alreadyRunning = new Set(inspected.containers.filter(item => item.state === 'running').map(item => item.service));
    this.servicesStarted = [...new Set([...this.servicesStarted, ...requestedServices.filter(service => !alreadyRunning.has(service))])];
    this.startedByElectron = this.servicesStarted.length > 0;

    this.#updateState({
      phase: 'starting_containers',
      message: isAppUpgrade
        ? `Actualizando servicios a OMEGA v${this.appVersion}…`
        : 'Iniciando servicios de OMEGA…',
      detail: isAppUpgrade
        ? `Reconstruyendo imágenes sobre datos persistentes (${previousVersion} → ${this.appVersion})…`
        : this.prodMode
          ? 'Perfil producción activo (docker-compose.yml + docker-compose.prod.yml).'
          : 'Levantando PostgreSQL pgvector, worker forense y núcleo Java…',
      secretsGenerated: secretsResult.generatedKeys.length > 0,
      services: prePs || createInitialServicesMap(false),
    });

    const upSubArgs = isAppUpgrade
      ? ['up', '-d', '--build', ...requestedServices]
      : ['up', '-d', ...requestedServices];

    const upArgs = buildComposeArgs(composeRoot, {
      prodMode: this.prodMode,
      envFilePath,
      subArgs: upSubArgs,
    });

    const upResult = await this.runCommandFn(upArgs, {
      cwd: composeRoot,
      env: childEnv,
      timeoutMs: isAppUpgrade ? 600_000 : 180_000,
      onLine: (line) => this.#pushLog(line),
    }).catch((err) => ({
      code: 1,
      stderr: err?.message || String(err),
      stdout: '',
    }));

    if (this.aborted) {
      return { ok: false, aborted: true };
    }

    if (upResult.code !== 0) {
      const detail = sanitizeLogLine(upResult.stderr || upResult.stdout, this.secretValues);
      this.#updateState({
        phase: 'error',
        message: 'No se pudieron iniciar los contenedores de OMEGA.',
        detail: detail || 'Revisa que los puertos 8080/5432 estén libres y Docker tenga recursos suficientes.',
        errorCode: 'COMPOSE_UP_FAILED',
        canRetry: true,
      });
      return { ok: false, errorCode: 'COMPOSE_UP_FAILED' };
    }

    // 4. Esperar healthchecks de postgres -> forensic-worker -> backend-java (:8080/actuator/health)
    return this.#waitForHealthchecks(composeRoot, childEnv, javaPort, { upgraded: isAppUpgrade });
  }

  async #waitForHealthchecks(composeRoot, childEnv, javaPort, { upgraded = false } = {}) {
    const deadline = Date.now() + this.startupTimeoutMs;

    while (!this.aborted && Date.now() < deadline) {
      const psMap = await this.#inspectComposePs(composeRoot, this.prodMode, childEnv);
      const httpProbe = await this.probeHttpHealthFn(javaPort, 1500);

      if (psMap) {
        const failedSvc = BACKEND_SERVICES.find(
          (svc) =>
            psMap[svc]?.state === 'exited' ||
            psMap[svc]?.state === 'dead' ||
            psMap[svc]?.state === 'restarting' ||
            psMap[svc]?.health === 'unhealthy',
        );
        if (failedSvc) {
          const tail = await this.#collectFailureTail(composeRoot, this.prodMode, childEnv, failedSvc);
          const credentialFailure = /password authentication failed for user/i.test(tail);
          const errorCode = credentialFailure ? 'DATABASE_AUTH_FAILED' : 'SERVICE_UNHEALTHY';
          this.#updateState({
            phase: 'error',
            message: credentialFailure ? 'No se pudo autenticar la base existente. Tus datos están intactos.' : `El servicio "${failedSvc}" falló durante el arranque.`,
            detail: tail || `Estado reportado: ${psMap[failedSvc].state} (${psMap[failedSvc].health}).`,
            errorCode,
            canRetry: true,
            services: psMap,
          });
          return { ok: false, errorCode };
        }
      }

      if (httpProbe.healthy && psMap && BACKEND_SERVICES.every(service => psMap[service]?.healthy)) {
        const finalServices = psMap || createInitialServicesMap(true);
        finalServices['backend-java'] = {
          ...finalServices['backend-java'],
          state: 'running',
          health: 'healthy',
          running: true,
          healthy: true,
        };
        if (this.appVersion) {
          writeRuntimeState(this.userDataDir, { lastVersion: this.appVersion });
        }
        this.#updateState({
          phase: 'ready',
          message: 'Servicios de OMEGA listos.',
          detail: upgraded
            ? `Servicios actualizados a v${this.appVersion} en 127.0.0.1:${javaPort} conservando tus datos.`
            : `Núcleo Java operativo en 127.0.0.1:${javaPort}.`,
          services: finalServices,
        });
        return { ok: true, alreadyRunning: false, startedByElectron: this.startedByElectron, upgraded };
      }

      const progressMsg = this.#describeWaitingPhase(psMap);
      this.#updateState({
        phase: 'waiting_healthchecks',
        message: 'Iniciando servicios de OMEGA…',
        detail: progressMsg,
        services: psMap || this.state.services,
      });

      await this.sleepFn(this.pollIntervalMs);
    }

    if (this.aborted) {
      return { ok: false, aborted: true };
    }

    this.#updateState({
      phase: 'error',
      message: 'Tiempo de espera agotado esperando los healthchecks de OMEGA.',
      detail: 'Algunos contenedores tardaron más de lo esperado en responder. Puedes reintentar.',
      errorCode: 'HEALTHCHECK_TIMEOUT',
      canRetry: true,
    });
    return { ok: false, errorCode: 'HEALTHCHECK_TIMEOUT' };
  }

  #describeWaitingPhase(psMap) {
    if (!psMap) return 'Esperando confirmación de los contenedores locales…';
    if (!psMap.postgres?.healthy) return 'Iniciando base de datos PostgreSQL 16 (pgvector)…';
    if (!psMap['forensic-worker']?.healthy) return 'Iniciando worker forense stateless (FastAPI)…';
    return 'Esperando healthcheck del núcleo Java (:8080/actuator/health)…';
  }

  getAiEngineConfig() {
    const composeRoot = this.findComposeRootFn(this.electronDir);
    const dotEnv = readDotEnv(composeRoot, this.userDataDir, this.secretStorage);
    const groqKey = String(dotEnv.GROQ_API_KEY || '').trim();
    const openAiKey = String(dotEnv.OPENAI_API_KEY || '').trim();
    const omniBase = String(dotEnv.OMNIROUTE_BASE_URL || '').trim();
    const omniKey = String(dotEnv.OMNIROUTE_API_KEY || '').trim();
    const omniPort = Number(dotEnv.OMNIROUTE_PORT || 20128) || 20128;
    const customProvider = String(dotEnv.CUSTOM_LLM_PROVIDER || '').trim().toLowerCase();
    const customBase = String(dotEnv.CUSTOM_LLM_BASE_URL || '').trim();
    const customKey = String(dotEnv.CUSTOM_LLM_API_KEY || '').trim();
    const customModel = String(dotEnv.CUSTOM_LLM_MODEL || '').trim();
    const sovereignLocal = String(process.env.OMEGA_AI_PROVIDER || dotEnv.OMEGA_AI_PROVIDER || 'openai') === 'ollama';

    let activeProvider = 'extractive';
    let activeModel = 'omega-extractive-fallback';
    if (sovereignLocal) {
      activeProvider = 'ollama';
      activeModel = String(dotEnv.OMEGA_OLLAMA_CHAT_MODEL || 'qwen2.5:14b');
    } else if (customBase) {
      activeProvider = customProvider || 'custom';
      activeModel = customModel || 'llama3.2';
    } else if (omniBase) {
      activeProvider = 'omniroute';
      activeModel = String(dotEnv.OMNIROUTE_MODEL || 'auto').trim() || 'auto';
    } else if (openAiKey) {
      activeProvider = 'openai';
      activeModel = String(dotEnv.OMEGA_CHAT_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
    } else if (groqKey) {
      activeProvider = 'groq';
      activeModel = String(dotEnv.GROQ_MODEL || 'openai/gpt-oss-120b').trim() || 'openai/gpt-oss-120b';
    }

    return {
      configured: Boolean(sovereignLocal || customBase || groqKey || openAiKey || omniBase),
      sovereignLocal,
      activeProvider,
      activeModel,
      groqConfigured: Boolean(groqKey),
      groqHint: maskSecretHint(groqKey),
      groqModel: String(dotEnv.GROQ_MODEL || 'openai/gpt-oss-120b').trim() || 'openai/gpt-oss-120b',
      openAiConfigured: Boolean(openAiKey),
      openAiHint: maskSecretHint(openAiKey),
      openAiChatModel: String(dotEnv.OMEGA_CHAT_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini',
      omniRouteEnabled: Boolean(omniBase),
      omniRouteKeyConfigured: Boolean(omniKey),
      omniRouteHint: maskSecretHint(omniKey),
      omniRouteModel: String(dotEnv.OMNIROUTE_MODEL || 'auto').trim() || 'auto',
      omniRouteDashboardUrl: `http://127.0.0.1:${omniPort}/dashboard`,
      customConfigured: Boolean(customBase),
      customProvider: customProvider || '',
      customBaseUrl: customBase,
      customKeyConfigured: Boolean(customKey),
      customHint: maskSecretHint(customKey),
      customModel,
      envFilePath: this.userDataDir ? path.join(this.userDataDir, '.env') : null,
    };
  }

  async reapplyAiConfig(payload = {}) {
    const composeRoot = this.findComposeRootFn(this.electronDir);
    if (!composeRoot) {
      return { ok: false, error: 'No se encontró la carpeta de Docker Compose de OMEGA.' };
    }

    const existing = readDotEnv(composeRoot, this.userDataDir, this.secretStorage);
    const updates = {};
    if (payload.customProvider === 'ollama') {
      const localUrl = new URL(String(payload.customBaseUrl || 'http://host.docker.internal:11434').replace(/\/v1\/?$/, ''));
      if (!['http:', 'https:'].includes(localUrl.protocol) || !['localhost', '127.0.0.1', '[::1]', 'host.docker.internal', 'ollama'].includes(localUrl.hostname)
          || localUrl.username || localUrl.password || localUrl.search || localUrl.hash) {
        return { ok: false, error: 'El Modo Soberano requiere Ollama en el equipo local.' };
      }
      updates.OMEGA_AI_PROVIDER = 'ollama';
      updates.OMEGA_OLLAMA_BASE_URL = localUrl.toString().replace(/\/+$/, '');
      updates.OMEGA_OLLAMA_CHAT_MODEL = sanitizeDotEnvValue(payload.customModel || 'qwen2.5:14b');
    } else if (payload.clearCustomProvider || payload.customProvider) {
      updates.OMEGA_AI_PROVIDER = 'openai';
    }

    if (payload.clearGroqKey) {
      updates.GROQ_API_KEY = null;
    } else if (typeof payload.groqApiKey === 'string' && sanitizeDotEnvValue(payload.groqApiKey)) {
      updates.GROQ_API_KEY = sanitizeDotEnvValue(payload.groqApiKey);
    }
    if (typeof payload.groqModel === 'string' && sanitizeDotEnvValue(payload.groqModel)) {
      updates.GROQ_MODEL = sanitizeDotEnvValue(payload.groqModel);
    }

    if (payload.clearOpenAiKey) {
      updates.OPENAI_API_KEY = null;
    } else if (typeof payload.openAiApiKey === 'string' && sanitizeDotEnvValue(payload.openAiApiKey)) {
      updates.OPENAI_API_KEY = sanitizeDotEnvValue(payload.openAiApiKey);
    }
    if (typeof payload.openAiChatModel === 'string' && sanitizeDotEnvValue(payload.openAiChatModel)) {
      updates.OMEGA_CHAT_MODEL = sanitizeDotEnvValue(payload.openAiChatModel);
    }

    if (payload.clearCustomProvider) {
      updates.CUSTOM_LLM_PROVIDER = null;
      updates.CUSTOM_LLM_BASE_URL = null;
      updates.CUSTOM_LLM_API_KEY = null;
      updates.CUSTOM_LLM_MODEL = null;
    } else {
      if (typeof payload.customProvider === 'string' && sanitizeDotEnvValue(payload.customProvider)) {
        updates.CUSTOM_LLM_PROVIDER = sanitizeDotEnvValue(payload.customProvider).toLowerCase();
      }
      if (typeof payload.customBaseUrl === 'string' && sanitizeDotEnvValue(payload.customBaseUrl)) {
        updates.CUSTOM_LLM_BASE_URL = sanitizeDotEnvValue(payload.customBaseUrl).replace(/\/+$/, '');
      }
      if (payload.clearCustomKey) {
        updates.CUSTOM_LLM_API_KEY = null;
      } else if (typeof payload.customApiKey === 'string' && sanitizeDotEnvValue(payload.customApiKey)) {
        updates.CUSTOM_LLM_API_KEY = sanitizeDotEnvValue(payload.customApiKey);
      }
      if (typeof payload.customModel === 'string' && sanitizeDotEnvValue(payload.customModel)) {
        updates.CUSTOM_LLM_MODEL = sanitizeDotEnvValue(payload.customModel);
      }
    }

    if (typeof payload.omniRouteEnabled === 'boolean') {
      if (payload.omniRouteEnabled) {
        updates.OMNIROUTE_BASE_URL = 'http://omniroute:20128/v1';
        const profiles = String(existing.COMPOSE_PROFILES || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (!profiles.includes('omniroute')) {
          profiles.push('omniroute');
        }
        updates.COMPOSE_PROFILES = profiles.join(',');
      } else {
        updates.OMNIROUTE_BASE_URL = null;
        const profiles = String(existing.COMPOSE_PROFILES || '')
          .split(',')
          .map((s) => s.trim())
          .filter((p) => p && p !== 'omniroute');
        updates.COMPOSE_PROFILES = profiles.length ? profiles.join(',') : null;
      }
    }

    if (payload.clearOmniRouteKey) {
      updates.OMNIROUTE_API_KEY = null;
    } else if (typeof payload.omniRouteApiKey === 'string' && sanitizeDotEnvValue(payload.omniRouteApiKey)) {
      updates.OMNIROUTE_API_KEY = sanitizeDotEnvValue(payload.omniRouteApiKey);
    }
    if (typeof payload.omniRouteModel === 'string' && sanitizeDotEnvValue(payload.omniRouteModel)) {
      updates.OMNIROUTE_MODEL = sanitizeDotEnvValue(payload.omniRouteModel);
    }

    const userEnvPath = this.userDataDir ? path.join(this.userDataDir, '.env') : null;
    const diskUpdates = { ...updates };
    if (this.secretStorage && this.userDataDir) {
      const protectedValues = readProtectedEnv(this.userDataDir, this.secretStorage);
      for (const [key, value] of Object.entries(updates)) {
        if (!sensitiveEnvKey(key)) continue;
        if (value === null) delete protectedValues[key];
        else protectedValues[key] = value;
        diskUpdates[key] = null;
      }
      writeProtectedEnv(this.userDataDir, this.secretStorage, protectedValues);
    }
    const wroteUserEnv = userEnvPath ? writeDotEnvUpdates(userEnvPath, diskUpdates) : false;
    const repoEnvPath = path.join(composeRoot, '.env');
    if (fs.existsSync(repoEnvPath)) {
      writeDotEnvUpdates(repoEnvPath, diskUpdates);
    }

    if (!wroteUserEnv && !fs.existsSync(repoEnvPath)) {
      return { ok: false, error: 'No se pudo escribir el archivo local de configuración.' };
    }

    try {
      await this.checkDockerFn();
    } catch (err) {
      return {
        ok: false,
        savedOnly: true,
        config: this.getAiEngineConfig(),
        error: `Configuración guardada, pero Docker no respondió (${err?.message || err}).`,
      };
    }

    const dotEnv = readDotEnv(composeRoot, this.userDataDir, this.secretStorage);
    const envFilePath = resolveComposeEnvFilePath(composeRoot, this.userDataDir);
    const secretsResult = loadOrCreateDesktopSecrets(this.userDataDir, dotEnv, process.env, this.secretStorage);
    const selected = readRuntimeState(this.userDataDir);
    const project = this.activeChildEnv?.COMPOSE_PROJECT_NAME || selected.composeProject || process.env.COMPOSE_PROJECT_NAME || dotEnv.COMPOSE_PROJECT_NAME || 'omega';
    const childEnv = {
      ...dotEnv,
      ...process.env,
      ...secretsResult.envOverrides,
      COMPOSE_PROJECT_NAME: project,
      OMEGA_PG_VOLUME_NAME: this.activeChildEnv?.OMEGA_PG_VOLUME_NAME || selected.databaseVolume || `${project}_omega_pgdata`,
      JAVA_BACKEND_PORT: String(this.activeChildEnv?.JAVA_BACKEND_PORT || selected.backendPort || process.env.JAVA_BACKEND_PORT || dotEnv.JAVA_BACKEND_PORT || 8080),
      OMEGA_DESKTOP_VERSION: this.appVersion || '',
      ...this.runtimeEnvOverrides,
    };
    const wantsOmni =
      Boolean(dotEnv.OMNIROUTE_BASE_URL && String(dotEnv.OMNIROUTE_BASE_URL).includes('omniroute:20128'));
    // Rotate both HMAC peers together when adopting an already-running stack.
    const servicesToApply = wantsOmni ? ['forensic-worker', 'backend-java', 'omniroute'] : ['forensic-worker', 'backend-java'];
    if (wantsOmni) {
      const profiles = String(childEnv.COMPOSE_PROFILES || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!profiles.includes('omniroute')) {
        childEnv.COMPOSE_PROFILES = [...profiles, 'omniroute'].join(',');
      }
    }

    const upArgs = buildComposeArgs(composeRoot, {
      prodMode: this.prodMode,
      envFilePath,
      subArgs: ['up', '-d', '--wait', ...servicesToApply],
    });
    const res = await this.runCommandFn(upArgs, {
      cwd: composeRoot,
      env: childEnv,
      timeoutMs: STARTUP_TIMEOUT_MS,
    });
    if (res.code !== 0) {
      return {
        ok: false,
        config: this.getAiEngineConfig(),
        error: sanitizeLogLine(res.stderr || res.stdout, Object.values(updates).filter(Boolean)) ||
          'No se pudo recargar el contenedor backend-java.',
      };
    }

    this.activeChildEnv = childEnv;
    const javaPort = Number(childEnv.JAVA_BACKEND_PORT);
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const probe = await this.probeHttpHealthFn(javaPort, 2000);
      if (probe.healthy) {
        return { ok: true, config: this.getAiEngineConfig() };
      }
      await this.sleepFn(800);
    }

    return {
      ok: false,
      config: this.getAiEngineConfig(),
      error: 'El contenedor se reinició pero tardó demasiado en responder healthy.',
    };
  }

  async shutdownStack() {
    this.aborted = true;
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }
    if (!this.shouldStopOnQuit()) {
      return { stopped: false, reason: 'external_or_unstarted' };
    }

    const composeRoot = this.activeComposeRoot;
    const envFilePath = this.activeEnvFilePath;
    const childEnv = this.activeChildEnv || process.env;
    const prodMode = this.prodMode;

    this.shutdownPromise = (async () => {
      const args = buildComposeArgs(composeRoot, {
        prodMode,
        envFilePath,
        subArgs: ['stop', ...this.servicesStarted],
      });
      try {
        const res = await this.runCommandFn(args, {
          cwd: composeRoot,
          env: childEnv,
          timeoutMs: SHUTDOWN_TIMEOUT_MS,
        });
        this.startedByElectron = false;
        return { stopped: res.code === 0, code: res.code };
      } catch (err) {
        return { stopped: false, error: err?.message || String(err) };
      } finally {
        this.shutdownPromise = null;
      }
    })();

    return this.shutdownPromise;
  }
}
