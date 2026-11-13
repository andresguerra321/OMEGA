import { useState, useEffect, useRef, useMemo } from 'react';
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
  Trash2,
  ChevronLeft,
  ChevronRight,
  BookOpen,
} from 'lucide-react';
import { sendChatQuery } from './lib/api';
import { ChatAtmosphere } from './components/ChatAtmosphere';
import { OmegaLogo } from './components/OmegaLogo';
import { ChatWorkspace } from './components/ChatWorkspace';
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

export default function App() {
  const [activeNav, setActiveNav] = useState('preguntar');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [sessions, setSessions] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSIONS_STORAGE_KEY));
      return Array.isArray(saved) && saved.length > 0 ? saved : buildInitialDemoSessions();
    } catch {
      return buildInitialDemoSessions();
    }
  });
  const [currentSessionId, setCurrentSessionId] = useState(null);

  const [loadingChat, setLoadingChat] = useState(false);
  const [topK, setTopK] = useState(6);
  const [sourceScope, setSourceScope] = useState('Todas las fuentes');
  const [selectedCitation, setSelectedCitation] = useState(null);
  const [isSourcesPanelOpen, setIsSourcesPanelOpen] = useState(false);

  const textareaRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
        setCommandQuery('');
      } else if (e.key === 'Escape') {
        setCommandOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId) || null,
    [sessions, currentSessionId]
  );

  const messages = activeSession?.messages || [];

  // Recopilar citas únicas de la conversación activa para el panel lateral
  const activeConversationCitations = useMemo(() => {
    const list = [];
    const seen = new Set();
    for (const m of messages) {
      for (const cit of m.citations || []) {
        const key = `${cit.index}-${cit.report_id || cit.title}-${cit.page}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push(cit);
        }
      }
    }
    return list;
  }, [messages]);

  function startNewInvestigation() {
    setCurrentSessionId(null);
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
      setSelectedCitation(null);
      setIsSourcesPanelOpen(false);
    }
  }

  async function handleSend(rawPrompt, requestedScope = sourceScope, options = {}) {
    const query = (rawPrompt || '').trim();
    if (!query || loadingChat) return;

    const { forceNewSession = false } = options;
    const effectiveScope = requestedScope || 'Todas las fuentes';
    let targetSessionId = forceNewSession ? null : currentSessionId;
    const nowIso = new Date().toISOString();
    const userTurn = {
      role: 'user',
      content: query,
      sourceScope: effectiveScope,
    };

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

    const historyPayload = forceNewSession
      ? []
      : messages
          .filter((m) => !m.isError)
          .map((m) => ({ role: m.role, content: m.content }));
    setLoadingChat(true);
    const t0 = performance.now();

    try {
      const res = await sendChatQuery(query, historyPayload, topK, effectiveScope);
      const latency = ((performance.now() - t0) / 1000).toFixed(2);
      const assistantTurn = {
        role: 'assistant',
        content: res.answer,
        citations: res.citations || [],
        model: res.model,
        analysis: res.analysis,
        standaloneQuery: res.standalone_query,
        sourceScope: effectiveScope,
        latency,
      };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? { ...s, updatedAt: new Date().toISOString(), messages: [...s.messages, assistantTurn] }
            : s
        )
      );
    } catch (err) {
      const errorTurn = {
        role: 'assistant',
        isError: true,
        retryQuery: query,
        sourceScope: effectiveScope,
        content: err?.message || 'No fue posible conectar con el motor RAG en http://localhost:8000.',
        citations: [],
      };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? { ...s, updatedAt: new Date().toISOString(), messages: [...s.messages, errorTurn] }
            : s
        )
      );
    } finally {
      setLoadingChat(false);
    }
  }

  function handleRetryFailedTurn(errorMsgIndex, retryQuery, retryScope) {
    if (!currentSessionId || !retryQuery || loadingChat) return;
    const baseMessages = messages.slice(0, Math.max(0, errorMsgIndex - 1));
    setSessions((prev) =>
      prev.map((s) =>
        s.id === currentSessionId
          ? { ...s, updatedAt: new Date().toISOString(), messages: baseMessages }
          : s
      )
    );
    setTimeout(() => handleSend(retryQuery, retryScope), 0);
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

  function askInChat(promptText) {
    setSelectedCitation(null);
    setIsSourcesPanelOpen(false);
    setSourceScope('Todas las fuentes');
    setActiveNav('preguntar');
    handleSend(promptText, 'Todas las fuentes', { forceNewSession: true });
  }

  const isDesktop = typeof window !== 'undefined' && Boolean(window.omegaDesktop?.isDesktop);

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-[#08080A] text-[#F5F5F7]">
      {/* Rail Lateral Apple Vibrancy Izquierdo (72px compacto / 272px expandido) */}
      <aside
        aria-label="Navegación principal"
        className={`${
          sidebarCollapsed ? 'w-[72px]' : 'w-[272px]'
        } shrink-0 h-screen apple-vibrancy border-r border-white/[0.07] flex flex-col justify-between transition-[width] duration-[200ms] ease-apple z-30 select-none`}
      >
        {/* Zona Superior + Navegación Principal */}
        <div className="flex flex-col min-h-0 flex-1">
          {/* Identidad OMEGA sin jaula de bordes */}
          <div
            className={`titlebar-drag pt-4 pb-3.5 px-3.5 flex items-center ${
              sidebarCollapsed ? 'justify-center' : 'gap-3 px-4'
            }`}
          >
            <div className="titlebar-no-drag relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <OmegaLogo size={25} isThinking={loadingChat} />
            </div>

            {!sidebarCollapsed && (
              <div className="min-w-0 flex items-center gap-2">
                <span className="text-[13.5px] font-semibold tracking-[0.14em] text-[#F5F5F7]">
                  OMEGA
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-[#30D158]/90 shadow-[0_0_8px_rgba(48,209,88,0.55)]" />
              </div>
            )}
          </div>

          {/* Módulos + Divisor + Acciones Rápidas */}
          <div
            className={`pt-2 flex flex-col items-center gap-1.5 ${
              sidebarCollapsed ? 'px-3.5' : 'px-3'
            }`}
          >
            <nav className="w-full flex flex-col items-center gap-1.5">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeNav === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveNav(item.id)}
                    aria-label={`${item.label} — ${item.subtitle}`}
                    className={`relative group h-10 rounded-[11px] transition-[transform,color] duration-150 ease-apple active:scale-[0.96] cursor-pointer flex items-center ${
                      sidebarCollapsed
                        ? 'w-10 justify-center'
                        : 'w-full px-3 justify-start gap-3 text-left'
                    } ${
                      isActive
                        ? sidebarCollapsed
                          ? 'bg-[#2F6FED] text-white shadow-[0_6px_18px_rgba(47,111,237,0.38),inset_0_1px_0_rgba(255,255,255,0.28)]'
                          : 'bg-[#2F6FED]/16 text-[#F5F5F7] ring-1 ring-inset ring-[#2F6FED]/38 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                        : 'text-[#8E8E93] hover:bg-white/[0.06] hover:text-[#F5F5F7]'
                    }`}
                  >
                    <Icon
                      strokeWidth={isActive ? 1.85 : 1.65}
                      className={`h-[19px] w-[19px] shrink-0 transition-colors duration-200 ${
                        isActive && !sidebarCollapsed ? 'text-[#5E9BFF]' : ''
                      }`}
                    />

                    {!sidebarCollapsed && (
                      <div className="min-w-0 flex-1 leading-none">
                        <div className="truncate text-[13px] font-medium tracking-[-0.01em] text-[#F5F5F7]">
                          {item.label}
                        </div>
                        <div
                          className={`truncate text-[11px] mt-1 ${
                            isActive ? 'text-[#A9C7FF]/85' : 'text-[#8E8E93]'
                          }`}
                        >
                          {item.subtitle}
                        </div>
                      </div>
                    )}

                    {/* Popover flotante estilo macOS en modo compacto */}
                    {sidebarCollapsed && (
                      <div
                        role="tooltip"
                        className="apple-tooltip pointer-events-none opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0 transition-[opacity,transform] duration-150 ease-apple absolute left-full ml-4 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap rounded-[10px] px-3 py-2 text-left"
                      >
                        <div className="text-[12.5px] font-medium leading-tight text-[#F5F5F7]">
                          {item.label}
                        </div>
                        <div className="text-[11px] leading-tight text-[#8E8E93] mt-0.5">
                          {item.subtitle}
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Divisor sutil */}
            <div
              className={`${sidebarCollapsed ? 'w-5' : 'w-full'} h-px bg-white/[0.075] my-2`}
            />

            {/* Botón utilitario + (Nueva consulta rápida) */}
            <button
              type="button"
              onClick={startNewInvestigation}
              aria-label="Nueva consulta rápida"
              className={`relative group h-10 rounded-[11px] text-[#8E8E93] hover:bg-white/[0.06] hover:text-[#F5F5F7] active:scale-[0.96] transition-[transform,background-color,color] duration-200 ease-apple cursor-pointer flex items-center ${
                sidebarCollapsed
                  ? 'w-10 justify-center'
                  : 'w-full px-3 justify-start gap-3'
              }`}
            >
              <Plus strokeWidth={1.7} className="h-[19px] w-[19px] shrink-0" />
              {!sidebarCollapsed && (
                <span className="truncate text-[13px] font-medium tracking-[-0.01em] text-[#F5F5F7]">
                  Nueva consulta
                </span>
              )}
              {sidebarCollapsed && (
                <div
                  role="tooltip"
                  className="apple-tooltip pointer-events-none opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0 transition-[opacity,transform] duration-150 ease-apple absolute left-full ml-4 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap rounded-[10px] px-3 py-2 text-left"
                >
                  <div className="text-[12.5px] font-medium leading-tight text-[#F5F5F7]">
                    Nueva consulta
                  </div>
                  <div className="text-[11px] leading-tight text-[#8E8E93] mt-0.5">
                    Iniciar hilo limpio en Preguntar
                  </div>
                </div>
              )}
            </button>

            {/* Botón utilitario ⌘K (Paleta Spotlight) */}
            <button
              type="button"
              onClick={() => {
                setCommandOpen(true);
                setCommandQuery('');
              }}
              aria-label="Abrir búsqueda rápida (⌘K)"
              className={`relative group h-10 rounded-[11px] text-[#8E8E93] hover:bg-white/[0.06] hover:text-[#F5F5F7] active:scale-[0.96] transition-[transform,background-color,color] duration-200 ease-apple cursor-pointer flex items-center ${
                sidebarCollapsed
                  ? 'w-10 justify-center'
                  : 'w-full px-3 justify-between'
              }`}
            >
              <span className="inline-flex items-center gap-3 min-w-0">
                <Search strokeWidth={1.7} className="h-[18px] w-[18px] shrink-0" />
                {!sidebarCollapsed && (
                  <span className="truncate text-[13px] font-medium tracking-[-0.01em] text-[#F5F5F7]">
                    Búsqueda rápida
                  </span>
                )}
              </span>

              {!sidebarCollapsed && (
                <span className="font-tech shrink-0 rounded-[5px] bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 text-[10.5px] text-[#8E8E93]">
                  ⌘K
                </span>
              )}

              {sidebarCollapsed && (
                <div
                  role="tooltip"
                  className="apple-tooltip pointer-events-none opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0 transition-[opacity,transform] duration-150 ease-apple absolute left-full ml-4 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap rounded-[10px] px-3 py-2 text-left flex items-center gap-2.5"
                >
                  <div>
                    <div className="text-[12.5px] font-medium leading-tight text-[#F5F5F7]">
                      Búsqueda rápida
                    </div>
                    <div className="text-[11px] leading-tight text-[#8E8E93] mt-0.5">
                      Saltar a módulo o sesión
                    </div>
                  </div>
                  <span className="font-tech rounded-[5px] bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-[#8E8E93]">
                    ⌘K
                  </span>
                </div>
              )}
            </button>
          </div>

          {/* Historial de consultas recientes (visible al expandir) */}
          {!sidebarCollapsed && (
            <div className="mt-5 px-3 flex-1 min-h-0 flex flex-col">
              <div className="px-2 pb-1.5 text-[11px] font-semibold tracking-[0.02em] text-[#6E6E73]">
                Recientes
              </div>
              <div className="flex-1 overflow-y-auto space-y-0.5 pr-0.5">
                {sessions.map((sess) => {
                  const isSelected = activeNav === 'preguntar' && sess.id === currentSessionId;

                  return (
                    <div
                      key={sess.id}
                      onClick={() => {
                        setCurrentSessionId(sess.id);
                        setSelectedCitation(null);
                        setActiveNav('preguntar');
                      }}
                      className={`group flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-[9px] text-[12.5px] cursor-pointer transition-colors duration-150 ${
                        isSelected
                          ? 'bg-white/[0.08] text-[#F5F5F7]'
                          : 'text-[#8E8E93] hover:bg-white/[0.045] hover:text-[#F5F5F7]'
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="truncate leading-snug font-medium tracking-[-0.01em] text-[#F5F5F7]">
                          {sess.title}
                        </p>
                        <p className="font-tech text-[10.5px] text-[#6E6E73]">
                          {formatRelativeTime(sess.updatedAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => deleteSession(e, sess.id)}
                        title="Eliminar sesión"
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-[6px] text-[#8E8E93] hover:bg-white/[0.08] hover:text-[#F5F5F7] transition-all cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Zona Inferior — Expansión silenciosa */}
        <div
          className={`pt-2 pb-4 px-3.5 flex items-center ${
            sidebarCollapsed ? 'justify-center' : 'justify-between px-4'
          }`}
        >
          {!sidebarCollapsed && (
            <span className="text-[11px] font-medium text-[#6E6E73]">
              Operación pasiva
            </span>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
            title={sidebarCollapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
            className="h-9 w-9 shrink-0 rounded-[10px] flex items-center justify-center text-[#8E8E93] hover:bg-white/[0.06] hover:text-[#F5F5F7] active:scale-[0.94] transition-[transform,background-color,color] duration-200 ease-apple cursor-pointer"
          >
            {sidebarCollapsed ? (
              <ChevronRight strokeWidth={1.7} className="h-4 w-4" />
            ) : (
              <ChevronLeft strokeWidth={1.7} className="h-4 w-4" />
            )}
          </button>
        </div>
      </aside>

      {/* Área Principal Unificada (Lienzo Obsidiana + Atmósfera Continua) */}
      <div className="relative flex-1 h-full flex flex-col min-w-0 bg-[#08080A]">
        <ChatAtmosphere dimmed={activeNav !== 'preguntar' || messages.length > 0} />

        {/* Barra Superior Translúcida (48px) */}
        <header
          className={`relative z-10 h-12 shrink-0 px-6 flex items-center justify-between transition-colors duration-300 ease-apple ${
            isDesktop ? 'pr-40 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]' : ''
          } ${
            activeNav === 'preguntar' && messages.length === 0
              ? 'border-b border-transparent'
              : 'border-b border-white/[0.06] bg-[#08080A]/65 backdrop-blur-xl'
          }`}
        >
          <div className="flex items-center gap-2 text-[13px] tracking-[-0.01em]">
            {activeNav === 'preguntar' && messages.length === 0 ? null : (
              <>
                <span className="text-[#8E8E93] font-medium">OMEGA</span>
                <span className="text-white/20">/</span>
                <span className="font-semibold text-[#F5F5F7]">
                  {NAV_ITEMS.find((n) => n.id === activeNav)?.label}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {activeNav === 'preguntar' && messages.length > 0 && activeConversationCitations.length > 0 && (
              <button
                type="button"
                onClick={() => setIsSourcesPanelOpen((v) => !v)}
                className={`h-8 px-3 rounded-[8px] border flex items-center gap-1.5 text-[12.5px] font-medium active:scale-[0.97] transition-[transform,background-color,border-color,color] duration-150 cursor-pointer ${
                  isSourcesPanelOpen
                    ? 'border-[#2F6FED]/55 bg-[#2F6FED]/16 text-[#8AB4FF]'
                    : 'border-white/[0.08] bg-white/[0.045] text-[#D1D1D6] hover:bg-white/[0.08] hover:text-[#F5F5F7]'
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>Fuentes ({activeConversationCitations.length})</span>
              </button>
            )}

            {activeNav === 'preguntar' && messages.length > 0 && (
              <button
                type="button"
                onClick={handleExportSession}
                className="h-8 px-3 rounded-[8px] bg-white/[0.045] hover:bg-white/[0.08] border border-white/[0.08] flex items-center gap-1.5 text-[12.5px] font-medium text-[#F5F5F7] active:scale-[0.97] transition-[transform,background-color,border-color] duration-150 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-[#8E8E93]" />
                <span>Exportar</span>
              </button>
            )}
          </div>
        </header>

        {/* Contenido Dinámico */}
        {activeNav === 'preguntar' ? (
          <ChatWorkspace
            messages={messages}
            loading={loadingChat}
            sourceScope={sourceScope}
            onChangeSourceScope={setSourceScope}
            onSendMessage={handleSend}
            onRetryFailedTurn={handleRetryFailedTurn}
            activeCitation={selectedCitation}
            onSelectCitation={handleSelectCitation}
            isSourcesOpen={isSourcesPanelOpen}
            onToggleSources={() => setIsSourcesPanelOpen((v) => !v)}
            onCloseSources={() => setIsSourcesPanelOpen(false)}
            allConversationCitations={activeConversationCitations}
            hasHistory={sessions.length > 0}
            onResumeLastSession={() => {
              if (sessions.length > 0) {
                setCurrentSessionId(sessions[0].id);
                setSelectedCitation(null);
              }
            }}
            textareaRef={textareaRef}
          />
        ) : activeNav === 'amenazas' ? (
          <div className="relative z-10 flex-1 min-h-0 flex flex-col">
            <CampaignsPanel onAskInChat={askInChat} />
          </div>
        ) : activeNav === 'equipo' || activeNav === 'exposicion' || activeNav === 'enlace' ? (
          <main className="relative z-10 flex-1 overflow-y-auto px-6 py-8 flex flex-col">
            {activeNav === 'equipo' && <MvtVerifierPanel onAskInChat={askInChat} />}
            {activeNav === 'exposicion' && <OsintPanel onAskInChat={askInChat} />}
            {activeNav === 'enlace' && <LinkVerifierPanel onAskInChat={askInChat} />}
          </main>
        ) : (
          /* Ajustes (Layout macOS System Settings) */
          <main className="relative z-10 flex-1 min-h-0 flex flex-col overflow-hidden">
            <SettingsPanel
              topK={topK}
              onChangeTopK={setTopK}
              sourceScope={sourceScope}
              onChangeSourceScope={setSourceScope}
            />
          </main>
        )}
      </div>

      {/* Paleta Spotlight (⌘K) */}
      {commandOpen && (
        <div
          onClick={() => setCommandOpen(false)}
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-md flex items-start justify-center pt-[14vh] px-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="apple-modal-in w-full max-w-[520px] rounded-[16px] border border-white/[0.12] bg-[#141419]/88 backdrop-blur-2xl shadow-[0_32px_84px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.09)] overflow-hidden"
          >
            <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3.5">
              <Search strokeWidth={1.7} className="h-[18px] w-[18px] text-[#8E8E93] shrink-0" />
              <input
                type="text"
                autoFocus
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                placeholder="Ir a módulo o investigación reciente..."
                className="flex-1 bg-transparent text-[14.5px] tracking-[-0.01em] text-[#F5F5F7] placeholder-[#6E6E73] focus:outline-none"
              />
              <span className="font-tech rounded-[5px] bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 text-[10.5px] text-[#8E8E93]">
                ESC
              </span>
            </div>

            <div className="max-h-[460px] overflow-y-auto p-2 pb-2.5 space-y-1">
              <p className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold tracking-[0.02em] text-[#6E6E73]">
                Módulos
              </p>
              {NAV_ITEMS.filter(
                (item) =>
                  item.label.toLowerCase().includes(commandQuery.toLowerCase()) ||
                  (item.subtitle || '').toLowerCase().includes(commandQuery.toLowerCase())
              ).map((item) => {
                const Icon = item.icon;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveNav(item.id);
                      setCommandOpen(false);
                    }}
                    className="w-full flex items-center justify-between rounded-[10px] px-3 py-2 text-left text-[13px] text-[#F5F5F7] hover:bg-white/[0.07] transition-colors duration-150 cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-3">
                      <Icon strokeWidth={1.7} className="h-4 w-4 text-[#5E9BFF]" />
                      <span className="font-medium tracking-[-0.01em]">{item.label}</span>
                    </span>
                    <span className="text-[11.5px] text-[#8E8E93]">{item.subtitle}</span>
                  </button>
                );
              })}

              {sessions.length > 0 && (
                <>
                  <p className="px-2.5 pt-2.5 pb-0.5 text-[11px] font-semibold tracking-[0.02em] text-[#6E6E73]">
                    Investigaciones recientes
                  </p>
                  {sessions
                    .filter((s) =>
                      s.title.toLowerCase().includes(commandQuery.toLowerCase())
                    )
                    .slice(0, 5)
                    .map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setCurrentSessionId(s.id);
                          setSelectedCitation(null);
                          setActiveNav('preguntar');
                          setCommandOpen(false);
                        }}
                        className="w-full flex items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[12.5px] text-[#D1D1D6] hover:bg-white/[0.07] hover:text-[#F5F5F7] transition-colors duration-150 cursor-pointer"
                      >
                        <MessageSquare strokeWidth={1.65} className="h-3.5 w-3.5 text-[#8E8E93] shrink-0" />
                        <span className="truncate">{s.title}</span>
                      </button>
                    ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
