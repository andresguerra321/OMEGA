import { useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileArchive,
  FolderGit2,
  GitBranch,
  KeyRound,
  PackageSearch,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  UploadCloud,
} from 'lucide-react';
import {
  createGitHubLinkState,
  getGitHubIntegrationStatus,
  linkGitHubInstallation,
  scanRepositoryArchive,
  scanRepositoryUrl,
  unlinkGitHubInstallation,
} from '../lib/api';
import { ApiTokensCard } from './ApiTokensCard';
import { DevProjectsTab } from './DevProjectsTab';
import { DevFindingsTriageTab } from './DevFindingsTriageTab';

function GitHubIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 1.5C6.2 1.5 1.5 6.2 1.5 12c0 4.65 3.01 8.59 7.19 9.98.53.1.72-.23.72-.51 0-.25-.01-1.08-.01-1.96-2.92.63-3.54-1.24-3.54-1.24-.48-1.21-1.17-1.54-1.17-1.54-.95-.65.07-.64.07-.64 1.06.07 1.61 1.08 1.61 1.08.94 1.61 2.46 1.15 3.06.88.09-.68.37-1.15.67-1.41-2.33-.27-4.78-1.17-4.78-5.19 0-1.15.41-2.09 1.08-2.82-.11-.27-.47-1.34.1-2.79 0 0 .88-.28 2.89 1.08a10.05 10.05 0 0 1 5.26 0c2.01-1.36 2.89-1.08 2.89-1.08.57 1.45.21 2.52.1 2.79.67.73 1.08 1.67 1.08 2.82 0 4.03-2.46 4.92-4.8 5.18.38.33.72.97.72 1.96 0 1.41-.01 2.55-.01 2.9 0 .28.19.61.73.51A10.5 10.5 0 0 0 22.5 12C22.5 6.2 17.8 1.5 12 1.5Z" />
    </svg>
  );
}

function severityBadge(severity) {
  const sev = String(severity || 'LOW').toUpperCase();
  if (sev === 'CRITICAL' || sev === 'HIGH') {
    return 'border-rose-500/35 bg-rose-500/10 text-rose-400';
  }
  if (sev === 'MEDIUM') {
    return 'border-amber-400/35 bg-amber-400/10 text-amber-300';
  }
  return 'border-white/[0.12] bg-white/[0.04] text-[#9A9AA2]';
}

export function RepoScannerPanel({ authSession }) {
  const inputId = useId();
  const fileRef = useRef(null);
  const [devTab, setDevTab] = useState('scan');
  const [repoUrl, setRepoUrl] = useState('');
  const [repoBranch, setRepoBranch] = useState('');
  const [repoGithubToken, setRepoGithubToken] = useState('');
  const [showAdvancedScan, setShowAdvancedScan] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [cliMode, setCliMode] = useState('ci');
  const [cliCopied, setCliCopied] = useState(false);
  const [activeTokensCount, setActiveTokensCount] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [expandedMap, setExpandedMap] = useState({});

  const [ghStatus, setGhStatus] = useState(null);
  const [ghState, setGhState] = useState('');
  const [ghInstallId, setGhInstallId] = useState('');
  const [ghUserToken, setGhUserToken] = useState('');
  const [ghAccountLogin, setGhAccountLogin] = useState('');
  const [ghBusy, setGhBusy] = useState(false);
  const [ghError, setGhError] = useState('');

  const canScan = authSession?.role === 'ADMIN' || authSession?.role === 'ANALYST';
  const isAdmin = authSession?.role === 'ADMIN';

  async function refreshGitHubStatus() {
    if (!isAdmin) return;
    setGhError('');
    try {
      const data = await getGitHubIntegrationStatus();
      setGhStatus(data || null);
    } catch (err) {
      setGhStatus(null);
      if (err?.status && err.status !== 204) {
        setGhError(err?.message || 'No se pudo consultar la integración con GitHub.');
      }
    }
  }

  useEffect(() => {
    if (isAdmin) {
      void refreshGitHubStatus();
    }
  }, [isAdmin]);

  async function runFileScan(fileToScan) {
    if (!fileToScan || !canScan) return;
    setSelectedFile(fileToScan);
    setScanning(true);
    setError('');
    try {
      const data = await scanRepositoryArchive(fileToScan);
      setResult(data);
      setExpandedMap({});
    } catch (err) {
      setError(err?.message || 'No se pudo completar el análisis del archivo.');
    } finally {
      setScanning(false);
    }
  }

  async function handleScan(e) {
    e?.preventDefault?.();
    if (!canScan) return;
    if (!repoUrl.trim() && selectedFile) {
      await runFileScan(selectedFile);
      return;
    }
    if (!repoUrl.trim()) return;
    setScanning(true);
    setError('');
    try {
      const data = await scanRepositoryUrl({
        repoUrl,
        branch: repoBranch,
        githubToken: repoGithubToken,
      });
      setResult(data);
      setExpandedMap({});
    } catch (err) {
      setError(err?.message || 'No se pudo completar el análisis del repositorio.');
    } finally {
      setScanning(false);
    }
  }

  const cliSnippet =
    cliMode === 'ci'
      ? `export OMEGA_API_TOKEN="omega_scan_..."\npython omega/cli/omega_cli.py scan . --url http://127.0.0.1:8080 --format sarif --output omega.sarif --fail-on HIGH`
      : `python omega/cli/omega_cli.py scan . --offline`;

  const findings = Array.isArray(result?.findings) ? result.findings : [];
  const overallScore = Number(result?.score ?? result?.overall_score ?? 0);
  const scoreBreakdown = Array.isArray(result?.score_breakdown) ? result.score_breakdown : [];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="w-full max-w-5xl mx-auto space-y-6 pb-16">
        <nav
          aria-label="Módulos de repositorios"
          className="flex flex-wrap items-center gap-6 border-b border-white/[0.08]"
        >
          {[
            { id: 'scan', label: 'Analizar repositorio', icon: PackageSearch },
            { id: 'projects', label: 'Proyectos', icon: FolderGit2 },
            { id: 'findings', label: 'Hallazgos y Triaje', icon: ShieldAlert },
            { id: 'cli', label: 'CLI y Tokens API', icon: Terminal, badge: activeTokensCount },
            { id: 'github', label: 'Integración GitHub', icon: GitHubIcon, connected: Boolean(ghStatus) },
          ].map((t) => {
            const Icon = t.icon;
            const active = devTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setDevTab(t.id)}
                className={`relative inline-flex items-center gap-2 pb-3 text-xs transition-colors cursor-pointer ${
                  active ? 'text-slate-100 font-medium' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>{t.label}</span>
                {typeof t.badge === 'number' && t.badge > 0 && (
                  <span className="rounded-full bg-[#2F6FED] px-1.5 py-0.5 text-[10px] font-medium text-white leading-none">
                    {t.badge}
                  </span>
                )}
                {t.connected && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                    title="GitHub conectado"
                  />
                )}
                {active && (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[#2F6FED] rounded-full" />
                )}
              </button>
            );
          })}
        </nav>

        {devTab === 'projects' && (
          <DevProjectsTab
            authSession={authSession}
            onSelectProjectForScan={(proj) => {
              if (proj?.repoUrl) setRepoUrl(proj.repoUrl);
              setDevTab('scan');
            }}
          />
        )}

        {devTab === 'findings' && (
          <DevFindingsTriageTab authSession={authSession} />
        )}

        {devTab === 'cli' && (
          <div className="space-y-5">
            <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/30 text-[#2F6FED]">
                    <Terminal className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">
                      OMEGA CLI y GitHub Actions
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      Analiza tu proyecto desde la terminal sin subir archivos .env, llaves privadas ni .git.
                    </p>
                  </div>
                </div>

                <div className="inline-flex items-center gap-1 rounded-lg bg-[#141923]/80 border border-white/[0.06] p-1">
                  <button
                    type="button"
                    onClick={() => setCliMode('ci')}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                      cliMode === 'ci' ? 'bg-[#2F6FED] text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    CI / Servidor (SARIF)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCliMode('offline')}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                      cliMode === 'offline' ? 'bg-[#2F6FED] text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Local (sin servidor)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-400">
                <div className="flex items-start gap-2.5">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2F6FED]/15 text-[11px] font-mono font-semibold text-[#60A5FA]">
                    1
                  </span>
                  <span>
                    {cliMode === 'ci'
                      ? 'Genera un token REPO_SCAN en la barra inferior y guárdalo como secreto.'
                      : 'No requiere token ni conexión al servidor OMEGA.'}
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2F6FED]/15 text-[11px] font-mono font-semibold text-[#60A5FA]">
                    2
                  </span>
                  <span>
                    {cliMode === 'ci'
                      ? 'Ejecuta el comando en la raíz del repo para exportar resultados SARIF 2.1.0.'
                      : 'Ejecuta el comando en la raíz de tu proyecto para inspección local inmediata.'}
                  </span>
                </div>
              </div>

              <div className="relative rounded-xl bg-[#090B0F] border border-white/[0.06] p-4 pr-24">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(cliSnippet);
                    setCliCopied(true);
                    setTimeout(() => setCliCopied(false), 1800);
                  }}
                  className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-lg bg-[#141923] border border-white/[0.08] hover:border-white/[0.16] px-2.5 py-1 text-[11px] text-slate-300 hover:text-white transition-colors cursor-pointer"
                >
                  {cliCopied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.75} />
                  ) : (
                    <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  <span>{cliCopied ? 'Copiado' : 'Copiar'}</span>
                </button>
                <pre className="overflow-x-auto font-mono text-[11px] text-slate-300 leading-relaxed">
                  {cliSnippet}
                </pre>
              </div>
            </section>
            <ApiTokensCard authSession={authSession} onActiveCountChange={setActiveTokensCount} />
          </div>
        )}

        {devTab === 'github' && (
          <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <GitHubIcon className="h-4 w-4 text-slate-100" />
                <h2 className="text-sm font-semibold text-slate-100">Integración GitHub App (Solo lectura)</h2>
              </div>
              <span className="font-mono rounded-full border border-white/[0.08] bg-[#141923]/75 px-2.5 py-0.5 text-[10.5px] text-slate-400">
                Requiere CLOUD_MANAGED
              </span>
            </div>

            {!isAdmin ? (
              <p className="text-xs text-slate-400">
                Solo un administrador (ADMIN) puede vincular o desconectar la GitHub App del espacio.
              </p>
            ) : ghStatus ? (
              <div className="rounded-xl bg-[#141923]/75 border border-white/[0.06] p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-100">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span>
                      Instalación #{ghStatus.installationId} {ghStatus.accountLogin ? `(${ghStatus.accountLogin})` : ''}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    Repositorios: {(ghStatus.selectedRepositories || []).length || 'Según selección en GitHub'}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={ghBusy}
                  onClick={async () => {
                    setGhBusy(true);
                    setGhError('');
                    try {
                      await unlinkGitHubInstallation();
                      setGhStatus(null);
                    } catch (err) {
                      setGhError(err?.message || 'No se pudo desvincular.');
                    } finally {
                      setGhBusy(false);
                    }
                  }}
                  className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 cursor-pointer"
                >
                  Desvincular
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-start gap-3.5">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2F6FED]/15 text-xs font-mono font-semibold text-[#60A5FA]">
                    01
                  </span>
                  <div className="flex-1 min-w-0 space-y-2.5">
                    <div>
                      <h3 className="text-xs font-semibold text-slate-100">Autorizar espacio</h3>
                      <p className="mt-0.5 text-xs text-slate-400">
                        Genera un identificador temporal de vinculación para autorizar la instalación en GitHub.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        disabled={ghBusy}
                        onClick={async () => {
                          setGhBusy(true);
                          setGhError('');
                          try {
                            const res = await createGitHubLinkState();
                            setGhState(res?.state || '');
                          } catch (err) {
                            setGhError(err?.message || 'No se pudo generar el state.');
                          } finally {
                            setGhBusy(false);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#141923] border border-white/[0.08] hover:border-[#2F6FED] px-3 py-1.5 text-xs font-medium text-slate-100 transition-colors cursor-pointer"
                      >
                        <KeyRound className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                        <span>Generar código state</span>
                      </button>
                      {ghState && (
                        <code className="font-mono text-[11px] text-emerald-400 bg-[#090B0F] px-2.5 py-1 rounded-lg border border-white/[0.06]">
                          state: {ghState}
                        </code>
                      )}
                    </div>
                  </div>
                </div>

                <div className="border-t border-white/[0.06]" />

                <div className="flex items-start gap-3.5">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2F6FED]/15 text-xs font-mono font-semibold text-[#60A5FA]">
                    02
                  </span>
                  <div className="flex-1 min-w-0 space-y-3">
                    <div>
                      <h3 className="text-xs font-semibold text-slate-100">Vincular instalación</h3>
                      <p className="mt-0.5 text-xs text-slate-400">
                        Encuentras el ID en la URL de tu instalación (github.com/settings/installations/ID).
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                      <label className="rounded-xl bg-[#141923]/80 border border-white/[0.08] focus-within:border-[#2F6FED] px-3.5 py-2 cursor-text">
                        <span className="block text-[11px] text-slate-400">ID de instalación</span>
                        <input
                          type="text"
                          value={ghInstallId}
                          onChange={(e) => setGhInstallId(e.target.value)}
                          placeholder="ej. 54812903"
                          className="mt-0.5 w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                        />
                      </label>
                      <label className="rounded-xl bg-[#141923]/80 border border-white/[0.08] focus-within:border-[#2F6FED] px-3.5 py-2 cursor-text">
                        <span className="block text-[11px] text-slate-400">Token de usuario GitHub (ghu_...)</span>
                        <input
                          type="password"
                          value={ghUserToken}
                          onChange={(e) => setGhUserToken(e.target.value)}
                          placeholder="ghu_..."
                          className="mt-0.5 w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                        />
                      </label>
                      <label className="rounded-xl bg-[#141923]/80 border border-white/[0.08] focus-within:border-[#2F6FED] px-3.5 py-2 cursor-text">
                        <span className="block text-[11px] text-slate-400">Organización (opcional)</span>
                        <input
                          type="text"
                          value={ghAccountLogin}
                          onChange={(e) => setGhAccountLogin(e.target.value)}
                          placeholder="ej. mi-org"
                          className="mt-0.5 w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      disabled={ghBusy || !ghState || !ghInstallId || !ghUserToken}
                      onClick={async () => {
                        setGhBusy(true);
                        setGhError('');
                        try {
                          const linked = await linkGitHubInstallation({
                            state: ghState,
                            installationId: ghInstallId,
                            userAccessToken: ghUserToken,
                            accountLogin: ghAccountLogin,
                          });
                          setGhStatus(linked);
                          setGhUserToken('');
                        } catch (err) {
                          setGhError(err?.message || 'No se pudo vincular la instalación.');
                        } finally {
                          setGhBusy(false);
                        }
                      }}
                      className="rounded-lg bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-45 px-4 py-2 text-xs font-medium text-white transition-colors cursor-pointer"
                    >
                      Vincular instalación
                    </button>
                  </div>
                </div>
              </div>
            )}

            {ghError && <p className="text-xs text-rose-400">{ghError}</p>}
          </section>
        )}

        {devTab === 'scan' && (
          <>
        <header className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/30 text-[#2F6FED]">
                  <PackageSearch className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <h1 className="text-lg font-semibold text-slate-100">
                  Análisis de Repositorios y Dependencias
                </h1>
              </div>
              <p className="mt-1.5 text-xs text-slate-400 max-w-2xl leading-relaxed">
                Inspección estática sin ejecución ni instalación de código de terceros. Evalúa manifiestos, scripts de instalación y señales de cadena de suministro con puntaje explicable.
              </p>
            </div>
            <span className="rounded-full border border-white/[0.08] bg-[#141923]/75 px-3 py-1 font-mono text-[11px] text-slate-400">
              Zero-Retention · Solo metadatos
            </span>
          </div>

          <form onSubmit={handleScan} className="mt-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-stretch gap-2.5">
              <label className="flex-1 min-w-0 rounded-xl bg-[#141923]/80 border border-white/[0.08] focus-within:border-[#2F6FED] px-4 py-2.5 flex items-center gap-3 transition-colors cursor-text">
                <GitHubIcon className="h-4 w-4 text-slate-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="block text-[11px] text-slate-400">
                    URL pública o privada de GitHub
                  </span>
                  <input
                    type="text"
                    value={repoUrl}
                    onChange={(e) => {
                      setRepoUrl(e.target.value);
                      setError('');
                    }}
                    placeholder="https://github.com/usuario/repositorio"
                    aria-label="URL pública o privada de GitHub"
                    className="mt-0.5 w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                </div>
              </label>

              <button
                type="submit"
                disabled={scanning || !canScan || (!repoUrl.trim() && !selectedFile)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-45 disabled:cursor-not-allowed px-5 py-2.5 text-xs font-medium text-white transition-colors cursor-pointer shrink-0"
              >
                <PackageSearch className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>{scanning ? 'Analizando...' : 'Analizar'}</span>
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-white/[0.07]" />
              <span className="text-[11px] text-slate-500">o sube un paquete local</span>
              <div className="h-px flex-1 bg-white/[0.07]" />
            </div>

            <div>
              <input
                id={inputId}
                ref={fileRef}
                type="file"
                accept=".tar.gz,.tgz,.zip"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  if (file) {
                    void runFileScan(file);
                  }
                }}
                className="sr-only"
              />
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer?.files?.[0] || null;
                  if (file) {
                    void runFileScan(file);
                  }
                }}
                className={`rounded-xl border border-dashed p-6 text-center transition-colors cursor-pointer ${
                  isDragging
                    ? 'border-[#2F6FED] bg-[#2F6FED]/10'
                    : 'border-white/[0.12] hover:border-[#2F6FED]/50 bg-[#141923]/40'
                }`}
              >
                <UploadCloud className="mx-auto h-5 w-5 text-[#2F6FED]" strokeWidth={1.75} />
                <div className="mt-2 text-xs font-medium text-slate-200">
                  {selectedFile ? selectedFile.name : 'Arrastra un archivo .zip o manifiesto aquí'}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  Soporta package.json, requirements.txt, pom.xml y Cargo.toml (análisis en RAM)
                </div>
              </div>
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowAdvancedScan((prev) => !prev)}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                <span>Opciones avanzadas</span>
                {showAdvancedScan ? (
                  <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
              </button>

              {showAdvancedScan && (
                <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    value={repoBranch}
                    onChange={(e) => setRepoBranch(e.target.value)}
                    placeholder="Rama específica (opcional, ej. main)"
                    className="rounded-lg bg-[#141923]/75 border border-white/[0.08] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#2F6FED]"
                  />
                  <input
                    type="password"
                    value={repoGithubToken}
                    onChange={(e) => setRepoGithubToken(e.target.value)}
                    placeholder="Token de GitHub para repos privados (ghp_...)"
                    className="rounded-lg bg-[#141923]/75 border border-white/[0.08] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#2F6FED]"
                  />
                  <p className="sm:col-span-2 text-[11px] text-slate-400">
                    Los repositorios públicos se analizan sin token. Si es privado, ingresa un token de lectura (solo en memoria) o{' '}
                    <button
                      type="button"
                      onClick={() => setDevTab('github')}
                      className="text-[#60A5FA] hover:underline cursor-pointer"
                    >
                      conecta tu GitHub App
                    </button>
                    .
                  </p>
                </div>
              )}
            </div>
          </form>

          {!canScan && (
            <p className="mt-3 text-xs text-amber-300">
              Tu rol actual ({authSession?.role || 'CLIENT'}) es de solo lectura y no puede iniciar nuevos escaneos.
            </p>
          )}
          {error && (
            <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{error}</span>
            </div>
          )}
        </header>

        {result && (
          <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
              <div>
                <div className="text-xs text-[#8E95A5]">Resultado del escaneo</div>
                <div className="mt-0.5 text-sm font-semibold text-[#F2F2F4]">
                  {findings.length > 0
                    ? `${findings.length} señal(es) detectada(s)`
                    : 'Sin señales detectadas con las reglas actuales'}
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-[11px] text-[#8E95A5]">Puntaje compuesto</div>
                  <div className="font-tech text-base font-semibold text-[#F2F2F4]">
                    {overallScore.toFixed(1)} / 100
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                    findings.length > 0
                      ? 'border-amber-400/35 bg-amber-400/10 text-amber-300'
                      : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400'
                  }`}
                >
                  {findings.length > 0 ? (
                    <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.75} />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  <span>
                    {findings.length > 0
                      ? 'Requiere revisión'
                      : 'Sin señales detectadas con las reglas actuales'}
                  </span>
                </span>
              </div>
            </div>

            {findings.length === 0 ? (
              <p className="text-xs text-[#9A9AA2] leading-relaxed">
                No se identificaron patrones sospechosos ni anomalías de cadena de suministro con el conjunto actual de reglas y metadatos consultados. Esto no certifica ausencia de riesgo en código no analizado o reglas futuras.
              </p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {findings.map((finding, idx) => {
                  const key = finding.id || `finding-${idx}`;
                  const isOpen = Boolean(expandedMap[key]);
                  const breakdown = finding.score_breakdown || {};
                  const contributions = Array.isArray(breakdown.contributions) ? breakdown.contributions : [];
                  return (
                    <article key={key} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full border px-2 py-0.5 font-tech text-[10.5px] ${severityBadge(
                                finding.severity,
                              )}`}
                            >
                              {String(finding.severity || 'LOW').toUpperCase()}
                            </span>
                            <span className="font-tech text-[11px] text-[#8E95A5]">
                              {finding.detector || 'detector'}
                            </span>
                            {finding.file_path && (
                              <span className="font-tech text-[11px] text-[#9A9AA2] truncate">
                                {finding.file_path}
                              </span>
                            )}
                          </div>
                          <h3 className="mt-1.5 text-sm font-medium text-[#F2F2F4]">
                            {finding.title || finding.rule_id || 'Hallazgo de seguridad'}
                          </h3>
                          {finding.summary && (
                            <p className="mt-1 text-xs text-[#9A9AA2] leading-relaxed">
                              {finding.summary}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setExpandedMap((prev) => ({ ...prev, [key]: !prev[key] }))
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-[#141923]/75 border border-white/[0.06] hover:border-white/[0.14] px-2.5 py-1.5 text-[11px] text-[#F2F2F4] cursor-pointer shrink-0"
                        >
                          <span>Evidencia ({Number(finding.score ?? breakdown.total_score ?? 0).toFixed(0)} pts)</span>
                          {isOpen ? (
                            <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
                          )}
                        </button>
                      </div>

                      {isOpen && (
                        <div className="mt-3 rounded-xl bg-[#141923]/75 border border-white/[0.05] p-3.5 space-y-2.5 text-xs">
                          {contributions.length > 0 && (
                            <div>
                              <div className="text-[11px] font-medium text-[#9A9AA2] mb-1">
                                Desglose de puntaje explicable
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {contributions.map((c, cIdx) => (
                                  <span
                                    key={`${key}-contrib-${cIdx}`}
                                    className="rounded-md bg-[#0F131B] border border-white/[0.06] px-2 py-1 font-tech text-[11px] text-[#F2F2F4]"
                                  >
                                    {c.signal || c.label}: +{Number(c.points ?? 0).toFixed(1)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {finding.evidence && (
                            <div>
                              <div className="text-[11px] font-medium text-[#9A9AA2] mb-1">
                                Evidencia observada
                              </div>
                              <pre className="overflow-x-auto rounded-lg bg-[#0A0A0C] p-2.5 font-tech text-[11px] text-[#D1D5DB]">
                                {typeof finding.evidence === 'string'
                                  ? finding.evidence
                                  : JSON.stringify(finding.evidence, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
          </>
        )}
      </div>
    </div>
  );
}

export default RepoScannerPanel;
