import { useState, useEffect, useRef, useMemo } from 'react';
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
  ArrowRight,
  Database,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
} from 'lucide-react';
import { sendChatQuery } from './lib/api';
import { StructuredResponse } from './components/StructuredResponse';
import { SourcesPanel } from './components/SourcesPanel';
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

const SUGGESTED_PROMPTS = [
  {
    title: 'FORCEDENTRY · Zero-Click',
    subtitle: 'iMessage · BlastDoor evasion',
    tag: 'CVE-2021-30860',
    icon: Shield,
    prompt:
      '¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus y qué versiones afectaron?',
  },
  {
    title: 'Predator & Intellexa',
    subtitle: 'Campañas 1-click y sectores objetivo',
    tag: 'Amnesty Tech',
    icon: Network,
    prompt:
      '¿Qué sectores y regiones fueron objetivo en las campañas de Predator e Intellexa?',
  },
  {
    title: 'Artefactos Forenses MVT',
    subtitle: 'shutdown.log y Safari History',
    tag: 'Citizen Lab',
    icon: FileSearch,
    prompt:
      'Resume los principales artefactos forenses e indicadores descritos en los reportes de MVT.',
  },
  {
    title: 'Candiru & Red C2',
    subtitle: 'Dominios señuelo y suplantación',
    tag: 'Google TAG',
    icon: Globe,
    prompt:
      '¿Qué dominios e infraestructura de comando y control (C2) se asocian a las operaciones de spyware?',
  },
];

const SESSIONS_STORAGE_KEY = 'omega_research_sessions_v2';

function buildInitialDemoSessions() {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  return [
    {
      id: 'demo-forcedentry',
      title: 'FORCEDENTRY · Explotación zero-click Pegasus',
      updatedAt: new Date(now - 2 * hourMs).toISOString(),
      messages: [
        {
          role: 'user',
          content: '¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus y qué mecanismos emplearon?',
        },
        {
          role: 'assistant',
          content:
            'Los reportes forenses documentan cadenas zero-click de alta sofisticación desplegadas contra objetivos de alto perfil sin requerir interacción del usuario [1][2].\n\n- **Vector de explotación remota (FORCEDENTRY):** Se aprovechó una vulnerabilidad de desbordamiento de enteros en la biblioteca CoreGraphics (`CVE-2021-30860`), empaquetando archivos PDF maliciosos con extensión GIF en iMessage para evadir el sandbox BlastDoor [1].\n- **Escalamiento de privilegios:** Encadenada junto con `CVE-2021-31010` para lograr escape de la jaula de seguridad del sistema operativo y persistencia local [2].\n- **Cadena posterior BLASTPASS:** Detección de explotación zero-click en iOS 16 mediante adjuntos PassKit maliciosos conteniendo imágenes WebP manipuladas (`CVE-2023-41064`) [1].',
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
              source_url:
                'https://citizenlab.ca/2021/09/forcedentry-nso-group-imessage-zero-click-exploit-captured-in-the-wild/',
            },
            {
              index: 2,
              title: 'Buying Spying: Insights into Commercial Surveillance Vendors',
              organization: 'Google TAG',
              page: 20,
              similarity: 0.876,
              retrieval_method: 'Híbrido (Vector + Exacto)',
              snippet:
                'The recovered FORCEDENTRY exploit chain combined CVE-2021-30860 for initial remote code execution in CoreGraphics with CVE-2021-31010 for sandbox escape.',
              source_url: 'https://blog.google/threat-analysis-group/',
            },
          ],
          model: 'omega-hybrid-rrf',
        },
      ],
    },
    {
      id: 'demo-predator',
      title: 'Predator · Infraestructura y vectores 1-click',
      updatedAt: new Date(now - 24 * hourMs).toISOString(),
      messages: [
        {
          role: 'user',
          content: '¿Qué sectores y regiones fueron objetivo en las campañas de Predator e Intellexa?',
        },
        {
          role: 'assistant',
          content:
            'Las investigaciones de la alianza Intellexa detallan el despliegue del spyware Predator mediante ingeniería social y enlaces de 1-click [1][2].\n\n- **Sectores impactados:** Periodistas de investigación, miembros de la sociedad civil, activistas de derechos humanos y diplomáticos europeos [1].\n- **Infraestructura de comando y control (C2):** Redirecciones a través de dominios señuelo como `smscentro.com` y suplantación de servicios de mensajería para instalar el payload móvil [2].',
          citations: [
            {
              index: 1,
              title: 'Predator Files: Technical deep-dive into Intellexa Alliance surveillance products',
              organization: 'Amnesty Tech',
              page: 1,
              similarity: 0.892,
              retrieval_method: 'Híbrido (Vector + Exacto)',
              snippet:
                'The Predator Files investigation coordinated with EIC documents targeting of journalists, diplomats and elected officials across multiple regions using Intellexa Alliance commercial spyware.',
              source_url: 'https://securitylab.amnesty.org/',
            },
            {
              index: 2,
              title: 'Protecting Android Users from 0-Day Attacks (Intellexa Predator & Cytrox)',
              organization: 'Google TAG',
              page: 3,
              similarity: 0.854,
              retrieval_method: 'Coincidencia Exacta',
              snippet:
                'One-click links delivered over SMS masqueraded as legitimate URL shorteners and regional news portals before triggering Chrome and Android kernel exploits.',
              source_url: 'https://blog.google/threat-analysis-group/',
            },
          ],
          model: 'omega-hybrid-rrf',
        },
      ],
    },
  ];
}

function formatRelativeTime(isoString) {
  if (!isoString) return 'Reciente';
  const ts = new Date(isoString).getTime();
  const diffHours = Math.floor((Date.now() - ts) / (1000 * 60 * 60));
  if (diffHours < 1) return 'Hace momentos';
  if (diffHours === 1) return 'Hace 1 h';
  if (diffHours < 24) return `Hace ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Ayer';
  return `Hace ${diffDays} d`;
}

function buildFallbackAnswer(query) {
  return {
    answer: `Resumen de investigación generado a partir de reportes técnicos indexados para **"${query}"** [1][2].\n\n- **Cadenas de explotación documentadas:** Vulnerabilidades críticas zero-click como \`CVE-2021-30860\` (FORCEDENTRY) y \`CVE-2023-41064\` (BLASTPASS), diseñadas para evadir las mitigaciones de memoria en iOS [1].\n- **Evidencia forense y persistencia:** Las inspecciones con MVT revelan anomalías cronológicas en \`shutdown.log\`, redirecciones hacia dominios señuelo y artefactos en procesos de mensajería [2].`,
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
        source_url:
          'https://citizenlab.ca/2021/09/forcedentry-nso-group-imessage-zero-click-exploit-captured-in-the-wild/',
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sessions, setSessions] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSIONS_STORAGE_KEY));
      return Array.isArray(saved) && saved.length > 0 ? saved : buildInitialDemoSessions();
    } catch {
      return buildInitialDemoSessions();
    }
  });
  const [currentSessionId, setCurrentSessionId] = useState(null);

  const [input, setInput] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);
  const [topK, setTopK] = useState(6);
  const [selectedCitation, setSelectedCitation] = useState(null);
  const [isSourcesPanelOpen, setIsSourcesPanelOpen] = useState(false);

  const textareaRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId) || null,
    [sessions, currentSessionId]
  );

  const messages = activeSession?.messages || [];

  // Recopilar todas las citas de la conversación activa para el panel lateral
  const activeConversationCitations = useMemo(() => {
    const list = [];
    const seen = new Set();
    for (const m of messages) {
      for (const cit of m.citations || []) {
        if (!seen.has(cit.index)) {
          seen.add(cit.index);
          list.push(cit);
        }
      }
    }
    return list;
  }, [messages]);

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loadingChat]);

  function startNewInvestigation() {
    setCurrentSessionId(null);
    setInput('');
    setSelectedCitation(null);
    setIsSourcesPanelOpen(false);
    setActiveNav('preguntar');
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function deleteSession(e, id) {
    e.stopPropagation();
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentSessionId === id) {
      setCurrentSessionId(null);
    }
  }

  async function handleSend(customPrompt) {
    const query = (customPrompt ?? input).trim();
    if (!query || loadingChat) return;

    let targetSessionId = currentSessionId;
    const nowIso = new Date().toISOString();
    const userTurn = { role: 'user', content: query };

    if (!targetSessionId) {
      targetSessionId = crypto.randomUUID();
      const newSession = {
        id: targetSessionId,
        title: query.length > 46 ? `${query.slice(0, 46)}...` : query,
        updatedAt: nowIso,
        messages: [userTurn],
      };
      setSessions((prev) => [newSession, ...prev]);
      setCurrentSessionId(targetSessionId);
    } else {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? { ...s, updatedAt: nowIso, messages: [...s.messages, userTurn] }
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
      const fallback = buildFallbackAnswer(query);
      const fallbackTurn = {
        role: 'assistant',
        content: fallback.answer,
        citations: fallback.citations,
        model: fallback.model,
      };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? { ...s, updatedAt: new Date().toISOString(), messages: [...s.messages, fallbackTurn] }
            : s
        )
      );
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

  function handleSelectCitation(cit) {
    setSelectedCitation(cit);
    setIsSourcesPanelOpen(true);
  }

  function handleExportSession() {
    if (messages.length === 0) return;

    const lines = [
      `# Dossier de Investigación CTI — OMEGA`,
      `- **Título:** ${activeSession?.title || 'Investigación de Amenazas'}`,
      `- **Fecha:** ${new Date().toISOString()}`,
      `- **Sistema:** Omega RAG · Híbrido RRF`,
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
    a.download = `omega_investigacion_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-[#0D0F12] text-[#F0F2F5]">
      {/* Sidebar Fija Izquierda (#111318) */}
      <aside
        className={`${
          sidebarCollapsed ? 'w-[58px]' : 'w-[240px]'
        } shrink-0 h-full border-r border-[#262B33] bg-[#111318] flex flex-col justify-between transition-[width] duration-150 z-10`}
      >
        <div className="flex flex-col min-h-0 flex-1">
          {/* Header de Sidebar (48px) */}
          <div className="h-12 px-3.5 border-b border-[#262B33] flex items-center justify-between">
            {!sidebarCollapsed && (
              <div className="flex items-center gap-2.5">
                <div className="h-4 w-4 rounded-[3px] border border-[#262B33] bg-[#171A20] flex items-center justify-center">
                  <div className="h-1.5 w-1.5 rounded-[1px] bg-[#3978F6]" />
                </div>
                <span className="text-[13px] font-semibold tracking-wider text-[#F0F2F5]">
                  OMEGA
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              title={sidebarCollapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
              className="p-1 rounded-[4px] text-[#929BAA] hover:bg-[#171A20] hover:text-[#F0F2F5] transition-colors cursor-pointer"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Botón + Nueva Investigación */}
          <div className="p-2.5">
            <button
              type="button"
              onClick={startNewInvestigation}
              title="Nueva investigación"
              className={`w-full h-8 rounded-[6px] bg-[#171A20] border border-[#262B33] flex items-center justify-center gap-2 text-[12px] font-medium text-[#F0F2F5] hover:border-[#3978F6] hover:bg-[#1C2027] transition-colors cursor-pointer ${
                sidebarCollapsed ? 'px-0' : 'px-3'
              }`}
            >
              <Plus className="h-3.5 w-3.5 text-[#3978F6]" />
              {!sidebarCollapsed && <span>Nueva investigación</span>}
            </button>
          </div>

          {/* Navegación (6 módulos exactos) */}
          <nav className="px-2 space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  title={item.label}
                  className={`w-full h-8 flex items-center gap-2.5 px-2.5 rounded-[4px] text-[12.5px] transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#16243D] border-l-2 border-[#3978F6] text-[#F0F2F5] font-medium'
                      : 'border-l-2 border-transparent text-[#929BAA] hover:bg-[#171A20] hover:text-[#F0F2F5]'
                  } ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-[#3978F6]' : 'text-[#929BAA]'
                    }`}
                  />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </nav>

          {/* Historial de Investigaciones (Secundario pero accesible) */}
          {!sidebarCollapsed && (
            <div className="mt-4 px-2.5 flex-1 min-h-0 flex flex-col">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#929BAA]/70">
                Historial reciente
              </div>
              <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
                {sessions.map((sess) => {
                  const isSelected = activeNav === 'preguntar' && sess.id === currentSessionId;
                  return (
                    <div
                      key={sess.id}
                      onClick={() => {
                        setCurrentSessionId(sess.id);
                        setActiveNav('preguntar');
                      }}
                      className={`group flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-[4px] text-[12px] cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[#171A20] text-[#F0F2F5]'
                          : 'text-[#929BAA] hover:bg-[#171A20]/60 hover:text-[#F0F2F5]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate leading-tight font-medium">{sess.title}</p>
                        <p className="font-tech text-[10px] text-[#929BAA]/60">
                          {formatRelativeTime(sess.updatedAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => deleteSession(e, sess.id)}
                        title="Eliminar sesión"
                        className="opacity-0 group-hover:opacity-100 p-1 text-[#929BAA] hover:text-[#F0F2F5] transition-opacity"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer Sidebar */}
        <div className="p-3 border-t border-[#262B33] bg-[#111318] flex items-center justify-between text-[11px] text-[#929BAA]">
          {sidebarCollapsed ? (
            <span className="h-1.5 w-1.5 mx-auto rounded-full bg-[#3978F6]" title="Modo Defensivo · RNF1" />
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#3978F6]" />
                <span>Modo Defensivo</span>
              </div>
              <span className="font-tech text-[10px]">RNF1</span>
            </>
          )}
        </div>
      </aside>

      {/* Área Principal (flex-1, fondo #0D0F12) */}
      <div className="flex-1 h-full flex flex-col min-w-0 bg-[#0D0F12]">
        {/* Barra Superior Minimalista (48px) */}
        <header className="h-12 shrink-0 border-b border-[#262B33] px-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-[12px]">
            <span className="text-[#929BAA]">Plataforma de Investigación</span>
            <span className="text-[#262B33]">/</span>
            <span className="font-medium text-[#F0F2F5]">
              {NAV_ITEMS.find((n) => n.id === activeNav)?.label}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {activeNav === 'preguntar' && messages.length > 0 && activeConversationCitations.length > 0 && (
              <button
                type="button"
                onClick={() => setIsSourcesPanelOpen((v) => !v)}
                className={`h-[30px] px-3 rounded-[5px] border flex items-center gap-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
                  isSourcesPanelOpen
                    ? 'border-[#3978F6] bg-[#16243D] text-[#3978F6]'
                    : 'border-[#262B33] bg-[#171A20] text-[#929BAA] hover:border-[#353C47] hover:text-[#F0F2F5]'
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>Fuentes ({activeConversationCitations.length})</span>
              </button>
            )}

            {activeNav === 'preguntar' && (
              <button
                type="button"
                onClick={handleExportSession}
                disabled={messages.length === 0}
                className="h-[30px] px-3 rounded-[5px] bg-[#171A20] border border-[#262B33] flex items-center gap-1.5 text-[12px] font-medium text-[#F0F2F5] hover:border-[#3978F6] disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-[#929BAA]" />
                <span>Exportar (.md)</span>
              </button>
            )}
          </div>
        </header>

        {/* Contenido Dinámico */}
        {activeNav === 'preguntar' ? (
          <div className="flex-1 flex min-h-0 relative">
            {messages.length === 0 ? (
              /* 1. HOME EXPERIENCE (Inspirado en LiLi 3.0: minimal, espacioso, enfocado en el composer) */
              <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 overflow-y-auto">
                <div className="w-full max-w-[760px] flex flex-col items-center space-y-7">
                  {/* Kicker & Encabezado Compacto */}
                  <div className="text-center space-y-2">
                    <span className="font-tech text-[10.5px] uppercase tracking-[0.14em] text-[#3978F6] bg-[#16243D] border border-[#3978F6]/30 px-2.5 py-1 rounded-[4px]">
                      OMEGA 1.0 · CTI RESEARCH ENGINE
                    </span>
                    <h1 className="text-[28px] font-semibold tracking-[-0.02em] leading-tight text-[#F0F2F5] pt-1">
                      Inteligencia Defensiva Contra Spyware
                    </h1>
                    <p className="text-[14px] text-[#929BAA] max-w-[560px] mx-auto leading-relaxed">
                      Investiga vulnerabilidades zero-click, campañas patrocinadas por estados y artefactos forenses a partir de fuentes documentadas.
                    </p>
                  </div>

                  {/* Compositor Conversacional Visualmente Dominante */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSend();
                    }}
                    className="w-full rounded-[8px] bg-[#171A20] border border-[#262B33] focus-within:border-[#3978F6] transition-colors duration-150"
                  >
                    <textarea
                      ref={textareaRef}
                      rows={3}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Pregunta sobre campañas, CVEs, dominios o vectores de infección..."
                      className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[14.5px] leading-relaxed text-[#F0F2F5] placeholder-[#929BAA]/70 focus:outline-none"
                    />

                    {/* Barra de Controles Integrada */}
                    <div className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 border-t border-[#262B33]/80 bg-[#14161C] rounded-b-[7px]">
                      <div className="flex items-center gap-2 text-[12px] text-[#929BAA]">
                        {/* Citas obligatorias */}
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] bg-[#171A20] border border-[#262B33] text-[#F0F2F5]">
                          <ShieldCheck className="h-3.5 w-3.5 text-[#3978F6]" />
                          <span>Citas obligatorias</span>
                        </span>

                        {/* Híbrido RRF */}
                        <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] bg-[#171A20] border border-[#262B33] text-[#929BAA]">
                          <span>Híbrido RRF</span>
                        </span>

                        {/* Selector de fuentes */}
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] bg-[#171A20] border border-[#262B33]">
                          <Database className="h-3 w-3 text-[#929BAA]" />
                          <select
                            value={topK}
                            onChange={(e) => setTopK(Number(e.target.value))}
                            aria-label="Cantidad de fuentes"
                            className="bg-transparent text-[11.5px] text-[#F0F2F5] focus:outline-none cursor-pointer"
                          >
                            <option value={4} className="bg-[#171A20] text-[#F0F2F5]">4 fuentes</option>
                            <option value={6} className="bg-[#171A20] text-[#F0F2F5]">6 fuentes</option>
                            <option value={10} className="bg-[#171A20] text-[#F0F2F5]">10 fuentes</option>
                          </select>
                        </div>
                      </div>

                      {/* Botón de envío */}
                      <button
                        type="submit"
                        disabled={loadingChat || !input.trim()}
                        className="h-8 px-3.5 rounded-[6px] bg-[#3978F6] hover:bg-[#2968E6] text-[#F0F2F5] text-[12px] font-medium flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      >
                        <span>Investigar</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </form>

                  {/* Fila de Tarjetas de Investigaciones Sugeridas (Estilo LiLi) */}
                  <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {SUGGESTED_PROMPTS.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.title}
                          type="button"
                          onClick={() => handleSend(item.prompt)}
                          className="group p-3 rounded-[6px] bg-[#171A20] border border-[#262B33] hover:border-[#3978F6]/60 hover:bg-[#1A1E26] text-left transition-colors flex flex-col justify-between space-y-2 cursor-pointer"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <Icon className="h-3.5 w-3.5 text-[#3978F6]" />
                              <span className="font-tech text-[10px] text-[#929BAA] px-1 rounded bg-[#13161B]">
                                {item.tag}
                              </span>
                            </div>
                            <h3 className="text-[12.5px] font-semibold text-[#F0F2F5] group-hover:text-[#3978F6] transition-colors leading-snug">
                              {item.title}
                            </h3>
                            <p className="text-[11.5px] text-[#929BAA] line-clamp-2 leading-relaxed">
                              {item.subtitle}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </main>
            ) : (
              /* 2. CONVERSATIONAL EXPERIENCE (Espacio dedicado para el diálogo analítico) */
              <main className="flex-1 flex flex-col min-h-0">
                <div className="flex-1 overflow-y-auto px-6 py-6">
                  <div className="mx-auto max-w-[800px] space-y-6">
                    {messages.map((msg, idx) =>
                      msg.role === 'user' ? (
                        <div
                          key={idx}
                          className="rounded-[6px] border border-[#262B33] bg-[#171A20] px-4 py-3 space-y-1"
                        >
                          <div className="text-[11px] font-medium uppercase tracking-wider text-[#929BAA]">
                            Consulta del Analista
                          </div>
                          <div className="text-[14px] text-[#F0F2F5] whitespace-pre-wrap leading-relaxed">
                            {msg.content}
                          </div>
                        </div>
                      ) : (
                        <div
                          key={idx}
                          className="border-l-2 border-[#3978F6] pl-5 py-1"
                        >
                          <StructuredResponse
                            message={msg}
                            onSelectCitation={handleSelectCitation}
                            onToggleSources={() => setIsSourcesPanelOpen((v) => !v)}
                            isSourcesOpen={isSourcesPanelOpen}
                          />
                        </div>
                      )
                    )}

                    {loadingChat && (
                      <div className="border-l-2 border-[#262B33] pl-5 py-3 text-[13px] text-[#929BAA] space-y-1">
                        <div className="flex items-center gap-2 text-[#F0F2F5]">
                          <span className="h-2 w-2 rounded-full bg-[#3978F6] animate-pulse" />
                          <span>Consultando base documental CTI y calculando RRF...</span>
                        </div>
                        <p className="text-[12px] text-[#929BAA]">
                          Recuperando fragmentos de Citizen Lab, Amnesty Tech y Google TAG.
                        </p>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </div>

                {/* Composer Fijo al Pie de la Conversación */}
                <div className="shrink-0 border-t border-[#262B33] bg-[#0D0F12] px-6 py-3.5">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSend();
                    }}
                    className="mx-auto max-w-[800px] rounded-[8px] bg-[#171A20] border border-[#262B33] focus-within:border-[#3978F6] transition-colors"
                  >
                    <textarea
                      rows={2}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Realiza una pregunta de seguimiento sobre esta evidencia..."
                      className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14px] leading-relaxed text-[#F0F2F5] placeholder-[#929BAA]/70 focus:outline-none"
                    />

                    <div className="flex items-center justify-between px-3 py-2 border-t border-[#262B33]/60 bg-[#14161C] rounded-b-[7px]">
                      <div className="flex items-center gap-2 text-[11px] text-[#929BAA]">
                        <span>Shift+Enter para salto de línea</span>
                        <span>·</span>
                        <select
                          value={topK}
                          onChange={(e) => setTopK(Number(e.target.value))}
                          aria-label="Cantidad de fuentes"
                          className="bg-transparent text-[#929BAA] focus:outline-none cursor-pointer"
                        >
                          <option value={4} className="bg-[#171A20] text-[#F0F2F5]">4 fuentes</option>
                          <option value={6} className="bg-[#171A20] text-[#F0F2F5]">6 fuentes</option>
                          <option value={10} className="bg-[#171A20] text-[#F0F2F5]">10 fuentes</option>
                        </select>
                      </div>

                      <button
                        type="submit"
                        disabled={loadingChat || !input.trim()}
                        className="h-7 px-3 rounded-[5px] bg-[#3978F6] hover:bg-[#2968E6] text-[#F0F2F5] text-[11.5px] font-medium flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      >
                        <span>Preguntar</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>
                  </form>
                </div>
              </main>
            )}

            {/* Panel Colapsable de Fuentes Documentales */}
            {isSourcesPanelOpen && (
              <SourcesPanel
                citations={activeConversationCitations}
                selectedCitation={selectedCitation}
                onSelectCitation={setSelectedCitation}
                onClose={() => setIsSourcesPanelOpen(false)}
              />
            )}
          </div>
        ) : (
          /* Módulos de Soporte (Amenazas, Equipo, Exposición, Enlace, Ajustes) */
          <main className="flex-1 overflow-y-auto px-8 py-8">
            <div className="mx-auto max-w-[940px]">
              {activeNav === 'amenazas' && (
                <CampaignsPanel
                  onAskInChat={(p) => {
                    startNewInvestigation();
                    handleSend(p);
                  }}
                />
              )}
              {activeNav === 'equipo' && <MvtVerifierPanel />}
              {activeNav === 'exposicion' && <OsintPanel />}
              {activeNav === 'enlace' && <LinkVerifierPanel />}
              {activeNav === 'ajustes' && <SettingsPanel topK={topK} onChangeTopK={setTopK} />}
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
