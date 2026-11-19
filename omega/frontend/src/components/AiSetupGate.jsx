import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ExternalLink, KeyRound, LoaderCircle, Sparkles } from 'lucide-react';
import { fetchSystemGovernance, fetchMfaStatus, testAiEngineConnection } from '../lib/api';
import { TwoFactorSettingsCard } from './TwoFactorSettingsCard';
import { isDesktopApp, saveDesktopRuntimeConfig } from '../lib/desktopBridge';

const GROQ = { provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' };
const STEPS = ['Tu cuenta', 'Conecta la IA', 'Protege tu cuenta'];

export function AiSetupGate({ enabled, accountId, authSession, forceSetup = false, onComplete, onLogout, children }) {
  const completionKey = accountId ? `omega_ai_setup_v2:${accountId}` : null;
  const completed = useRef(null);
  const [phase, setPhase] = useState('checking');
  const [step, setStep] = useState(0);
  const [engine, setEngine] = useState(null);
  const [mfaReady, setMfaReady] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);
  const heading = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    if (completed.current === null) {
      try { completed.current = Boolean(completionKey && window.localStorage.getItem(completionKey) === 'complete'); }
      catch { completed.current = false; }
    }
    let cancelled = false;
    Promise.all([fetchSystemGovernance(), fetchMfaStatus()]).then(([result, mfa]) => {
      if (cancelled) return;
      const active = result?.ai_engine;
      if (!active) throw new Error('No se pudo comprobar la configuración de IA.');
      setEngine(active);
      setPhase(active.configured && mfa?.mfaEnabled && completed.current && !forceSetup ? 'ready' : 'setup');
      setError('');
    }).catch(() => {
      if (!cancelled) { setPhase('error'); setError('No pudimos comprobar la configuración. Revisa la conexión e intenta de nuevo.'); }
    });
    return () => { cancelled = true; };
  }, [enabled, forceSetup, attempt, completionKey]);

  useEffect(() => { if (phase === 'setup') heading.current?.focus(); }, [step, phase]);

  async function connect() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      if (!isDesktopApp()) throw new Error('Configura Groq en el servidor de OMEGA y pulsa «Comprobar configuración».');
      const key = apiKey.trim();
      if (!key || /[\r\n\0]/.test(key)) throw new Error('Pega una clave válida de Groq.');
      const probe = await testAiEngineConnection({ ...GROQ, apiKey: key });
      if (!probe?.ok) throw new Error(probe?.message || 'Groq no pudo responder. Revisa tu clave e intenta de nuevo.');
      const saved = await saveDesktopRuntimeConfig({
        clearCustomProvider: true, omniRouteEnabled: false, clearOpenAiKey: true,
        groqApiKey: key, groqModel: GROQ.model,
      });
      setApiKey('');
      if (!saved?.ok) throw new Error('La clave se guardó, pero OMEGA no pudo aplicar la configuración. Intenta de nuevo.');
      let active;
      for (let retry = 0; retry < 20; retry += 1) {
        const result = await fetchSystemGovernance().catch(() => null);
        active = result?.ai_engine;
        if (active?.configured && active.active_provider === 'groq') break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!active?.configured || active.active_provider !== 'groq') throw new Error('El servicio todavía no activó Groq. Espera unos segundos y comprueba la configuración.');
      // Verify the saved configuration, without resending the secret from the input.
      const liveProbe = await testAiEngineConnection(GROQ);
      if (!liveProbe?.ok) throw new Error(liveProbe?.message || 'La configuración guardada no pudo generar una respuesta.');
      setEngine(active); setStep(2);
    } catch (err) { setError(err?.message || 'No se pudo conectar Groq.'); }
    finally { setBusy(false); inFlight.current = false; }
  }

  async function checkSaved() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await fetchSystemGovernance();
      const active = result?.ai_engine;
      if (!active?.configured) throw new Error('La IA todavía no está configurada. Conecta Groq para continuar.');
      const probe = await testAiEngineConnection({ provider: active.active_provider, model: active.active_model });
      if (!probe?.ok) throw new Error(probe?.message || 'El modelo configurado no pudo responder.');
      setEngine(active); setStep(2);
    } catch (err) { setError(err?.message || 'No se pudo comprobar la configuración.'); }
    finally { setBusy(false); inFlight.current = false; }
  }

  async function finish() {
    if (inFlight.current || !mfaReady) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const status = await fetchMfaStatus();
      if (!status?.mfaEnabled) throw new Error('Activa la verificación en dos pasos para continuar.');
      completed.current = true;
      try { if (completionKey) window.localStorage.setItem(completionKey, 'complete'); } catch { /* Complete this session if storage is unavailable. */ }
      setPhase('ready'); onComplete?.();
    } catch (err) { setError(err?.message || 'No se pudo comprobar la protección de tu cuenta.'); }
    finally { setBusy(false); inFlight.current = false; }
  }

  if (!enabled || phase === 'ready') return children;
  return <main className="flex min-h-dvh items-center justify-center bg-obsidian px-5 py-10 text-ink-primary">
    <div className="w-full max-w-4xl">
      <div className="mb-9 flex items-center justify-between gap-4">
        <span className="font-display text-sm font-semibold tracking-[0.2em]">OMEGA</span>
        <button type="button" onClick={onLogout} disabled={busy} className="text-sm text-ink-secondary hover:text-ink-primary disabled:opacity-50">Cerrar sesión</button>
      </div>
      {phase === 'checking' ? <p role="status" className="flex items-center gap-3 text-ink-secondary"><LoaderCircle className="h-5 w-5 motion-safe:animate-spin text-cobalt" />Comprobando tu espacio…</p>
        : phase === 'error' ? <div className="space-y-4"><p role="alert">{error}</p><button type="button" className="rounded-xl bg-cobalt px-5 py-3" onClick={() => { setPhase('checking'); setAttempt(value => value + 1); }}>Reintentar</button></div>
          : <>
            <ol aria-label="Configuración inicial" className="mb-9 grid grid-cols-3 gap-3">
              {STEPS.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={`border-t-2 pt-3 text-sm ${index <= step ? 'border-cobalt text-ink-primary' : 'border-white/10 text-ink-secondary'}`}>
                <span className="mb-1 block font-tech text-xs text-ink-secondary">0{index + 1}</span>{label}
              </li>)}
            </ol>
            <section className="rounded-3xl border border-white/10 bg-surface p-6 sm:p-10" aria-labelledby="setup-title" aria-busy={busy}>
              {step === 0 ? <>
                <Sparkles className="mb-5 h-8 w-8 text-cobalt" aria-hidden="true" />
                <h1 id="setup-title" ref={heading} tabIndex={-1} className="text-3xl font-semibold tracking-tight outline-none">Tu cuenta está lista.<br />Activemos tu copiloto.</h1>
                <p className="mt-4 max-w-xl leading-relaxed text-ink-secondary">Conecta la IA para resumir hallazgos y protege tu cuenta con una app autenticadora o un código por correo.</p>
                <p className="mt-4 text-sm text-ink-secondary">La configuración es obligatoria antes de entrar a OMEGA.</p>
                <button type="button" onClick={() => setStep(1)} className="mt-8 inline-flex items-center gap-2 rounded-xl bg-cobalt px-5 py-3 font-semibold">Configurar copiloto <ArrowRight className="h-4 w-4" /></button>
              </> : step === 1 ? <>
                <KeyRound className="mb-5 h-8 w-8 text-cobalt" aria-hidden="true" />
                <h1 id="setup-title" ref={heading} tabIndex={-1} className="text-3xl font-semibold outline-none">Conecta tu IA</h1>
                <p className="mt-3 text-ink-secondary">Crea una clave en Groq, pégala aquí y nosotros comprobamos la conexión.</p>
                {isDesktopApp() && <form onSubmit={event => { event.preventDefault(); void connect(); }} className="mt-6 max-w-xl space-y-4">
                  <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-ink-primary underline decoration-cobalt underline-offset-4">Obtener mi clave de Groq <ExternalLink className="h-4 w-4" /></a>
                  <div><label htmlFor="setup-groq-key" className="mb-2 block text-sm">Clave de API de Groq</label>
                    <input id="setup-groq-key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} maxLength={2048} placeholder="gsk_…" aria-describedby="setup-key-note" className="w-full rounded-xl border border-white/15 bg-obsidian px-4 py-3 outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/30" />
                  </div>
                  <p id="setup-key-note" className="text-sm leading-relaxed text-ink-secondary">Tu clave se guarda en esta computadora. Las consultas y el contexto que adjuntes se enviarán a Groq. El uso se rige por tu cuenta de Groq.</p>
                  <button type="submit" disabled={busy || !apiKey.trim()} className="inline-flex items-center gap-2 rounded-xl bg-cobalt px-5 py-3 font-semibold disabled:opacity-50">{busy && <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" />}{busy ? 'Conectando y comprobando…' : 'Conectar y continuar'}</button>
                </form>}
                {(!isDesktopApp() || engine?.configured || error) && <button type="button" disabled={busy} onClick={() => void checkSaved()} className="mt-5 block text-sm underline underline-offset-4 disabled:opacity-50">Comprobar configuración guardada</button>}
                {!isDesktopApp() && <p className="mt-4 text-sm text-ink-secondary">Pide al administrador conectar el proveedor de IA en el servidor.</p>}
                {error && <p role="alert" className="mt-4 text-sm text-ink-primary">{error}</p>}
                <button type="button" disabled={busy} onClick={() => { setError(''); setStep(0); }} className="mt-7 inline-flex items-center gap-2 text-sm text-ink-secondary disabled:opacity-50"><ArrowLeft className="h-4 w-4" />Atrás</button>
              </> : <>
                <Check className="mb-5 h-9 w-9 text-cobalt" aria-hidden="true" />
                <h1 id="setup-title" ref={heading} tabIndex={-1} className="text-3xl font-semibold outline-none">Protege tu cuenta</h1>
                <p className="mt-4 text-ink-secondary">La IA está conectada con {engine?.active_provider}. Activa la verificación en dos pasos y guarda tus códigos de respaldo para terminar.</p>
                <TwoFactorSettingsCard authSession={authSession} required onReadyChange={setMfaReady} />
                {error && <p role="alert" className="mt-4 text-sm">{error}</p>}
                <button type="button" disabled={!mfaReady || busy} onClick={() => void finish()}
                  className="mt-8 inline-flex items-center gap-2 rounded-xl bg-cobalt px-5 py-3 font-semibold disabled:opacity-50">{busy ? 'Comprobando…' : 'Entrar a OMEGA'} <ArrowRight className="h-4 w-4" /></button>
              </>}
            </section>
          </>}
    </div>
  </main>;
}
