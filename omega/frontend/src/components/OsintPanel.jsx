import { useEffect, useState } from 'react';
import { ShieldCheck, Radar, Trash2, CheckCircle2, AlertTriangle, Globe } from 'lucide-react';
import {
  fetchOsintAssets,
  createOsintAsset,
  scanOsintAsset,
  deleteOsintAsset,
} from '../lib/api';

export function OsintPanel() {
  const [assets, setAssets] = useState([]);
  const [assetType, setAssetType] = useState('domain');
  const [assetValue, setAssetValue] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [scanningId, setScanningId] = useState(null);
  const [report, setReport] = useState(null);

  useEffect(() => {
    fetchOsintAssets()
      .then((d) => setAssets(d.assets || []))
      .catch(() => setAssets([]));
  }, []);

  async function handleRegister(e) {
    e.preventDefault();
    setError('');
    if (!consent) {
      setError('Debes marcar la casilla de consentimiento explícito (RNF8).');
      return;
    }
    try {
      const created = await createOsintAsset({
        asset_type: assetType,
        asset_value: assetValue,
        explicit_consent: true,
      });
      setAssets((prev) => [created, ...prev.filter((a) => a.id !== created.id)]);
      setAssetValue('');
      setConsent(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleScan(id) {
    setScanningId(id);
    setError('');
    try {
      const res = await scanOsintAsset(id);
      setReport(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setScanningId(null);
    }
  }

  async function handleDelete(id) {
    await deleteOsintAsset(id);
    setAssets((prev) => prev.filter((a) => a.id !== id));
    if (report?.asset_id === id) setReport(null);
  }

  return (
    <div className="space-y-6">
      {/* Encabezado de alcance ético (RNF8) */}
      <div className="flex items-start justify-between rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Monitoreo de Exposición Propia (OSINT Defensivo)</h2>
          <p className="text-xs text-zinc-400">
            Registra únicamente identificadores propios o de tu organización para auditar su superficie pública en fuentes legítimas.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-1.5 text-[11px] text-emerald-300">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Consentimiento Obligatorio (RNF8)</span>
        </div>
      </div>

      {/* Formulario con menú explícito de consentimiento */}
      <form
        onSubmit={handleRegister}
        className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <select
            value={assetType}
            onChange={(e) => setAssetType(e.target.value)}
            className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-xs text-zinc-200 focus:outline-none"
          >
            <option value="domain">Dominio propio</option>
            <option value="institutional_email">Correo institucional</option>
            <option value="organization">Nombre de organización</option>
          </select>

          <input
            type="text"
            value={assetValue}
            onChange={(e) => setAssetValue(e.target.value)}
            placeholder={
              assetType === 'domain'
                ? 'ej. miorganizacion.org'
                : assetType === 'institutional_email'
                ? 'ej. seguridad@miorganizacion.org'
                : 'ej. Fundación Prensa Libre'
            }
            className="sm:col-span-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
        </div>

        <label className="flex items-start gap-2.5 rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-3 text-xs text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-emerald-500"
          />
          <span>
            <strong>Consentimiento explícito (RF8 / RNF8):</strong> Confirmo que este identificador me pertenece o cuento con autorización expresa de la organización titular para consultar su exposición pública pasiva.
          </span>
        </label>

        {error && <p className="text-xs text-rose-400">{error}</p>}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!assetValue.trim() || !consent}
            className="rounded-xl bg-zinc-100 px-4 py-2 text-xs font-medium text-zinc-950 hover:bg-white disabled:opacity-40 transition"
          >
            Registrar activo autorizado
          </button>
        </div>
      </form>

      {/* Lista de activos registrados */}
      {assets.length > 0 && (
        <div className="space-y-2.5">
          <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Activos propios autorizados ({assets.length})
          </h3>
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3"
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="font-mono text-xs font-medium text-zinc-100">
                    {asset.asset_value}
                  </span>
                  <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                    {asset.asset_type}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Consentimiento registrado: {new Date(asset.consented_at).toLocaleString()}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleScan(asset.id)}
                  disabled={scanningId === asset.id}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500/50 hover:text-emerald-300 transition"
                >
                  <Radar className="h-3.5 w-3.5" />
                  <span>{scanningId === asset.id ? 'Consultando...' : 'Auditar exposición'}</span>
                </button>
                <button
                  onClick={() => handleDelete(asset.id)}
                  title="Revocar y eliminar activo"
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-rose-400 transition"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reporte de exposición pasiva */}
      {report && (
        <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">
                Reporte OSINT Pasivo: <span className="font-mono text-emerald-400">{report.asset_value}</span>
              </h3>
              <p className="text-[11px] text-zinc-500">{report.ethical_notice}</p>
            </div>
          </div>

          {/* Postura DNS */}
          {report.dns_posture?.domain_evaluated && (
            <div className="grid gap-3 sm:grid-cols-2 text-xs">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Registro SPF (Anti-Spoofing)</span>
                  {report.dns_posture.spf_configured ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                  )}
                </div>
                <p className="font-mono text-[11px] text-zinc-300 break-all">
                  {report.dns_posture.spf_record || 'No detectado en DNS público'}
                </p>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Política DMARC</span>
                  {report.dns_posture.dmarc_configured ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                  )}
                </div>
                <p className="font-mono text-[11px] text-zinc-300 break-all">
                  {report.dns_posture.dmarc_record || 'No detectado (_dmarc)'}
                </p>
              </div>
            </div>
          )}

          {/* Subdominios en Certificate Transparency */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-zinc-300">
              Subdominios indexados públicamente (Certificate Transparency / crt.sh): {report.exposed_subdomains.length}
            </p>
            {report.exposed_subdomains.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {report.exposed_subdomains.map((sub) => (
                  <span
                    key={sub}
                    className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-300"
                  >
                    {sub}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">Sin subdominios públicos adicionales reportados.</p>
            )}
          </div>

          {/* Correlación contra base interna de spyware */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs">
            <p className="font-medium text-zinc-300">
              Cruce con indicadores de spyware comercial (Omega CTI):{' '}
              <span className={report.cti_ioc_matches.length > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                {report.cti_ioc_matches.length} coincidencias
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

