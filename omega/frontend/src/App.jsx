import { useState } from 'react';
import {
  MessageSquare,
  Layers,
  Laptop,
  Radar,
  Link2,
  Settings,
  Send,
  ChevronRight,
} from 'lucide-react';
import { sendChatQuery } from './lib/api';
import { CitationDrawer } from './components/CitationDrawer';
import { MarkdownMessage } from './components/MarkdownMessage';
import { CampaignsPanel } from './components/CampaignsPanel';
import { MvtVerifierPanel } from './components/MvtVerifierPanel';
import { OsintPanel } from './components/OsintPanel';
import { LinkVerifierPanel } from './components/LinkVerifierPanel';
import { SettingsPanel } from './components/SettingsPanel';

const NAV_ITEMS = [
  {
    id: 'preguntar',
    label: 'Preguntar',
    subtitle: 'Consultas con citas',
    icon: MessageSquare,
  },
  {
    id: 'amenazas',
    label: 'Amenazas',
    subtitle: 'Campañas, CVEs y actores',
    icon: Layers,
  },
  {
    id: 'equipo',
    label: 'Revisar mi equipo',
    subtitle: 'Verificación forense',
    icon: Laptop,
  },
  {
    id: 'exposicion',
    label: 'Mi exposición',
    subtitle: 'Qué hay público sobre mí',
    icon: Radar,
  },
  {
    id: 'enlace',
    label: 'Verificar enlace',
    subtitle: 'Antes de abrirlo',
    icon: Link2,
  },
  {
    id: 'ajustes',
    label: 'Ajustes',
    subtitle: 'Cuenta y permisos',
    icon: Settings,
  },
];

const STARTER_PROMPTS = [
  '¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus?',
  '¿Qué sectores y regiones fueron objetivo en las campañas de Predator?',
  'Resume los vectores de infección iniciales descritos por Citizen Lab.',
];

export default function App() {
  const [activeNav, setActiveNav] = useState('preguntar');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState(null);
  const [topK, setTopK] = useState(6);

  async function handleSend(customPrompt) {
    const query = (customPrompt ?? input).trim();
    if (!query || loadingChat) return;

    const historyPayload = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: query }]);
    setInput('');
    setLoadingChat(true);

    try {
      const res = await sendChatQuery(query, historyPayload, topK);
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
          content: 'No fue posible conectar con el servicio de Omega. Verifica que la API esté activa en el puerto 8000.',
          citations: [],
        },
      ]);
    } finally {
      setLoadingChat(false);
    }
  }

  function handleAskCampaignInChat(promptText) {
    setActiveNav('preguntar');
    handleSend(promptText);
  }

  return (
    <div className="min-h-screen flex bg-zinc-950 text-zinc-100">
      {/* Barra Lateral de Navegación (App de Escritorio — 6 módulos) */}
      <aside className="w-64 shrink-0 border-r border-zinc-900 bg-zinc-950/95 flex flex-col justify-between p-4">
        <div className="space-y-6">
          <div className="flex items-center gap-2.5 px-2 pt-1">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />
            <div>
              <p className="text-sm font-semibold tracking-tight leading-none">OMEGA</p>
              <p className="mt-1 text-[11px] text-zinc-500">App de escritorio · CTI</p>
            </div>
          </div>

          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  className={`w-full flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    active
                      ? 'bg-zinc-900 text-zinc-100 border border-zinc-800'
                      : 'text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200 border border-transparent'
                  }`}
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-emerald-400' : 'text-zinc-500'}`} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-tight">{item.label}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500 truncate">{item.subtitle}</p>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="rounded-xl border border-zinc-900 bg-zinc-900/30 p-3 text-[11px] text-zinc-500">
          Plataforma defensiva sobre spyware comercial · Fuentes públicas verificadas
        </div>
      </aside>

      {/* Área Principal */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-8 py-8">
          {activeNav === 'preguntar' && (
            <div className="flex flex-1 flex-col justify-between">
              {messages.length === 0 ? (
                <div className="my-auto space-y-8 py-12 text-center">
                  <div className="space-y-2">
                    <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
                      Consultas de Inteligencia con Citas Verificables
                    </h1>
                    <p className="mx-auto max-w-lg text-sm text-zinc-400">
                      Explora investigaciones técnicas de Citizen Lab, Amnesty Tech y Google TAG. Haz clic en cualquier cita numerada para inspeccionar el fragmento fuente.
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
                      {msg.role === 'assistant' ? (
                        <MarkdownMessage
                          content={msg.content}
                          citations={msg.citations}
                          onSelectCitation={setSelectedCitation}
                        />
                      ) : (
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      )}

                      {msg.citations?.length > 0 && (
                        <div className="mt-4 border-t border-zinc-800/80 pt-3">
                          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                            Fuentes citadas (clic para ver evidencia)
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
                      Buscando evidencia documental y verificando citas...
                    </div>
                  )}
                </div>
              )}

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
                  placeholder="Pregunta sobre CVEs, campañas, actores o vectores de infección..."
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

          {activeNav === 'amenazas' && <CampaignsPanel onAskInChat={handleAskCampaignInChat} />}
          {activeNav === 'equipo' && <MvtVerifierPanel />}
          {activeNav === 'exposicion' && <OsintPanel />}
          {activeNav === 'enlace' && <LinkVerifierPanel />}
          {activeNav === 'ajustes' && <SettingsPanel topK={topK} onChangeTopK={setTopK} />}
        </div>
      </main>

      <CitationDrawer citation={selectedCitation} onClose={() => setSelectedCitation(null)} />
    </div>
  );
}
