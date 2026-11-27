import { useEffect, useState } from 'react';
import { BrainCircuit, Check, ChevronDown } from 'lucide-react';
import { fetchLegalDocumentAiPolicy, acceptLegalDocumentAiPolicy } from '../lib/api.js';
import { PanelErrorBanner } from './PanelStatePrimitives';

const PROVIDERS = { LOCAL_TEXT: 'Índice local de texto', EXTRACTIVE: 'Lectura extractiva local', OLLAMA: 'Ollama', OPENAI: 'OpenAI', GROQ: 'Groq', OMNIROUTE: 'OmniRoute', CUSTOM: 'Servidor configurado' };

function Target({ value }) {
  return <div className="space-y-1 text-sm">
    <p className="text-white">{PROVIDERS[value.provider] || 'Proveedor configurado'} <span className="text-xs text-white/60">{value.model}</span></p>
    <p className="text-xs text-white/70">{value.destination === 'LOCAL' ? 'Se procesa en la instalación de OMEGA' : `Se envía a ${PROVIDERS[value.provider] || 'un proveedor externo'} (${value.destination})`}</p>
  </div>;
}

export function LegalDocumentAiPanel({ onPolicyChange }) {
  const [attempt, setAttempt] = useState(0);
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);
  useEffect(() => {
    let active = true;
    fetchLegalDocumentAiPolicy().then((value) => { if (active) { setPolicy(value); setError(''); onPolicyChange?.(value.accepted); } })
      .catch(() => { if (active) setError('No pudimos comprobar la política de documentos.'); });
    const refresh = () => { if (active) setAttempt((value) => value + 1); };
    window.addEventListener('omega:backend-ready', refresh);
    return () => { active = false; window.removeEventListener('omega:backend-ready', refresh); };
  }, [attempt, onPolicyChange]);

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

  return <details className="group rounded-xl border border-white/[0.07] bg-[#0F131B]/85">
    <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2.5 text-sm font-medium text-white focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
      <BrainCircuit size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-zinc-400" />
      <span>Uso de IA en documentos</span>
      {policy?.accepted && <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><Check size={14} strokeWidth={1.75} aria-hidden="true" /> Política aceptada</span>}
      {policy && !policy.accepted && <span className="text-xs text-amber-400">Aprobación pendiente</span>}
      {error && <span className="text-xs text-amber-400">Revisar estado</span>}
      <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" className="ml-auto shrink-0 text-zinc-400 group-open:rotate-180" />
    </summary>
    <div className="space-y-4 border-t border-white/[0.06] p-4">
    {error && <PanelErrorBanner message={error} onRetry={() => setAttempt((value) => value + 1)} />}
    {!policy ? !error && <p role="status" className="text-sm text-white/60">Comprobando proveedores…</p> : <>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2"><h3 className="text-sm font-medium text-white/75">Cómo se prepara el texto para buscarlo</h3><Target value={policy.disclosure.indexing} /></div>
        <div className="space-y-2"><h3 className="text-sm font-medium text-white/75">Quién procesa las respuestas del asistente</h3>{policy.disclosure.responses.map((value) => <Target key={value.provider} value={value} />)}</div>
      </div>
      <p className="text-xs text-white/60">En instalaciones web, «local» se refiere al servidor de OMEGA. Un servidor intermediario puede reenviar contenido a otros proveedores.</p>
      {!policy.accepted && <p className="text-sm text-amber-400">{policy.canAccept
        ? 'Revisa dónde se procesan los documentos y acepta la política para poder cargarlos y consultarlos.'
        : 'La persona que administra el espacio debe aprobar este uso de IA antes de que puedas cargar o consultar documentos.'}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {!policy.accepted && policy.canAccept && <button type="button" onClick={accept} disabled={accepting} className="rounded-lg border border-white/20 bg-white/[0.07] px-4 py-2 text-sm font-medium text-white hover:bg-white/[0.12] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">{accepting ? 'Guardando aceptación…' : 'Acepto esta política de documentos'}</button>}
        {policy.canAccept && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('omega:configure-local-ai'))} className="rounded-lg border border-white/[0.07] px-3 py-2 text-sm text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Configurar todo local (Ollama)</button>}
      </div>
    </>}
    </div>
  </details>;
}
