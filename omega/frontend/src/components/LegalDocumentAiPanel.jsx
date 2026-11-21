import { useEffect, useState } from 'react';
import { BrainCircuit, Check } from 'lucide-react';
import { fetchLegalDocumentAiPolicy, acceptLegalDocumentAiPolicy } from '../lib/api.js';
import { PanelErrorBanner } from './PanelStatePrimitives';

const PROVIDERS = { LOCAL_TEXT: 'Índice local de texto', EXTRACTIVE: 'Lectura extractiva local', OLLAMA: 'Ollama', OPENAI: 'OpenAI', GROQ: 'Groq', OMNIROUTE: 'OmniRoute', CUSTOM: 'Servidor configurado' };

function Target({ value }) {
  return <div className="space-y-1 text-sm">
    <p className="text-white">{PROVIDERS[value.provider] || 'Proveedor configurado'} <span className="text-xs text-white/60">{value.model}</span></p>
    <p className="text-xs text-white/60">{value.destination === 'LOCAL' ? 'Se queda en tu equipo' : `Sale a: ${PROVIDERS[value.provider] || 'proveedor configurado'} (${value.destination})`}</p>
  </div>;
}

export function LegalDocumentAiPanel() {
  const [attempt, setAttempt] = useState(0);
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);
  useEffect(() => {
    let active = true;
    fetchLegalDocumentAiPolicy().then((value) => { if (active) { setPolicy(value); setError(''); } })
      .catch(() => { if (active) setError('No pudimos comprobar la política de documentos.'); });
    const refresh = () => { if (active) setAttempt((value) => value + 1); };
    window.addEventListener('omega:backend-ready', refresh);
    return () => { active = false; window.removeEventListener('omega:backend-ready', refresh); };
  }, [attempt]);

  async function accept() {
    setAccepting(true); setError('');
    try {
      await acceptLegalDocumentAiPolicy(policy.fingerprint);
      setAttempt((value) => value + 1);
      window.dispatchEvent(new CustomEvent('omega:legal-ai-policy-changed'));
    } catch {
      setError('No se pudo aceptar la política. Revisa la configuración actual e intenta de nuevo.');
      setAttempt((value) => value + 1);
    } finally { setAccepting(false); }
  }

  return <section aria-labelledby="document-ai-title" className="space-y-4 rounded-2xl border border-white/[0.07] bg-[#0F131B]/85 p-5 backdrop-blur-md">
    <h2 id="document-ai-title" className="flex items-center gap-2 font-medium text-white"><BrainCircuit size={16} strokeWidth={1.75} aria-hidden="true" /> IA de tus documentos</h2>
    {error && <PanelErrorBanner message={error} onRetry={() => setAttempt((value) => value + 1)} />}
    {!policy ? !error && <p role="status" className="text-sm text-white/60">Comprobando proveedores…</p> : <>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2"><h3 className="text-xs font-medium text-white/60">Indexación de documentos</h3><Target value={policy.disclosure.indexing} /></div>
        <div className="space-y-2"><h3 className="text-xs font-medium text-white/60">Modelo de respuestas y posibles alternativas</h3>{policy.disclosure.responses.map((value) => <Target key={value.provider} value={value} />)}</div>
      </div>
      <p className="text-xs text-white/60">En instalaciones web, «local» se refiere al servidor de OMEGA. Un servidor intermediario puede reenviar contenido a otros proveedores.</p>
      {!policy.accepted && <p className="text-sm text-amber-400">Antes de cargar o consultar documentos, un administrador debe aceptar los proveedores mostrados. La aceptación queda auditada.</p>}
      {policy.accepted && <p role="status" className="flex items-center gap-2 text-xs text-emerald-400"><Check size={14} strokeWidth={1.75} aria-hidden="true" /> Política aceptada para esta configuración</p>}
      <div className="flex flex-wrap items-center gap-3">
        {!policy.accepted && policy.canAccept && <button type="button" onClick={accept} disabled={accepting} className="rounded-lg bg-[#2F6FED] px-4 py-2 text-sm text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">{accepting ? 'Guardando aceptación…' : 'Acepto esta política de documentos'}</button>}
        {policy.canAccept && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('omega:configure-local-ai'))} className="rounded-lg border border-white/[0.07] px-3 py-2 text-sm text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Configurar todo local (Ollama)</button>}
      </div>
    </>}
  </section>;
}
