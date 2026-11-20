import { useEffect, useState } from 'react';
import { GitBranch, KeyRound, Terminal } from 'lucide-react';
import {
  createGitHubLinkState,
  getGitHubIntegrationStatus,
  linkGitHubInstallation,
  unlinkGitHubInstallation,
} from '../lib/api';
import { ApiTokensCard } from './ApiTokensCard';

export function DevCliModulePanel({ authSession }) {
  const [ghStatus, setGhStatus] = useState(null);
  const [ghState, setGhState] = useState('');
  const [ghInstallId, setGhInstallId] = useState('');
  const [ghUserToken, setGhUserToken] = useState('');
  const [ghAccountLogin, setGhAccountLogin] = useState('');
  const [ghBusy, setGhBusy] = useState(false);
  const [ghError, setGhError] = useState('');

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
    void refreshGitHubStatus();
  }, [isAdmin, authSession?.tenantId]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mx-auto max-w-[1120px] space-y-6 pb-16">
        <header className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/30 text-[#2F6FED]">
                  <Terminal className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <h1 className="text-lg font-semibold text-[#F2F2F4]">
                  OMEGA CLI, SARIF y GitHub CI
                </h1>
              </div>
              <p className="mt-1.5 text-xs text-[#9A9AA2] max-w-2xl leading-relaxed">
                Analiza repositorios desde terminal o pipelines sin subir secretos (`.env`, llaves privadas o `.git`). Genera reportes SARIF 2.1.0 para GitHub Code Scanning.
              </p>
            </div>
            <span className="rounded-full border border-white/[0.08] bg-[#141923]/75 px-3 py-1 font-tech text-[11px] text-[#9A9AA2]">
              Exit codes: 0 limpio · 1 hallazgos · 3 auth · 4 límites
            </span>
          </div>

          <pre className="overflow-x-auto rounded-xl bg-[#0A0A0C] border border-white/[0.06] p-4 font-tech text-[11px] text-[#D1D5DB]">
{`# 1. Exportar token REPO_SCAN
export OMEGA_API_TOKEN="omega_scan_..."

# 2. Escanear proyecto y exportar SARIF 2.1.0
python omega/cli/omega_cli.py scan . --url http://127.0.0.1:8080 --format sarif --output omega.sarif --fail-on HIGH

# 3. Modo local sin servidor ni red
python omega/cli/omega_cli.py scan . --offline`}
          </pre>
        </header>

        <ApiTokensCard authSession={authSession} />

        <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-[#2F6FED]" strokeWidth={1.75} />
              <h2 className="text-sm font-semibold text-[#F2F2F4]">Integración GitHub App (Solo lectura)</h2>
            </div>
            <span className="font-tech rounded-full border border-white/[0.08] bg-[#141923]/75 px-2.5 py-0.5 text-[10.5px] text-[#9A9AA2]">
              Requiere CLOUD_MANAGED
            </span>
          </div>

          {!isAdmin ? (
            <p className="text-xs text-[#9A9AA2]">
              Solo un administrador (`ADMIN`) puede vincular o desconectar la GitHub App del espacio.
            </p>
          ) : ghStatus ? (
            <div className="rounded-xl bg-[#141923]/75 border border-white/[0.06] p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-[#F2F2F4]">
                  Instalación #{ghStatus.installationId} {ghStatus.accountLogin ? `(${ghStatus.accountLogin})` : ''}
                </div>
                <div className="mt-0.5 text-[11px] text-[#8E95A5]">
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
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
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
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#2F6FED] hover:bg-[#255ED4] px-3 py-1.5 text-xs font-medium text-white cursor-pointer"
                >
                  <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>Generar state de vinculación</span>
                </button>
                {ghState && (
                  <code className="font-tech text-[11px] text-emerald-400 bg-[#0A0A0C] px-2.5 py-1 rounded-lg border border-white/[0.06]">
                    state: {ghState}
                  </code>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={ghInstallId}
                  onChange={(e) => setGhInstallId(e.target.value)}
                  placeholder="installation_id"
                  className="rounded-lg bg-[#141923]/75 border border-white/[0.08] px-3 py-2 text-xs text-[#F2F2F4]"
                />
                <input
                  type="password"
                  value={ghUserToken}
                  onChange={(e) => setGhUserToken(e.target.value)}
                  placeholder="Token usuario GitHub (ghu_...)"
                  className="rounded-lg bg-[#141923]/75 border border-white/[0.08] px-3 py-2 text-xs text-[#F2F2F4]"
                />
                <input
                  type="text"
                  value={ghAccountLogin}
                  onChange={(e) => setGhAccountLogin(e.target.value)}
                  placeholder="Cuenta / Org (opcional)"
                  className="rounded-lg bg-[#141923]/75 border border-white/[0.08] px-3 py-2 text-xs text-[#F2F2F4]"
                />
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
                className="rounded-lg bg-[#141923]/75 border border-white/[0.1] hover:border-[#2F6FED] px-3.5 py-2 text-xs font-medium text-[#F2F2F4] disabled:opacity-45 cursor-pointer"
              >
                Vincular instalación
              </button>
            </div>
          )}

          {ghError && <p className="text-xs text-rose-400">{ghError}</p>}
        </section>
      </div>
    </div>
  );
}

export default DevCliModulePanel;
