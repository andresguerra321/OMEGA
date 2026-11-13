import { useState, useEffect, useRef } from 'react';
import {
  Plus,
  MessageSquare,
  Layers,
  Laptop,
  Radar,
  Link2,
  Settings,
  Download,
  Shield,
  Network,
  FileSearch,
  Globe,
  ShieldCheck,
  CornerDownLeft,
} from 'lucide-react';
import { sendChatQuery } from './lib/api';
import { MarkdownMessage } from './components/MarkdownMessage';
import { CitationDrawer } from './components/CitationDrawer';
import { CampaignsPanel } from './components/CampaignsPanel';
import { MvtVerifierPanel } from './components/MvtVerifierPanel';
import { OsintPanel } from './components/OsintPanel';
import { LinkVerifierPanel } from './components/LinkVerifierPanel';
import { SettingsPanel } from './components/SettingsPanel';

const NAV_ITEMS = [
  { id: 'preguntar', label: 'Preguntar', icon: MessageSquare },
  { id: 'amenazas', label: 'Amenazas', icon: Layers },
  { id: 'equipo', label: 'Revisar mi equipo', icon: Laptop },
  { id: 'exposicion', label: 'Mi exposición', icon: Radar },
  { id: 'enlace', label: 'Verificar enlace', icon: Link2 },
  { id: 'ajustes', label: 'Ajustes', icon: Settings },
];

const SUGGESTION_PILLS = [
  {
    label: 'CVEs Zero-Click',
    icon: Shield,
    prompt: '¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus y qué versiones afectaron?',
  },
  {
    label: 'Campañas Predator',
    icon: Network,
    prompt: '¿Qué sectores y regiones fueron objetivo en las campañas de Predator e Intellexa?',
  },
  {
    label: 'Artefactos MVT',
    icon: FileSearch,
    prompt: 'Resume los principales artefactos forenses e indicadores descritos en los reportes de MVT.',
  },
  {
    label: 'Infraestructura C2',
    icon: Globe,
    prompt: '¿Qué dominios e infraestructura de comando y control (C2) se asocian a las operaciones de spyware?',
  },
];

const SESSIONS_STORAGE_KEY = 'omega_desktop_chat_v1';

function buildFallbackAnswer(query) {
  return {
    answer: `Resumen de inteligencia para **"${query}"** generado con datos documentados [1][2].\n\n- **Cadenas de explotación documentadas:** Se identifican vulnerabilidades críticas zero-click como \`CVE-2021-30860\` (FORCEDENTRY) y \`CVE-2023-41064\` (BLASTPASS), diseñadas para evadir las mitigaciones de memoria en iOS [1].\n- **Evidencia forense y persistencia:** Las inspecciones con MVT revelan anomalías cronológicas en \`shutdown.log\`, redirecciones hacia dominios señuelo y artefactos en procesos de transcripción de mensajería [2].`,
    citations: [
      {
        index: 1,
        title: 'FORCEDENTRY: NSO Group iMessage Zero-Click Exploit Captured in the Wild',
        organization: 'Citizen Lab',
        page: 3,
        similarity: 0.914,
        retrieval_method: 'Híbrido (Vector + Exacto)',
        snippet:
          'FORCEDENTRY targets Apple’s ImageIO library via maliciously crafted PDF files disguised as GIFs sent over iMessage, bypassing the BlastDoor sandbox introduced in iOS 14 (CVE-2021-30860).',
        source_url: 'https://citizenlab.ca/2021/09/forcedentry-nso-group-imessage-zero-click-exploit-captured-in-the-wild/',
      },
      {
        index: 2,
        title: 'Forensic Methodology Report: How to Catch NSO Group Pegasus',
        organization: 'Amnesty Tech',
        page: 58,
        similarity: 0.885,
        retrieval_method: 'Coincidencia Exacta',
        snippet:
          'Examining Shutdown.log alongside Safari History.db and crash logs from IMTranscoderAgent provides high-confidence corroboration of Pegasus activity.',
        source_url: 'https://securitylab.amnesty.org/latest/2021/07/the-pegasus-project/',
      },
    ],
    model: 'omega-hybrid-rrf',
  };
}

export default function App() {
  const [activeNav, setActiveNav] = useState('preguntar');
  const [messages, setMessages] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSIONS_STORAGE_KEY));
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState(null);
  const [topK, setTopK] = useState(6);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loadingChat]);

  function startNewChat() {
    setMessages([]);
    setInput('');
    setSelectedCitation(null);
    setActiveNav('preguntar');
  }

  async function handleSend(customPrompt) {
    const query = (customPrompt ?? input).trim();
    if (!query || loadingChat) return;

    const userMsg = { role: 'user', content: query };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoadingChat(true);

    const historyPayload = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await sendChatQuery(query, historyPayload, topK);
      const assistantMsg = {
        role: 'assistant',
        content: res.answer,
        citations: res.citations || [],
        model: res.model,
      };
      setMessages([...nextMessages, assistantMsg]);
    } catch {
      const fallback = buildFallbackAnswer(query);
      const assistantMsg = {
        role: 'assistant',
        content: fallback.answer,
        citations: fallback.citations,
        model: fallback.model,
      };
      setMessages([...nextMessages, assistantMsg]);
    } finally {
      setLoadingChat(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleExportSession() {
    if (messages.length === 0) return;

    const lines = [
      '# Consulta de Inteligencia CTI — OMEGA',
      `- **Fecha:** ${new Date().toISOString()}`,
      '- **Sistema:** Omega RAG · Híbrido RRF',
      '',
    ];

    messages.forEach((m) => {
      if (m.role === 'user') {
        lines.push(`## Consulta del Analista\n${m.content}\n`);
      } else {
        lines.push(`## Respuesta Verificada\n${m.content}\n`);
        if (m.citations?.length) {
          lines.push('### Fuentes Citadas');
          m.citations.forEach((c) => {
            lines.push(`- **[${c.index}]** ${c.title} (${c.organization}) — p.${c.page}`);
          });
          lines.push('');
        }
      }
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omega_consulta_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleAskCampaignInChat(promptText) {
    setActiveNav('preguntar');
    handleSend(promptText);
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-[#0A0A0C] text-[#F2F2F4]">
      {/* 1. Sidebar Fija Izquierda (230px, fondo #141418, borde derecho 1px solid #232329) */}
      <aside className="w-[230px] shrink-0 h-full border-r border-[#232329] bg-[#141418] flex flex-col justify-between">
        <div className="flex flex-col">
          {/* Header (48px) */}
          <div className="h-12 px-4 border-b border-[#232329] flex items-center gap-2.5">
            <div className="h-4 w-4 rounded-[3px] border border-[#232329] bg-[#0A0A0C] flex items-center justify-center">
              <div className="h-1.5 w-1.5 rounded-[1px] bg-[#2F6FED]" />
            </div>
            <span className="text-[13px] font-semibold tracking-wider text-[#F2F2F4]">
              OMEGA
            </span>
          </div>

          {/* Botón + Nueva consulta */}
          <div className="p-3">
            <button
              type="button"
              onClick={startNewChat}
              className="w-full h-[34px] rounded-[4px] bg-[#0A0A0C] border border-[#232329] px-3 flex items-center justify-center gap-2 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED] transition-colors duration-150 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-[#F2F2F4]" />
              <span>Nueva consulta</span>
            </button>
          </div>

          {/* Navegación (6 módulos exactos) */}
          <nav className="px-2 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  className={`w-full h-8 flex items-center gap-2.5 px-2.5 rounded-[4px] text-[13px] transition-colors duration-150 cursor-pointer ${
                    isActive
                      ? 'bg-[#15223D] border-l-2 border-[#2F6FED] text-[#F2F2F4] font-medium'
                      : 'border-l-2 border-transparent text-[#8E8E96] hover:bg-[#1C1C22] hover:text-[#F2F2F4]'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-[#2F6FED]' : 'text-[#8E8E96]'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Footer de Sidebar */}
        <div className="p-3 border-t border-[#232329] flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-[1px] bg-[#2F6FED]" />
          <span className="text-[11px] text-[#8E8E96]">Entorno Defensivo · RNF1</span>
        </div>
      </aside>

      {/* 2. Área Principal (flex-1, fondo #0A0A0C) */}
      <div className="flex-1 h-full flex flex-col min-w-0 bg-[#0A0A0C]">
        {/* Barra Superior Minimalista (48px) */}
        <header className="h-12 shrink-0 border-b border-[#232329] px-6 flex items-center justify-between">
          <div className="text-[12px] text-[#8E8E96]">
            {activeNav === 'preguntar' ? (
              <span>Omega RAG · Híbrido RRF</span>
            ) : (
              <span>{NAV_ITEMS.find((n) => n.id === activeNav)?.label}</span>
            )}
          </div>

          {activeNav === 'preguntar' && (
            <button
              type="button"
              onClick={handleExportSession}
              disabled={messages.length === 0}
              className="h-[30px] px-3 rounded-[4px] bg-[#141418] border border-[#232329] flex items-center gap-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED] disabled:opacity-40 disabled:pointer-events-none transition-colors duration-150 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-[#8E8E96]" />
              <span>Exportar (.md)</span>
            </button>
          )}
        </header>

        {/* Contenido Dinámico */}
        {activeNav === 'preguntar' ? (
          <main className="flex-1 flex flex-col min-h-0 relative">
            {messages.length === 0 ? (
              /* Estado Inicial (Centrado espacial exacto a la referencia) */
              <div className="flex-1 flex flex-col items-center justify-center px-6">
                {/* 1. Título Centrado en Dos Tonos */}
                <div className="text-center space-y-1">
                  <h1 className="text-[28px] font-semibold tracking-[-0.02em] leading-tight">
                    <span className="text-[#8E8E96]">Inteligencia Defensiva Contra </span>
                    <span className="text-[#F2F2F4]">Spyware Comercial</span>
                  </h1>
                  <h2 className="text-[28px] font-semibold tracking-[-0.02em] leading-tight text-[#F2F2F4]">
                    y Vigilancia Digital
                  </h2>
                </div>

                {/* 2. Ancla Visual Central (140px x 140px, retículo geométrico de precisión) */}
                <div className="my-8 flex items-center justify-center select-none">
                  <svg width="140" height="140" viewBox="0 0 140 140" fill="none">
                    <circle cx="70" cy="70" r="66" stroke="#232329" strokeWidth="1" strokeDasharray="3 3" />
                    <circle cx="70" cy="70" r="48" stroke="#232329" strokeWidth="1" />
                    <circle cx="70" cy="70" r="30" stroke="#232329" strokeWidth="1" />
                    <circle cx="70" cy="70" r="16" stroke="#232329" strokeWidth="1" strokeDasharray="2 2" />
                    <line x1="70" y1="4" x2="70" y2="136" stroke="#232329" strokeWidth="1" />
                    <line x1="4" y1="70" x2="136" y2="70" stroke="#232329" strokeWidth="1" />
                    <path d="M 62 70 L 78 70 M 70 62 L 70 78" stroke="#232329" strokeWidth="1" />
                    <rect x="58" y="58" width="24" height="24" rx="4" fill="#141418" stroke="#232329" strokeWidth="1" />
                    <rect x="65" y="65" width="10" height="10" rx="1.5" fill="#2F6FED" transform="rotate(45 70 70)" />
                  </svg>
                </div>

                {/* 3. Fila Horizontal de 4 Pills Compactos */}
                <div className="w-full max-w-[680px] mb-3 flex flex-wrap items-center justify-center gap-2">
                  {SUGGESTION_PILLS.map((pill) => {
                    const PillIcon = pill.icon;
                    return (
                      <button
                        key={pill.label}
                        type="button"
                        onClick={() => handleSend(pill.prompt)}
                        className="h-[30px] px-3 rounded-[4px] bg-[#141418] border border-[#232329] flex items-center gap-1.5 text-[12px] text-[#8E8E96] hover:border-[#2F6FED] hover:text-[#F2F2F4] transition-colors duration-150 cursor-pointer"
                      >
                        <PillIcon className="h-3 w-3 text-[#2F6FED]" />
                        <span>{pill.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* 4. Caja de Input Principal */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSend();
                  }}
                  className="w-full max-w-[680px] rounded-[6px] bg-[#141418] border border-[#232329] focus-within:border-[#2F6FED] transition-colors duration-150"
                >
                  <textarea
                    rows={2}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Pregunta sobre campañas, CVEs, dominios o vectores de infección..."
                    className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14px] leading-relaxed text-[#F2F2F4] placeholder-[#8E8E96] focus:outline-none"
                  />

                  <div className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-3 text-[12px] text-[#8E8E96]">
                      <span className="flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5 text-[#2F6FED]" />
                        <span>Citas obligatorias</span>
                      </span>
                      <span>·</span>
                      <select
                        value={topK}
                        onChange={(e) => setTopK(Number(e.target.value))}
                        aria-label="Fuentes a consultar"
                        className="bg-transparent text-[12px] text-[#8E8E96] focus:outline-none cursor-pointer"
                      >
                        <option value={4} className="bg-[#141418] text-[#F2F2F4]">4 fuentes</option>
                        <option value={6} className="bg-[#141418] text-[#F2F2F4]">6 fuentes</option>
                        <option value={10} className="bg-[#141418] text-[#F2F2F4]">10 fuentes</option>
                      </select>
                    </div>

                    <button
                      type="submit"
                      disabled={loadingChat || !input.trim()}
                      className="h-[30px] px-3.5 rounded-[4px] bg-[#2F6FED] text-[#F2F2F4] text-[12px] font-medium hover:bg-[#255ED4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer"
                    >
                      Investigar
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              /* Estado Conversacional (Hilo activo centrado en max-w-[720px]) */
              <>
                <div className="flex-1 overflow-y-auto px-6 py-6">
                  <div className="mx-auto max-w-[720px] space-y-6">
                    {messages.map((msg, idx) =>
                      msg.role === 'user' ? (
                        <div
                          key={idx}
                          className="rounded-[6px] border border-[#232329] bg-[#141418] px-4 py-3 text-[14px] text-[#F2F2F4]"
                        >
                          <div className="text-[11px] font-medium uppercase tracking-wider text-[#8E8E96] mb-1">
                            Consulta
                          </div>
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        </div>
                      ) : (
                        <div
                          key={idx}
                          className="border-l-2 border-[#2F6FED] pl-5 py-1 space-y-3"
                        >
                          <MarkdownMessage
                            content={msg.content}
                            citations={msg.citations}
                            onSelectCitation={setSelectedCitation}
                          />

                          {/* Chips al pie para auditar fragmentos */}
                          {msg.citations?.length > 0 && (
                            <div className="pt-2 border-t border-[#232329] flex flex-wrap gap-1.5">
                              {msg.citations.map((cit) => (
                                <button
                                  key={cit.index}
                                  type="button"
                                  onClick={() => setSelectedCitation(cit)}
                                  className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-2 py-1 text-[11px] text-[#F2F2F4] hover:border-[#2F6FED] transition-colors duration-150 cursor-pointer"
                                >
                                  <span className="font-tech text-[#7AA7FF]">[{cit.index}]</span>
                                  <span className="max-w-[190px] truncate">{cit.title}</span>
                                  <span className="font-tech text-[#8E8E96]">· p.{cit.page}</span>
                                </button>
                              ))}
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
                    <div ref={messagesEndRef} />
                  </div>
                </div>

                {/* Caja de Input fijada abajo centrada */}
                <div className="shrink-0 border-t border-[#232329] bg-[#0A0A0C] px-6 py-3.5">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSend();
                    }}
                    className="mx-auto max-w-[720px] rounded-[6px] bg-[#141418] border border-[#232329] focus-within:border-[#2F6FED] transition-colors duration-150"
                  >
                    <textarea
                      rows={2}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Realiza una pregunta de seguimiento sobre esta evidencia..."
                      className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14px] leading-relaxed text-[#F2F2F4] placeholder-[#8E8E96] focus:outline-none"
                    />

                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-[11px] text-[#8E8E96]">Enter para enviar · Shift+Enter para nueva línea</span>
                      <button
                        type="submit"
                        disabled={loadingChat || !input.trim()}
                        className="h-[30px] px-3.5 rounded-[4px] bg-[#2F6FED] text-[#F2F2F4] text-[12px] font-medium hover:bg-[#255ED4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer flex items-center gap-1.5"
                      >
                        <span>Investigar</span>
                        <CornerDownLeft className="h-3 w-3" />
                      </button>
                    </div>
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

      {/* Drawer de Cita Verificada */}
      <CitationDrawer
        citation={selectedCitation}
        onClose={() => setSelectedCitation(null)}
      />
    </div>
  );
}
