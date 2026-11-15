import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const BACKEND_SERVICES = ['postgres', 'forensic-worker', 'backend-java'];
const DEFAULT_SECRETS_FILENAME = 'omega-desktop-secrets.json';
const HEALTHCHECK_POLL_MS = 1000;
const STARTUP_TIMEOUT_MS = 180_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;

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

export function readDotEnv(composeRoot, userDataDir = null) {
  const baseEnv = composeRoot ? readDotEnvFile(path.join(composeRoot, '.env')) : {};
  const userEnv = userDataDir ? readDotEnvFile(path.join(userDataDir, '.env')) : {};
  return { ...baseEnv, ...userEnv };
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

export function loadOrCreateDesktopSecrets(userDataDir, dotEnv = {}, processEnv = process.env) {
  const secretKeys = [
    'INTERNAL_SERVICE_TOKEN',
    'OMEGA_JWT_SECRET',
    'POSTGRES_PASSWORD',
    'OMEGA_BOOTSTRAP_SECRET',
  ];

  const secretsPath = userDataDir ? path.join(userDataDir, DEFAULT_SECRETS_FILENAME) : null;
  let stored = {};
  if (secretsPath && fs.existsSync(secretsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        stored = parsed;
      }
    } catch {
      stored = {};
    }
  }

  let updated = false;
  const generatedEnv = {};
  for (const key of secretKeys) {
    const fromEnv = processEnv?.[key] || dotEnv?.[key];
    if (fromEnv && String(fromEnv).trim()) {
      continue;
    }
    if (!stored[key] || typeof stored[key] !== 'string' || stored[key].length < 32) {
      stored[key] = crypto.randomBytes(32).toString('hex');
      updated = true;
    }
    generatedEnv[key] = stored[key];
  }

  if (updated && secretsPath) {
    try {
      fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
      fs.writeFileSync(secretsPath, `${JSON.stringify(stored, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch {
      // No bloquear arranque si userData es de solo lectura; el secreto sigue vivo en memoria
    }
  }

  return {
    envOverrides: generatedEnv,
    secretsPath,
    generatedKeys: Object.keys(generatedEnv),
  };
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

async function defaultCheckDocker() {
  try {
    await execFileAsync('docker', ['--version'], { timeout: 4000, windowsHide: true });
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
    await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      timeout: 15000,
      windowsHide: true,
    });
  } catch (err) {
    const error = new Error(
      'Docker Desktop o el daemon de Docker no está ejecutándose. Ábrelo y vuelve a intentarlo.',
    );
    error.code = 'DOCKER_DAEMON_DOWN';
    error.detail = err?.stderr ? String(err.stderr).trim() : err?.message;
    throw error;
  }
}

function defaultRunCommand(args, { cwd, env, timeoutMs = 120_000, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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
    checkDockerFn = defaultCheckDocker,
    runCommandFn = defaultRunCommand,
    sleepFn = defaultSleep,
    findComposeRootFn = findComposeRoot,
    startupTimeoutMs = STARTUP_TIMEOUT_MS,
    pollIntervalMs = HEALTHCHECK_POLL_MS,
  }) {
    this.userDataDir = userDataDir;
    this.electronDir = electronDir;
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
        subArgs: ['ps', '--format', 'json', ...BACKEND_SERVICES],
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
    const dotEnv = readDotEnv(composeRoot, this.userDataDir);
    const envFilePath = resolveComposeEnvFilePath(composeRoot, this.userDataDir);
    const javaPort = Number(process.env.JAVA_BACKEND_PORT || dotEnv.JAVA_BACKEND_PORT || 8080);

    this.#updateState({
      phase: 'checking_existing',
      message: 'Comprobando si OMEGA ya está en ejecución…',
      detail: '',
      errorCode: null,
      canRetry: false,
      alreadyRunning: false,
      services: createInitialServicesMap(false),
      logLines: [],
    });

    // 1. Si backend-java ya responde /actuator/health UP, no reiniciamos ni asumimos ownership
    const preHealth = await this.probeHttpHealthFn(javaPort, 2000);
    if (preHealth.healthy) {
      this.startedByElectron = false;
      this.activeComposeRoot = composeRoot;
      const psSnapshot = composeRoot
        ? await this.#inspectComposePs(composeRoot, this.prodMode, process.env)
        : null;
      const readyServices = psSnapshot || createInitialServicesMap(true);
      readyServices['backend-java'] = {
        ...readyServices['backend-java'],
        state: 'running',
        health: 'healthy',
        running: true,
        healthy: true,
      };
      this.#updateState({
        phase: 'ready',
        message: 'Servicios de OMEGA activos.',
        detail: 'Se reutilizó la sesión de contenedores ya iniciada.',
        alreadyRunning: true,
        services: readyServices,
      });
      return { ok: true, alreadyRunning: true, startedByElectron: false };
    }

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
        detail:
          err?.code === 'DOCKER_CLI_MISSING'
            ? 'Instala Docker Desktop y reinicia el asistente o ejecuta el modo local sin contenedores.'
            : 'Inicia Docker Desktop y espera unos segundos antes de pulsar Reintentar.',
        errorCode: err?.code || 'DOCKER_DAEMON_DOWN',
        canRetry: true,
      });
      return { ok: false, errorCode: err?.code || 'DOCKER_DAEMON_DOWN' };
    }

    if (this.aborted) {
      return { ok: false, aborted: true };
    }

    // 3. Preparar secretos criptográficos en userData (sin alterar .env existente)
    const secretsResult = loadOrCreateDesktopSecrets(this.userDataDir, dotEnv, process.env);
    this.secretValues = [
      ...Object.values(secretsResult.envOverrides),
      dotEnv.POSTGRES_PASSWORD,
      dotEnv.INTERNAL_SERVICE_TOKEN,
      dotEnv.OMEGA_JWT_SECRET,
      dotEnv.OMEGA_BOOTSTRAP_SECRET,
      dotEnv.GROQ_API_KEY,
      dotEnv.OPENAI_API_KEY,
    ].filter(Boolean);

    const childEnv = {
      ...dotEnv,
      ...process.env,
      ...secretsResult.envOverrides,
    };
    this.activeComposeRoot = composeRoot;
    this.activeEnvFilePath = envFilePath;
    this.activeChildEnv = childEnv;

    // Determinar si alguno de los servicios backend ya estaba corriendo antes de invocar up -d
    const prePs = await this.#inspectComposePs(composeRoot, this.prodMode, childEnv);
    const allAlreadyRunning =
      prePs != null && BACKEND_SERVICES.every((svc) => prePs[svc]?.running);
    this.startedByElectron = !allAlreadyRunning;

    this.#updateState({
      phase: 'starting_containers',
      message: 'Iniciando servicios de OMEGA…',
      detail: this.prodMode
        ? 'Perfil producción activo (docker-compose.yml + docker-compose.prod.yml).'
        : 'Levantando PostgreSQL pgvector, worker forense y núcleo Java…',
      secretsGenerated: secretsResult.generatedKeys.length > 0,
      services: prePs || createInitialServicesMap(false),
    });

    const upArgs = buildComposeArgs(composeRoot, {
      prodMode: this.prodMode,
      envFilePath,
      subArgs: ['up', '-d', ...BACKEND_SERVICES],
    });

    const upResult = await this.runCommandFn(upArgs, {
      cwd: composeRoot,
      env: childEnv,
      timeoutMs: 180_000,
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
    return this.#waitForHealthchecks(composeRoot, childEnv, javaPort);
  }

  async #waitForHealthchecks(composeRoot, childEnv, javaPort) {
    const deadline = Date.now() + this.startupTimeoutMs;

    while (!this.aborted && Date.now() < deadline) {
      const psMap = await this.#inspectComposePs(composeRoot, this.prodMode, childEnv);
      const httpProbe = await this.probeHttpHealthFn(javaPort, 1500);

      if (psMap) {
        const failedSvc = BACKEND_SERVICES.find(
          (svc) =>
            psMap[svc]?.state === 'exited' ||
            psMap[svc]?.state === 'dead' ||
            psMap[svc]?.health === 'unhealthy',
        );
        if (failedSvc) {
          const tail = await this.#collectFailureTail(composeRoot, this.prodMode, childEnv, failedSvc);
          this.#updateState({
            phase: 'error',
            message: `El servicio "${failedSvc}" falló durante el arranque.`,
            detail: tail || `Estado reportado: ${psMap[failedSvc].state} (${psMap[failedSvc].health}).`,
            errorCode: 'SERVICE_UNHEALTHY',
            canRetry: true,
            services: psMap,
          });
          return { ok: false, errorCode: 'SERVICE_UNHEALTHY' };
        }
      }

      if (httpProbe.healthy) {
        const finalServices = psMap || createInitialServicesMap(true);
        finalServices['backend-java'] = {
          ...finalServices['backend-java'],
          state: 'running',
          health: 'healthy',
          running: true,
          healthy: true,
        };
        this.#updateState({
          phase: 'ready',
          message: 'Servicios de OMEGA listos.',
          detail: `Núcleo Java operativo en 127.0.0.1:${javaPort}.`,
          services: finalServices,
        });
        return { ok: true, alreadyRunning: false, startedByElectron: this.startedByElectron };
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
        subArgs: ['down'],
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
