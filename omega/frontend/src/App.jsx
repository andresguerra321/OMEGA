import { useEffect, useState } from 'react';
import {
  Send,
  ShieldAlert,
  Layers,
  MessageSquare,
  Upload,
  Lock,
  FileSearch,
  ChevronRight,
  Radar,
} from 'lucide-react';
import {
  sendChatQuery,
  verifyMvtFile,
  verifyMvtText,
  fetchCampaigns,
  fetchCampaignDetail,
} from './lib/api';
import { CitationDrawer } from './components/CitationDrawer';
import { OsintPanel } from './components/OsintPanel';

const STARTER_PROMPTS = [
  '¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus?',
  '¿Qué sectores y regiones fueron objetivo en las campañas de Predator?',
  'Resume los vectores de infección iniciales descritos por Citizen Lab.',
];

function renderAnswerWithInlineCitations(text, citations, onSelectCitation) {
  if (!citations || citations.length === 0) return text;

  const citationMap = new Map(citations.map((c) => [c.index, c]));
  const parts = text.split(/(\[\d+\])/g);

  return parts.map((part, idx) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const num = Number(match[1]);
      const target = citationMap.get(num);
      if (target) {
        return (
          <button
            key={idx}
            type="button"
            onClick={() => onSelectCitation(target)}
            title={`${target.title} — Pág. ${target.page}`}
            className="mx-0.5 inline-flex items-center rounded border border-emerald-500/40 bg-emerald-950/60 px-1.5 py-0.2 font-mono text-[11px] font-medium text-emerald-300 hover:bg-emerald-900/80 transition cursor-pointer"
          >
            [{num}]
          </button>
        );
      }
    }
    return <span key={idx}>{part}</span>;
  });
}

export default function App() {
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'mvt' | 'campaigns'
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState(null);

  // Estado Verificador MVT (RF5, RNF4)
  const [iocText, setIocText] = useState('');
  const [mvtResult, setMvtResult] = useState(null);
  const [loadingMvt, setLoadingMvt] = useState(false);

  // Estado Campañas (RF6)
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);

  useEffect(() => {
    if (activeTab === 'campaigns' && campaigns.length === 0) {
      fetchCampaigns()
        .then((data) => setCampaigns(data.campaigns || []))
        .catch(() => setCampaigns([]));
    }
  }, [activeTab, campaigns.length]);

  async function handleSend(customPrompt) {
    const query = (customPrompt ?? input).trim();
    if (!query || loadingChat) return;

    const historyPayload = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: query }]);
    setInput('');
    setLoadingChat(true);

    try {
      const res = await sendChatQuery(query, historyPayload);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.answer,
          citations: res.citations || [],
          model: res.model,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Error conectando con la API de Omega. Verifica que FastAPI esté activo en el puerto 8000.',
          citations: [],
        },
      ]);
    } finally {
      setLoadingChat(false);
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadingMvt(true);
    try {
      const res = await verifyMvtFile(file);
      setMvtResult(res);
    } finally {
      setLoadingMvt(false);
      e.target.value = '';
    }
  }

  async function handleTextVerify(e) {
    e.preventDefault();
    if (!iocText.trim()) return;
    setLoadingMvt(true);
    try {
      const res = await verifyMvtText(iocText);
      setMvtResult(res);
    } finally {
      setLoadingMvt(false);
    }
  }

  async function openCampaign(id) {
    const detail = await fetchCampaignDetail(id);
    setSelectedCampaign(detail);
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Barra superior minimalista */}
      <header className="sticky top-0 z-30 border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />
            <span className="text-sm font-semibold tracking-tight">OMEGA</span>
            <span className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
              CTI Defensivo
            </span>
          </div>

          <nav className="flex items-center gap-1 rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-1">
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                activeTab === 'chat'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Consulta RAG</span>
            </button>
            <button
              onClick={() => setActiveTab('mvt')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                activeTab === 'mvt'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileSearch className="h-3.5 w-3.5" />
              <span>Verificador IOC / MVT</span>
            </button>
            <button
              onClick={() => setActiveTab('campaigns')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                activeTab === 'campaigns'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Campañas</span>
            </button>
            <button
              onClick={() => setActiveTab('osint')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                activeTab === 'osint'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Radar className="h-3.5 w-3.5" />
              <span>OSINT Propio</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Contenido Principal */}
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-8">
        {activeTab === 'chat' && (
          <div className="flex flex-1 flex-col justify-between">
            {messages.length === 0 ? (
              <div className="my-auto space-y-8 py-12 text-center">
                <div className="space-y-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
                    Inteligencia de Amenazas sobre Spyware Comercial
                  </h1>
                  <p className="mx-auto max-w-lg text-sm text-zinc-400">
                    Consulta reportes técnicos de Citizen Lab, Amnesty Tech y Google TAG. Cada respuesta incluye citas verificables al documento fuente.
                  </p>
                </div>

                <div className="mx-auto grid max-w-2xl gap-2.5 text-left">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => handleSend(prompt)}
                      className="flex items-center justify-between rounded-xl border border-zinc-800/90 bg-zinc-900/40 px-4 py-3 text-xs text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 transition"
                    >
                      <span>{prompt}</span>
                      <ChevronRight className="h-4 w-4 text-zinc-500" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6 pb-8">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`rounded-2xl p-5 ${
                      msg.role === 'user'
                        ? 'ml-auto max-w-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100'
                        : 'bg-zinc-900/40 border border-zinc-800/70 text-sm leading-relaxed text-zinc-200'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">
                      {msg.role === 'assistant'
                        ? renderAnswerWithInlineCitations(msg.content, msg.citations, setSelectedCitation)
                        : msg.content}
                    </div>

                    {/* Chips de divulgación progresiva (RNF2) */}
                    {msg.citations?.length > 0 && (
                      <div className="mt-4 border-t border-zinc-800/80 pt-3">
                        <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                          Fuentes citadas (clic para inspeccionar fragmento)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {msg.citations.map((cit) => (
                            <button
                              key={cit.index}
                              onClick={() => setSelectedCitation(cit)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-300 transition"
                            >
                              <span className="font-mono text-emerald-400">[{cit.index}]</span>
                              <span className="max-w-[200px] truncate">{cit.title}</span>
                              <span className="text-zinc-500">· p.{cit.page}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {loadingChat && (
                  <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/30 p-5 text-xs text-zinc-400 animate-pulse">
                    Recuperando fragmentos vectoriales y verificando trazabilidad...
                  </div>
                )}
              </div>
            )}

            {/* Barra de entrada fija */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="sticky bottom-6 mt-4 flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/90 p-2 shadow-xl backdrop-blur-md"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Pregunta sobre CVEs, vectores zero-click, campañas o actores..."
                className="flex-1 bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={loadingChat || !input.trim()}
                className="flex items-center gap-1.5 rounded-xl bg-zinc-100 px-4 py-2 text-xs font-medium text-zinc-950 hover:bg-white disabled:opacity-40 transition"
              >
                <span>Consultar</span>
                <Send className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>
        )}

        {/* Vista 2: Verificador Forense MVT / IOCs (RF5, RNF4) */}
        {activeTab === 'mvt' && (
          <div className="space-y-6">
            <div className="flex items-start justify-between rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">Cruce de Indicadores de Compromiso (IOC)</h2>
                <p className="text-xs text-zinc-400">
                  Carga la salida JSON de Mobile Verification Toolkit (MVT) o pega dominios, IPs o hashes SHA-256 sospechosos.
                </p>
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-1.5 text-[11px] text-emerald-300">
                <Lock className="h-3.5 w-3.5" />
                <span>Procesamiento volátil en RAM (RNF4)</span>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/20 p-6 text-center hover:border-zinc-500 transition">
                <Upload className="mb-2 h-6 w-6 text-zinc-400" />
                <span className="text-xs font-medium text-zinc-200">
                  Subir archivo JSON / TXT de MVT
                </span>
                <span className="mt-1 text-[11px] text-zinc-500">
                  No se almacena en servidor ni base de datos
                </span>
                <input type="file" accept=".json,.txt,.log" onChange={handleFileUpload} className="hidden" />
              </label>

              <form onSubmit={handleTextVerify} className="flex flex-col gap-2">
                <textarea
                  rows={4}
                  value={iocText}
                  onChange={(e) => setIocText(e.target.value)}
                  placeholder="O pega aquí una lista de dominios, IPs o procesos (uno por línea)..."
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={loadingMvt || !iocText.trim()}
                  className="self-end rounded-lg bg-zinc-100 px-4 py-2 text-xs font-medium text-zinc-950 hover:bg-white disabled:opacity-40 transition"
                >
                  {loadingMvt ? 'Analizando...' : 'Cruzar contra base CTI'}
                </button>
              </form>
            </div>

            {mvtResult && (
              <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3 text-xs">
                  <span className="text-zinc-400">
                    Indicadores evaluados: <strong className="text-zinc-100">{mvtResult.analyzed_indicators}</strong>
                  </span>
                  <span
                    className={`font-medium ${
                      mvtResult.total_matches > 0 ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  >
                    Coincidencias: {mvtResult.total_matches}
                  </span>
                </div>

                {mvtResult.matches.length === 0 ? (
                  <p className="text-xs text-zinc-400">
                    Sin coincidencias contra los indicadores públicos indexados actualmente.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {mvtResult.matches.map((m, i) => (
                      <div
                        key={i}
                        className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-3.5 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-semibold text-rose-300">
                            [{m.ioc_type.toUpperCase()}] {m.ioc_value}
                          </span>
                          <span className="rounded bg-rose-950 px-2 py-0.5 text-[11px] text-rose-200">
                            {m.spyware_family}
                          </span>
                        </div>
                        <p className="text-zinc-300">Campaña: {m.campaign}</p>
                        <p className="text-zinc-400">Fuente: {m.source_report} ({m.organization})</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Vista 3: Explorador de Campañas Normalizadas (RF6) */}
        {activeTab === 'campaigns' && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold">Campañas Documentadas</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {campaigns.map((c) => (
                <button
                  key={c.id}
                  onClick={() => openCampaign(c.id)}
                  className="flex flex-col justify-between rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-left hover:border-zinc-700 transition"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                        {c.spyware_family}
                      </span>
                      <span className="text-[11px] text-zinc-500">{c.first_seen_date || 'Fecha N/D'}</span>
                    </div>
                    <h3 className="text-sm font-semibold text-zinc-100">{c.name}</h3>
                    <p className="line-clamp-2 text-xs text-zinc-400">{c.summary}</p>
                  </div>
                  <div className="mt-4 flex items-center gap-3 border-t border-zinc-800/80 pt-2.5 text-[11px] text-zinc-400">
                    <span>{c.cves?.length || 0} CVEs</span>
                    <span>·</span>
                    <span>{c.ioc_count} IOCs</span>
                  </div>
                </button>
              ))}
            </div>

            {selectedCampaign && (
              <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold">{selectedCampaign.name}</h3>
                  <button
                    onClick={() => setSelectedCampaign(null)}
                    className="text-xs text-zinc-400 hover:text-zinc-200"
                  >
                    Cerrar detalle
                  </button>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">{selectedCampaign.summary}</p>
                <div className="grid gap-3 text-xs sm:grid-cols-2">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                    <p className="text-zinc-500">Sector objetivo</p>
                    <p className="mt-1 font-medium text-zinc-200">
                      {selectedCampaign.target_sector || 'No especificado'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                    <p className="text-zinc-500">CVEs asociados</p>
                    <p className="mt-1 font-mono text-emerald-400">
                      {selectedCampaign.cves?.map((x) => x.cve_code).join(', ') || 'Ninguno registrado'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Vista 4: Módulo de Monitoreo de Exposición Propia (OSINT Defensivo - RF8, RNF8) */}
        {activeTab === 'osint' && <OsintPanel />}
      </main>

      <CitationDrawer citation={selectedCitation} onClose={() => setSelectedCitation(null)} />
    </div>
  );
}
