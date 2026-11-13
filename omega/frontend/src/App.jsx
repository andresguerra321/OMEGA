import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  MessageSquare,
  Layers,
  Laptop,
  Radar,
  Link2,
  Settings,
  Download,
  CornerDownLeft,
  ShieldCheck,
  FileSearch,
  Network,
  Trash2,
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
  { id: 'preguntar', label: 'Preguntar', subtitle: 'Consultas con citas', icon: MessageSquare },
  { id: 'amenazas', label: 'Amenazas', subtitle: 'Campañas, CVEs y actores', icon: Layers },
  { id: 'equipo', label: 'Revisar mi equipo', subtitle: 'Verificación forense', icon: Laptop },
  { id: 'exposicion', label: 'Mi exposición', subtitle: 'Qué hay público sobre mí', icon: Radar },
  { id: 'enlace', label: 'Verificar enlace', subtitle: 'Antes de abrirlo', icon: Link2 },
  { id: 'ajustes', label: 'Ajustes', subtitle: 'Cuenta y permisos', icon: Settings },
];

const STARTER_CARDS = [
  {
    icon: ShieldCheck,
    title: 'Exploits Zero-Click y CVEs',
    description: 'Consulta vulnerabilidades como FORCEDENTRY o BLASTPASS documentadas en Pegasus.',
    prompt: '¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus y qué versiones afectaron?',
  },
  {
    icon: Network,
    title: 'Campañas y Actores',
    description: 'Analiza operaciones de Predator, Candiru o NSO Group, sectores y regiones afectadas.',
    prompt: '¿Qué sectores y regiones fueron objetivo en las campañas de Predator e Intellexa?',
  },
  {
    icon: FileSearch,
    title: 'Vectores e Indicadores Forenses',
    description: 'Revisa mecanismos de infección inicial y artefactos hallados por Citizen Lab y Amnesty.',
    prompt: 'Resume los principales vectores de infección inicial y artefactos forenses descritos en los reportes.',
  },
];

const SESSIONS_STORAGE_KEY = 'omega_chat_sessions_v1';

export default function App() {
  const [activeNav, setActiveNav] = useState('preguntar');
  const [sessions, setSessions] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SESSIONS_STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  });
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [historyFilter, setHistoryFilter] = useState('');

  const [input, setInput] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState(null);
  const [topK, setTopK] = useState(6);

  useEffect(() => {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId) || null,
    [sessions, currentSessionId]
  );

  const messages = activeSession?.messages || [];

  const filteredSessions = useMemo(() => {
    if (!historyFilter.trim()) return sessions;
    const q = historyFilter.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, historyFilter]);

  function startNewChat() {
    setCurrentSessionId(null);
    setActiveNav('preguntar');
    setSelectedCitation(null);
  }

  function deleteSession(e, id) {
    e.stopPropagation();
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentSessionId === id) setCurrentSessionId(null);
  }

  async function handleSend(customPrompt) {
    const query = (customPrompt ?? input).trim();
    if (!query || loadingChat) return;

    let targetSessionId = currentSessionId;
    const userTurn = { role: 'user', content: query };

    if (!targetSessionId) {
      targetSessionId = crypto.randomUUID();
      const newSession = {
        id: targetSessionId,
        title: query.length > 48 ? `${query.slice(0, 48)}...` : query,
        updatedAt: new Date().toISOString(),
        messages: [userTurn],
      };
      setSessions((prev) => [newSession, ...prev]);
      setCurrentSessionId(targetSessionId);
    } else {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? { ...s, updatedAt: new Date().toISOString(), messages: [...s.messages, userTurn] }
            : s
        )
      );
    }

    const historyPayload = messages.map((m) => ({ role: m.role, content: m.content }));
    setInput('');
    setLoadingChat(true);

    try {
      const res = await sendChatQuery(query, historyPayload, topK);
      const assistantTurn = {
        role: 'assistant',
        content: res.answer,
        citations: res.citations || [],
        model: res.model,
      };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? { ...s, updatedAt: new Date().toISOString(), messages: [...s.messages, assistantTurn] }
            : s
        )
      );
    } catch {
      const errorTurn = {
        role: 'assistant',
        content:
          'No fue posible conectar con el motor de Omega. Verifica que el backend FastAPI esté activo en el puerto `8000`.',
        citations: [],
      };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId ? { ...s, messages: [...s.messages, errorTurn] } : s
        )
      );
    } finally {
      setLoadingChat(false);
    }
  }

  function handleExportSession() {
    if (!activeSession || messages.length === 0) return;

    const lines = [
      `# Sesión de Investigación CTI — ${activeSession.title}`,
      `- **Fecha:** ${new Date().toISOString()}`,
      `- **Sistema:** Omega Defensive Threat Intelligence`,
      '',
    ];

    messages.forEach((m) => {
      if (m.role === 'user') {
        lines.push(`## Consulta del Analista\n${m.content}\n`);
      } else {
        lines.push(`## Respuesta Trazable\n${m.content}\n`);
        if (m.citations?.length) {
          lines.push('### Fuentes Citadas');
          m.citations.forEach((c) => {
            lines.push(`- **[${c.index}]** ${c.title} (${c.organization}) — Pág. ${c.page}`);
          });
          lines.push('');
        }
      }
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omega_cti_session_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleAskCampaignInChat(promptText) {
    setCurrentSessionId(null);
    setActiveNav('preguntar');
    setTimeout(() => handleSend(promptText), 0);
  }

  const currentNavMeta = NAV_ITEMS.find((n) => n.id === activeNav);

  return (
    <div className="h-screen flex overflow-hidden bg-[#0A0A0C] text-[#F2F2F4]">
      {/* Sidebar Fija de Navegación (Estilo App de Escritorio) */}
      <aside className="w-[260px] shrink-0 border-r border-[#232329] bg-[#0A0A0C] flex flex-col justify-between">
        <div className="flex flex-col min-h-0 flex-1">
          {/* Identidad */}
          <div className="h-12 px-4 border-b border-[#232329] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-5 w-5 rounded-[4px] border border-[#2F6FED] bg-[#15223D] flex items-center justify-center">
                <div className="h-2 w-2 rounded-[2px] bg-[#2F6FED]" />
              </div>
              <span className="text-[13px] font-semibold tracking-wider text-[#F2F2F4]">
                OMEGA
              </span>
            </div>
            <span className="font-tech rounded-[4px] border border-[#232329] bg-[#141418] px-1.5 py-0.5 text-[10px] text-[#8E8E96]">
              v1.0
            </span>
          </div>

          {/* Acción Principal + Búsqueda en Historial */}
          <div className="p-3 space-y-2 border-b border-[#232329]">
            <button
              type="button"
              onClick={startNewChat}
              className="w-full flex items-center justify-center gap-2 rounded-[4px] bg-[#2F6FED] px-3 py-2 text-[12px] font-medium text-[#F2F2F4] hover:bg-[#255ED4] transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Nueva consulta</span>
            </button>

            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[#8E8E96]" />
              <input
                type="text"
                value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value)}
                placeholder="Filtrar historial..."
                className="w-full rounded-[4px] border border-[#232329] bg-[#141418] py-1.5 pl-8 pr-2.5 text-[12px] text-[#F2F2F4] placeholder-[#8E8E96] focus:border-[#2F6FED] focus:outline-none"
              />
            </div>
          </div>

          {/* Los 6 Módulos de Navegación */}
          <div className="p-2.5 space-y-0.5 border-b border-[#232329]">
            <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-[#8E8E96]">
              Módulos
            </p>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  className={`w-full flex items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#15223D] text-[#F2F2F4] border border-[#2F6FED]/40'
                      : 'text-[#8E8E96] hover:bg-[#141418] hover:text-[#F2F2F4] border border-transparent'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-[#2F6FED]' : 'text-[#8E8E96]'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium leading-tight">{item.label}</p>
                    <p className="text-[11px] text-[#8E8E96] truncate">{item.subtitle}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Historial de Consultas */}
          <div className="p-2.5 flex-1 overflow-y-auto space-y-1">
            <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-[#8E8E96]">
              Consultas recientes
            </p>
            {filteredSessions.length === 0 ? (
              <p className="px-2 py-2 text-[11px] text-[#8E8E96]">
                Sin sesiones registradas aún.
              </p>
            ) : (
              filteredSessions.map((sess) => {
                const selected = activeNav === 'preguntar' && sess.id === currentSessionId;
                return (
                  <div
                    key={sess.id}
                    onClick={() => {
                      setCurrentSessionId(sess.id);
                      setActiveNav('preguntar');
                    }}
                    className={`group flex items-center justify-between rounded-[4px] px-2.5 py-1.5 text-[12px] cursor-pointer transition-colors ${
                      selected
                        ? 'bg-[#141418] text-[#F2F2F4] border border-[#232329]'
                        : 'text-[#8E8E96] hover:bg-[#141418]/60 hover:text-[#F2F2F4]'
                    }`}
                  >
                    <span className="truncate pr-2">{sess.title}</span>
                    <button
                      type="button"
                      onClick={(e) => deleteSession(e, sess.id)}
                      title="Eliminar consulta"
                      className="opacity-0 group-hover:opacity-100 text-[#8E8E96] hover:text-[#F2F2F4] transition-opacity"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Pie de Sidebar (Estado Defensivo) */}
        <div className="p-3 border-t border-[#232329] bg-[#141418]/50 flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-2 text-[#8E8E96]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#2F6FED]" />
            <span>Entorno Defensivo</span>
          </div>
          <span className="font-tech text-[10px] text-[#8E8E96]">RNF1 · RNF4</span>
        </div>
      </aside>

      {/* Panel Principal */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0A0A0C]">
        {/* Barra Superior de Ventana */}
        <header className="h-12 shrink-0 border-b border-[#232329] px-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-[13px] font-medium text-[#F2F2F4]">
              {currentNavMeta?.label}
            </span>
            <span className="text-[#232329]">/</span>
            <span className="text-[12px] text-[#8E8E96]">{currentNavMeta?.subtitle}</span>
            {activeNav === 'preguntar' && (
              <span className="font-tech ml-2 rounded-[4px] border border-[#232329] bg-[#141418] px-2 py-0.5 text-[11px] text-[#8E8E96]">
                RAG Híbrido · Top-{topK}
              </span>
            )}
          </div>

          {activeNav === 'preguntar' && messages.length > 0 && (
            <button
              type="button"
              onClick={handleExportSession}
              className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-2.5 py-1 text-[12px] text-[#F2F2F4] hover:border-[#2F6FED] hover:bg-[#15223D] transition-colors cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-[#8E8E96]" />
              <span>Exportar sesión (.md)</span>
            </button>
          )}
        </header>

        {/* Contenido Dinámico por Módulo */}
        {activeNav === 'preguntar' ? (
          <main className="flex-1 flex flex-col min-h-0">
            {messages.length === 0 ? (
              /* Estado Inicial Centrado (Estilo App de Escritorio) */
              <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-6 py-10">
                <div className="w-full max-w-[740px] space-y-7">
                  {/* Encabezado Sobrio */}
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 rounded-[4px] border border-[#2F6FED]/30 bg-[#15223D] px-2.5 py-1 text-[11px] font-medium text-[#7AA7FF]">
                      <span>INTELIGENCIA DE AMENAZAS · SPYWARE COMERCIAL</span>
                    </div>
                    <h1 className="text-[22px] font-semibold tracking-tight text-[#F2F2F4]">
                      ¿Qué campaña o indicador deseas investigar?
                    </h1>
                    <p className="text-[13px] text-[#8E8E96]">
                      Consulta reportes técnicos de Citizen Lab, Amnesty Tech y Google TAG con citas verificables por página.
                    </p>
                  </div>

                  {/* Composer Unificado */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSend();
                    }}
                    className="rounded-[6px] border border-[#232329] bg-[#141418] focus-within:border-[#2F6FED] transition-colors"
                  >
                    <textarea
                      rows={3}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Escribe una consulta técnica (ej. CVEs de Pegasus, dominios C2, vectores zero-click)..."
                      className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[14px] text-[#F2F2F4] placeholder-[#8E8E96] focus:outline-none"
                    />

                    <div className="flex items-center justify-between border-t border-[#232329] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-2 py-1 text-[11px] font-medium text-[#7AA7FF]">
                          <ShieldCheck className="h-3 w-3" />
                          <span>Citas obligatorias (RNF1)</span>
                        </span>

                        <select
                          value={topK}
                          onChange={(e) => setTopK(Number(e.target.value))}
                          className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-1 text-[11px] text-[#8E8E96] focus:border-[#2F6FED] focus:outline-none"
                        >
                          <option value={4}>4 fuentes</option>
                          <option value={6}>6 fuentes</option>
                          <option value={10}>10 fuentes</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <span className="font-tech hidden sm:inline text-[11px] text-[#8E8E96]">
                          Enter ↵
                        </span>
                        <button
                          type="submit"
                          disabled={loadingChat || !input.trim()}
                          className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#2F6FED] px-3.5 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:bg-[#255ED4] disabled:opacity-40 transition-colors cursor-pointer"
                        >
                          <span>Consultar</span>
                          <CornerDownLeft className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </form>

                  {/* 3 Tarjetas de Inicio Rápido */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    {STARTER_CARDS.map((card) => {
                      const CardIcon = card.icon;
                      return (
                        <button
                          key={card.title}
                          type="button"
                          onClick={() => handleSend(card.prompt)}
                          className="flex flex-col items-start justify-between rounded-[6px] border border-[#232329] bg-[#141418] p-4 text-left hover:border-[#2F6FED]/60 hover:bg-[#15223D]/40 transition-colors cursor-pointer"
                        >
                          <div className="space-y-2">
                            <div className="inline-flex rounded-[4px] border border-[#232329] bg-[#0A0A0C] p-1.5 text-[#2F6FED]">
                              <CardIcon className="h-4 w-4" />
                            </div>
                            <h2 className="text-[13px] font-semibold text-[#F2F2F4]">
                              {card.title}
                            </h2>
                            <p className="text-[12px] leading-relaxed text-[#8E8E96]">
                              {card.description}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* Hilo Activo de Investigación */
              <>
                <div className="flex-1 overflow-y-auto px-6 py-6">
                  <div className="mx-auto max-w-[760px] space-y-6">
                    {messages.map((msg, idx) =>
                      msg.role === 'user' ? (
                        <div
                          key={idx}
                          className="rounded-[6px] border border-[#232329] bg-[#141418] px-4 py-3 text-[14px] text-[#F2F2F4]"
                        >
                          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[#8E8E96]">
                            Consulta
                          </p>
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        </div>
                      ) : (
                        <div
                          key={idx}
                          className="border-l-2 border-[#2F6FED] pl-5 py-1 space-y-4"
                        >
                          <MarkdownMessage
                            content={msg.content}
                            citations={msg.citations}
                            onSelectCitation={setSelectedCitation}
                          />

                          {/* Índice compacto de fuentes (Divulgación Progresiva RNF2) */}
                          {msg.citations?.length > 0 && (
                            <div className="pt-3 border-t border-[#232329] space-y-2">
                              <p className="text-[11px] font-medium uppercase tracking-wider text-[#8E8E96]">
                                Referencias documentales
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {msg.citations.map((cit) => (
                                  <button
                                    key={cit.index}
                                    type="button"
                                    onClick={() => setSelectedCitation(cit)}
                                    className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-2.5 py-1 text-[11px] text-[#F2F2F4] hover:border-[#2F6FED] hover:bg-[#15223D] transition-colors cursor-pointer"
                                  >
                                    <span className="font-tech font-medium text-[#2F6FED]">
                                      [{cit.index}]
                                    </span>
                                    <span className="max-w-[210px] truncate">{cit.title}</span>
                                    <span className="font-tech text-[#8E8E96]">p.{cit.page}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    )}

                    {loadingChat && (
                      <div className="border-l-2 border-[#232329] pl-5 py-2 text-[13px] text-[#8E8E96]">
                        Recuperando fragmentos y verificando citas en el corpus...
                      </div>
                    )}
                  </div>
                </div>

                {/* Barra Inferior Fija en Conversación Activa */}
                <div className="shrink-0 border-t border-[#232329] bg-[#0A0A0C] px-6 py-3.5">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSend();
                    }}
                    className="mx-auto max-w-[760px] flex items-center gap-2 rounded-[6px] border border-[#232329] bg-[#141418] px-3 py-2 focus-within:border-[#2F6FED] transition-colors"
                  >
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Realiza una pregunta de seguimiento sobre esta evidencia..."
                      className="flex-1 bg-transparent text-[13px] text-[#F2F2F4] placeholder-[#8E8E96] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={loadingChat || !input.trim()}
                      className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#2F6FED] px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:bg-[#255ED4] disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      <span>Consultar</span>
                      <CornerDownLeft className="h-3.5 w-3.5" />
                    </button>
                  </form>
                </div>
              </>
            )}
          </main>
        ) : (
          <main className="flex-1 overflow-y-auto px-8 py-8">
            <div className="mx-auto max-w-[920px]">
              {activeNav === 'amenazas' && <CampaignsPanel onAskInChat={handleAskCampaignInChat} />}
              {activeNav === 'equipo' && <MvtVerifierPanel />}
              {activeNav === 'exposicion' && <OsintPanel />}
              {activeNav === 'enlace' && <LinkVerifierPanel />}
              {activeNav === 'ajustes' && <SettingsPanel topK={topK} onChangeTopK={setTopK} />}
            </div>
          </main>
        )}
      </div>

      <CitationDrawer citation={selectedCitation} onClose={() => setSelectedCitation(null)} />
    </div>
  );
}
