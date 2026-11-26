import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ExternalLink, KeyRound, LoaderCircle, Sparkles } from 'lucide-react';
import { fetchSystemGovernance, fetchMfaStatus, testAiEngineConnection } from '../lib/api';
import { TwoFactorSettingsCard } from './TwoFactorSettingsCard';
import { OmegaBrandMark } from './OmegaBrandMark';
import { isDesktopApp, saveDesktopRuntimeConfig } from '../lib/desktopBridge';

const PROVIDER_PRESETS = [
  {
    id: 'groq',
    label: 'Groq (Recomendado)',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    keyRequired: true,
    baseEditable: false,
    placeholder: 'gsk_…',
    docsUrl: 'https://console.groq.com/keys',
    docsLabel: 'Obtener mi clave de Groq',
  },
  {
    id: 'ollama',
    label: 'Ollama Local',
    baseUrl: 'http://host.docker.internal:11434/v1',
    model: 'llama3.2',
    keyRequired: false,
    baseEditable: true,
    placeholder: 'No requiere API Key',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyRequired: true,
    baseEditable: false,
    placeholder: 'sk-…',
    docsUrl: 'https://platform.openai.com/api-keys',
    docsLabel: 'Obtener clave de OpenAI',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    keyRequired: true,
    baseEditable: false,
    placeholder: 'AIza…',
    docsUrl: 'https://aistudio.google.com/apikey',
    docsLabel: 'Obtener clave de Gemini',
  },
  {
    id: 'custom',
    label: 'Otro (/v1)',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct',
    keyRequired: false,
    baseEditable: true,
    placeholder: 'sk-or-… (opcional)',
  },
];
const STEPS = ['Tu cuenta', 'Conecta la IA', 'Protege tu cuenta'];

export function AiSetupGate({ enabled, accountId, authSession, forceSetup = false, onComplete, onLogout, children }) {
  const completionKey = accountId ? `omega_ai_setup_v2:${accountId}` : null;
  const setupPending = useRef(false);
  const [phase, setPhase] = useState('checking');
  const [step, setStep] = useState(0);
  const [engine, setEngine] = useState(null);
  const [mfaReady, setMfaReady] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [providerId, setProviderId] = useState('groq');
  const [customBaseUrl, setCustomBaseUrl] = useState('https://api.groq.com/openai/v1');
  const [customModel, setCustomModel] = useState('openai/gpt-oss-120b');
  const [showOtherProviders, setShowOtherProviders] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);
  const heading = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const configureLocal = () => {
      const local = PROVIDER_PRESETS.find((preset) => preset.id === 'ollama');
      setProviderId(local.id); setCustomBaseUrl(local.baseUrl); setCustomModel(local.model);
      setApiKey(''); setError(''); setShowOtherProviders(true); setStep(1); setPhase('setup');
    };
    window.addEventListener('omega:configure-local-ai', configureLocal);
    return () => window.removeEventListener('omega:configure-local-ai', configureLocal);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (forceSetup) {
      setupPending.current = true;
      try { if (completionKey) window.localStorage.setItem(completionKey, 'pending'); } catch { /* Track the pending setup in this session. */ }
    } else if (completionKey) {
      try { setupPending.current = window.localStorage.getItem(completionKey) === 'pending'; } catch { /* Keep the current session state. */ }
    }
    let cancelled = false;
    Promise.all([fetchSystemGovernance(), fetchMfaStatus()]).then(([result, mfa]) => {
      if (cancelled) return;
      const active = result?.ai_engine;
      if (!active) throw new Error('No se pudo comprobar la configuración de IA.');
      setEngine(active);
      setPhase(active.configured && mfa?.mfaEnabled && !setupPending.current ? 'ready' : 'setup');
      setError('');
    }).catch(() => {
      if (!cancelled) { setPhase('error'); setError('No pudimos comprobar la configuración. Revisa la conexión e intenta de nuevo.'); }
    });
    return () => { cancelled = true; };
  }, [enabled, forceSetup, attempt, completionKey]);

  useEffect(() => { if (phase === 'setup') heading.current?.focus(); }, [step, phase]);

  const activePreset = PROVIDER_PRESETS.find((p) => p.id === providerId) || PROVIDER_PRESETS[0];

  function selectProvider(id) {
    const preset = PROVIDER_PRESETS.find((p) => p.id === id) || PROVIDER_PRESETS[0];
    setProviderId(preset.id);
    setCustomBaseUrl(preset.baseUrl);
    setCustomModel(preset.model);
    setError('');
  }

  async function connect() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      if (!isDesktopApp()) throw new Error('Configura tu proveedor de IA en el servidor de OMEGA y pulsa «Comprobar configuración».');
      const key = apiKey.trim();
      const targetModel = (customModel || activePreset.model).trim();
      const targetBase = (customBaseUrl || activePreset.baseUrl).trim();
      if (activePreset.keyRequired && (!key || /[\r\n\0]/.test(key))) {
        throw new Error(`Pega una clave válida de ${activePreset.label}.`);
      }
      if (/[\r\n\0]/.test(key)) throw new Error('La clave contiene caracteres inválidos.');

      const probeTarget = {
        provider: providerId,
        baseUrl: targetBase,
        model: targetModel,
        ...(key ? { apiKey: key } : {}),
      };
      const probe = await testAiEngineConnection(probeTarget);
      if (!probe?.ok) throw new Error(probe?.message || `${activePreset.label} no pudo responder. Revisa la configuración e intenta de nuevo.`);

      let payload;
      if (providerId === 'groq') {
        payload = {
          clearCustomProvider: true, omniRouteEnabled: false, clearOpenAiKey: true,
          groqApiKey: key, groqModel: targetModel,
        };
      } else if (providerId === 'openai') {
        payload = {
          clearCustomProvider: true, omniRouteEnabled: false,
          openAiApiKey: key, openAiChatModel: targetModel,
        };
      } else {
        payload = {
          customProvider: providerId,
          customBaseUrl: targetBase,
          customApiKey: key,
          clearCustomKey: Boolean(!key && providerId === 'ollama'),
          customModel: targetModel,
        };
      }

      const saved = await saveDesktopRuntimeConfig(payload);
      setApiKey('');
      if (!saved?.ok) throw new Error('La clave se guardó, pero OMEGA no pudo aplicar la configuración. Intenta de nuevo.');
      let active;
      for (let retry = 0; retry < 20; retry += 1) {
        const result = await fetchSystemGovernance().catch(() => null);
        active = result?.ai_engine;
        if (active?.configured) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!active?.configured) throw new Error(`El servicio todavía no activó ${activePreset.label}. Espera unos segundos y comprueba la configuración.`);
      // Verify the saved configuration, without resending the secret from the input.
      const liveProbe = await testAiEngineConnection({ provider: providerId, baseUrl: targetBase, model: targetModel });
      if (!liveProbe?.ok) throw new Error(liveProbe?.message || 'La configuración guardada no pudo generar una respuesta.');
      setEngine(active); setStep(2);
    } catch (err) { setError(err?.message || `No se pudo conectar ${activePreset.label}.`); }
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
      setupPending.current = false;
      try { if (completionKey) window.localStorage.setItem(completionKey, 'complete'); } catch { /* Complete this session if storage is unavailable. */ }
      setPhase('ready'); onComplete?.();
    } catch (err) { setError(err?.message || 'No se pudo comprobar la protección de tu cuenta.'); }
    finally { setBusy(false); inFlight.current = false; }
  }

  if (!enabled || phase === 'ready') return children;
  return <main className="flex min-h-dvh items-center justify-center bg-obsidian px-5 py-10 text-ink-primary">
    <div className="w-full max-w-4xl">
      <div className="mb-9 flex items-center justify-between gap-4">
        <OmegaBrandMark />
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
                <p className="mt-4 max-w-xl leading-relaxed text-ink-secondary">{engine?.configured ? 'La IA ya está configurada en esta instalación. Comprueba su conexión y termina de proteger tu cuenta.' : 'Conecta la IA para resumir hallazgos y protege tu cuenta con una app autenticadora o un código por correo.'}</p>
                <p className="mt-4 text-sm text-ink-secondary">La configuración es obligatoria antes de entrar a OMEGA.</p>
                <button type="button" disabled={busy} onClick={() => engine?.configured ? void checkSaved() : setStep(1)} className="mt-8 inline-flex items-center gap-2 rounded-lg bg-cobalt px-5 py-3 font-semibold disabled:opacity-50">{busy ? 'Comprobando…' : engine?.configured ? 'Usar la IA disponible' : 'Configurar copiloto'} <ArrowRight className="h-4 w-4" /></button>
                {engine?.configured && <details className="mt-4 text-sm text-ink-secondary"><summary className="cursor-pointer rounded-lg py-2">Opciones avanzadas</summary><button type="button" className="rounded-lg border border-white/[0.07] px-3 py-2" onClick={() => setStep(1)}>Configurar otro proveedor</button></details>}
              </> : step === 1 ? <>
                <KeyRound className="mb-5 h-8 w-8 text-cobalt" aria-hidden="true" />
                <h1 id="setup-title" ref={heading} tabIndex={-1} className="text-3xl font-semibold outline-none">Conecta tu IA</h1>
                <p className="mt-3 text-ink-secondary">
                  {providerId === 'groq'
                    ? 'Usa Groq gratis como opción rápida o elige otro modelo que ya tengas disponible.'
                    : `Configura ${activePreset.label} para activar el asistente en OMEGA.`}
                </p>

                {isDesktopApp() && <form onSubmit={event => { event.preventDefault(); void connect(); }} className="mt-5 max-w-xl space-y-4">
                  {activePreset.docsUrl && (
                    <a href={activePreset.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-ink-primary underline decoration-cobalt underline-offset-4">
                      {activePreset.docsLabel} <ExternalLink className="h-4 w-4" />
                    </a>
                  )}

                  <div>
                    <label htmlFor="setup-groq-key" className="mb-2 block text-sm">
                      Clave de API de {activePreset.label} {!activePreset.keyRequired ? '(opcional)' : ''}
                    </label>
                    <input id="setup-groq-key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} maxLength={2048} placeholder={activePreset.placeholder} aria-describedby="setup-key-note" className="w-full rounded-xl border border-white/15 bg-obsidian px-4 py-3 outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/30" />
                  </div>

                  {showOtherProviders && (
                    <div className="space-y-3 rounded-2xl border border-white/10 bg-obsidian/70 p-4">
                      <div className="text-xs font-medium text-ink-secondary">Elige tu proveedor o modelo disponible:</div>
                      <div className="flex flex-wrap gap-2">
                        {PROVIDER_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            disabled={busy}
                            onClick={() => selectProvider(preset.id)}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                              providerId === preset.id
                                ? 'border-cobalt bg-cobalt/20 text-white'
                                : 'border-white/10 bg-white/[0.03] text-ink-secondary hover:text-white'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>

                      {providerId !== 'groq' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                          {activePreset.baseEditable && (
                            <div>
                              <label htmlFor="setup-base-url" className="mb-1 block text-xs text-ink-secondary">Endpoint Base URL</label>
                              <input id="setup-base-url" type="text" value={customBaseUrl} onChange={e => setCustomBaseUrl(e.target.value)} disabled={busy} className="w-full rounded-lg border border-white/15 bg-surface px-3 py-2 text-xs font-tech outline-none focus:border-cobalt" />
                            </div>
                          )}
                          <div className={activePreset.baseEditable ? '' : 'sm:col-span-2'}>
                            <label htmlFor="setup-model-id" className="mb-1 block text-xs text-ink-secondary">Modelo (Model ID)</label>
                            <input id="setup-model-id" type="text" value={customModel} onChange={e => setCustomModel(e.target.value)} disabled={busy} className="w-full rounded-lg border border-white/15 bg-surface px-3 py-2 text-xs font-tech outline-none focus:border-cobalt" />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <p id="setup-key-note" className="text-sm leading-relaxed text-ink-secondary">
                    {providerId === 'ollama'
                      ? 'Se conectará directamente a tu instancia local de Ollama sin enviar datos fuera de tu equipo.'
                      : `Tu clave se guarda en esta computadora. Las consultas y el contexto que adjuntes se enviarán a ${activePreset.label}.`}
                  </p>

                  <div className="flex flex-wrap items-center gap-4">
                    <button type="submit" disabled={busy || (activePreset.keyRequired && !apiKey.trim())} className="inline-flex items-center gap-2 rounded-xl bg-cobalt px-5 py-3 font-semibold disabled:opacity-50 cursor-pointer">
                      {busy && <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" />}
                      {busy ? 'Conectando y comprobando…' : 'Conectar y continuar'}
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setShowOtherProviders((v) => !v)}
                      className="text-sm text-ink-primary underline decoration-cobalt underline-offset-4 hover:text-white cursor-pointer"
                    >
                      {showOtherProviders ? 'Ocultar otros modelos' : '¿Tienes otro modelo disponible?'}
                    </button>
                  </div>
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
