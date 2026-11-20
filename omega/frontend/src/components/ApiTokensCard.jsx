import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { createApiToken, listApiTokens, revokeApiToken } from '../lib/api';

export function ApiTokensCard({ authSession, onActiveCountChange }) {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('90');
  const [maxUses, setMaxUses] = useState('');
  const [createdPlaintext, setCreatedPlaintext] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const canManage = authSession?.role === 'ADMIN' || authSession?.role === 'ANALYST';

  async function loadTokens() {
    if (!canManage) return;
    setLoading(true);
    setError('');
    try {
      const data = await listApiTokens();
      const list = Array.isArray(data) ? data : [];
      setTokens(list);
      onActiveCountChange?.(list.filter((t) => !t.revokedAt).length);
    } catch (err) {
      setError(err?.message || 'No se pudieron cargar los tokens de API.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTokens();
  }, [authSession?.tenantId, canManage]);

  if (!canManage) return null;

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    setCreatedPlaintext('');
    try {
      const res = await createApiToken({
        name: name.trim(),
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
        maxUses: maxUses ? Number(maxUses) : undefined,
      });
      if (res?.plainTextToken) {
        setCreatedPlaintext(res.plainTextToken);
      }
      setName('');
      setMaxUses('');
      await loadTokens();
    } catch (err) {
      setError(err?.message || 'No se pudo crear el token de API.');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(tokenId) {
    setError('');
    try {
      await revokeApiToken(tokenId);
      await loadTokens();
    } catch (err) {
      setError(err?.message || 'No se pudo revocar el token.');
    }
  }

  return (
    <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[#2F6FED]" strokeWidth={1.75} />
          <h2 className="text-sm font-semibold text-[#F2F2F4]">Tokens de API (CLI y GitHub Action)</h2>
        </div>
        <span className="font-tech rounded-full border border-white/[0.08] bg-[#141923]/75 px-2.5 py-0.5 text-[10.5px] text-[#9A9AA2]">
          Alcance: REPO_SCAN
        </span>
      </div>

      <form
        onSubmit={handleCreate}
        className="rounded-xl bg-[#141923]/80 border border-white/[0.07] grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-white/[0.07] overflow-hidden"
      >
        <label className="md:col-span-5 px-3.5 py-2.5 flex flex-col justify-center cursor-text">
          <span className="text-[11px] text-slate-400">Nombre del token</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ej. CI GitHub"
            maxLength={120}
            className="mt-0.5 w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </label>
        <label className="md:col-span-3 px-3.5 py-2.5 flex flex-col justify-center cursor-text">
          <span className="text-[11px] text-slate-400">Expiración (días)</span>
          <input
            type="number"
            min="1"
            max="365"
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            placeholder="90"
            className="mt-0.5 w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </label>
        <label className="md:col-span-2 px-3.5 py-2.5 flex flex-col justify-center cursor-text">
          <span className="text-[11px] text-slate-400">Límite usos</span>
          <input
            type="number"
            min="1"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="Ilimitado"
            className="mt-0.5 w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </label>
        <div className="md:col-span-2 p-2 flex items-center justify-center">
          <button
            type="submit"
            disabled={!name.trim() || creating}
            className="w-full h-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-45 px-3 py-2 text-xs font-medium text-white transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>{creating ? 'Creando...' : 'Generar'}</span>
          </button>
        </div>
      </form>

      {createdPlaintext && (
        <div className="rounded-xl border border-amber-400/35 bg-amber-400/10 p-3.5 space-y-2">
          <div className="text-xs font-medium text-amber-300">
            Copia este token ahora. No volverá a mostrarse:
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-[#0A0A0C] px-3 py-2">
            <code className="font-tech text-[11px] text-[#F2F2F4] truncate">{createdPlaintext}</code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(createdPlaintext);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
              className="inline-flex items-center gap-1 text-[11px] text-[#2F6FED] hover:text-white cursor-pointer shrink-0"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? 'Copiado' : 'Copiar'}</span>
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {loading ? (
        <p className="text-xs text-[#9A9AA2]">Cargando tokens...</p>
      ) : tokens.length === 0 ? (
        <p className="text-xs text-[#9A9AA2]">No hay tokens de API emitidos en este espacio.</p>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {tokens.map((t) => (
            <div key={t.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[#F2F2F4]">{t.name}</span>
                  <code className="font-tech text-[11px] text-[#8E95A5]">{t.tokenPrefix}</code>
                  {t.revokedAt && (
                    <span className="rounded-full border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-400">
                      Revocado
                    </span>
                  )}
                </div>
                <div className="mt-0.5 font-tech text-[10.5px] text-[#8E95A5]">
                  Usos: {t.usesCount}
                  {t.maxUses ? ` / ${t.maxUses}` : ''}
                </div>
              </div>
              {!t.revokedAt && (
                <button
                  type="button"
                  onClick={() => void handleRevoke(t.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/[0.07] bg-[#141923]/75 hover:border-rose-500/40 px-2.5 py-1 text-[11px] text-rose-400 cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                  <span>Revocar</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
