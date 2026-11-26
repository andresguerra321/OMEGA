import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import { isDesktopApp } from '../lib/desktopBridge.js';
import { finishGoogleAuth, googleConnection, pendingGoogleAction, startGoogleAuth } from '../lib/googleAuth.js';

export function GoogleAccountLink() {
  const [connection, setConnection] = useState(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [open, setOpen] = useState(false);
  const formId = useId();
  const returning = useRef(false);
  const desktopAttempt = useRef(null);
  const desktop = isDesktopApp();

  useEffect(() => {
    if (returning.current) return;
    if (!desktop && pendingGoogleAction() === 'LINK') {
      returning.current = true;
      setConnection({ enabled: true, linked: false });
      setOpen(true);
      setBusy(true);
      finishGoogleAuth().then(({ action }) => {
        if (action !== 'LINK') throw new Error('No se pudo confirmar la vinculación.');
        setConnection({ enabled: true, linked: true });
      }).catch(err => setError(err.message)).finally(() => setBusy(false));
    } else {
      loadConnection();
    }
  }, [desktop]);
  useEffect(() => () => desktopAttempt.current?.abort(), []);

  function loadConnection() {
    setStatusError(false);
    googleConnection().then(setConnection).catch(() => setStatusError(true));
  }

  async function link(event) {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError('');
    const attempt = desktop ? new AbortController() : null;
    desktopAttempt.current = attempt;
    setPassword('');
    try {
      const result = await startGoogleAuth('LINK', { password }, undefined, attempt?.signal);
      if (attempt && !attempt.signal.aborted) {
        if (result?.action !== 'LINK') throw new Error('No se pudo confirmar la vinculación.');
        setConnection({ enabled: true, desktopEnabled: true, linked: true });
      }
    } catch (err) {
      if (!attempt?.signal.aborted) setError(err.message || String(err));
      setBusy(false);
    } finally {
      if (attempt) {
        desktopAttempt.current = null;
        setBusy(false);
      }
    }
  }

  if (connection?.enabled === false || (desktop && connection && !connection.desktopEnabled)) return null;

  return (
    <section aria-label="Acceso con Google" className="rounded-2xl border border-white/[0.07] bg-[#0F131B]/85 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-white">Acceso con Google</h2>
          <p role="status" className="mt-1 text-sm text-zinc-400">
            {statusError ? 'No se pudo consultar la conexión.' : connection ? 'Inicia sesión en OMEGA con tu cuenta de Google.' : 'Consultando la conexión…'}
          </p>
        </div>
        {connection?.linked ? (
          <span role="status" className="inline-flex items-center gap-2 text-sm text-emerald-400">
            <Check size={15} strokeWidth={1.75} aria-hidden="true" /> Vinculado
          </span>
        ) : statusError ? (
          <button type="button" onClick={loadConnection} className="min-h-11 rounded-lg border border-white/[0.07] bg-[#141923]/75 px-4 text-sm font-medium text-white hover:border-white/20 focus-visible:outline-2">
            Reintentar
          </button>
        ) : connection?.enabled && (
          <button type="button" aria-expanded={open} aria-controls={formId} onClick={() => setOpen(!open)}
            className={open
              ? 'inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-zinc-300 hover:bg-white/[0.06] focus-visible:outline-2'
              : 'grid min-h-[52px] w-full grid-cols-[20px_1fr_20px] items-center gap-3 rounded-lg bg-white px-4 py-3 text-[16px] font-semibold text-[#141923] transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white sm:w-[256px]'}>
            {open ? <><X size={16} strokeWidth={1.75} aria-hidden="true" /> Cerrar</> : (
              <>
                <img src="/google-mark.svg" alt="" width="20" height="20" />
                <span>Vincular Google</span>
                <ArrowRight size={16} strokeWidth={1.75} className="justify-self-end" aria-hidden="true" />
              </>
            )}
          </button>
        )}
      </div>
      {connection?.enabled && !connection.linked && (
        <form id={formId} hidden={!open} onSubmit={link} className="mt-5 space-y-4 border-t border-white/[0.06] pt-5 text-sm text-zinc-300">
          <div>
            <h3 className="font-semibold text-white">Confirma tu identidad</h3>
            <p className="mt-1">Ingresa tu contraseña de OMEGA. En Google, elige el mismo correo.</p>
          </div>
          <label className="block max-w-sm space-y-2">
            <span className="font-medium text-white">Contraseña de OMEGA</span>
            <input type="password" autoComplete="current-password" required maxLength={128} value={password}
              onChange={event => setPassword(event.target.value)}
              className="block h-[48px] w-full rounded-lg border border-white/[0.07] bg-[#141923]/75 px-4 text-[16px] text-white focus-visible:outline-2" />
          </label>
          <button type="submit" disabled={busy || !password}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#2F6FED] px-4 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60">
            {busy ? 'Verificando…' : 'Continuar a Google'}
            <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {desktopAttempt.current && (
            <div className="space-y-1">
              <p role="status">Confirma la conexión en tu navegador y vuelve a OMEGA.</p>
              <button type="button" className="underline underline-offset-4" onClick={() => desktopAttempt.current?.abort()}>Cancelar vinculación</button>
            </div>
          )}
          {error && <p role="alert" className="text-rose-400">{error}</p>}
        </form>
      )}
    </section>
  );
}
