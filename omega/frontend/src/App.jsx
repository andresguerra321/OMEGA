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
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
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
  { id: 'preguntar', label: 'Preguntar', icon: MessageSquare },
  { id: 'amenazas', label: 'Amenazas', icon: Layers },
  { id: 'equipo', label: 'Revisar mi equipo', icon: Laptop },
  { id: 'exposicion', label: 'Mi exposición', icon: Radar },
  { id: 'enlace', label: 'Verificar enlace', icon: Link2 },
  { id: 'ajustes', label: 'Ajustes', icon: Settings },
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

  const [loadingChat, setLoadingChat] = useState(false);
  const [topK, setTopK] = useState(6);
  const [sourceScope, setSourceScope] = useState('Todas las fuentes');
  const [selectedCitation, setSelectedCitation] = useState(null);
  const [isSourcesPanelOpen, setIsSourcesPanelOpen] = useState(false);

  const textareaRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

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

  async function handleSend(rawPrompt, requestedScope = sourceScope) {
    const query = (rawPrompt || '').trim();
    if (!query || loadingChat) return;

    const effectiveScope = requestedScope || 'Todas las fuentes';
    let targetSessionId = currentSessionId;
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

    const historyPayload = messages
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

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-[#0A0A0C] text-[#F2F2F4]">
      {/* Sidebar Fija Izquierda (#111115) */}
      <aside
        className={`${
          sidebarCollapsed ? 'w-[60px]' : 'w-[244px]'
        } shrink-0 h-full border-r border-[#232329] bg-[#111115] flex flex-col justify-between transition-[width] duration-150 z-10`}
      >
        <div className="flex flex-col min-h-0 flex-1">
          {/* Header de Sidebar (48px) con Emblema Omega SVG Reactivo */}
          <div className="h-12 px-3.5 border-b border-[#232329] flex items-center justify-between">
            {!sidebarCollapsed && (
              <div className="flex items-center gap-2.5">
                <OmegaLogo size={24} isThinking={loadingChat} />
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-semibold tracking-[0.14em] text-[#F2F2F4]">
                    OMEGA
                  </span>
                  <span className="font-tech rounded-[3px] border border-[#232329] bg-[#141418] px-1 py-0.5 text-[9.5px] text-[#8E8E96]">
                    v1.0
                  </span>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              title={sidebarCollapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
              className="p-1 rounded-[4px] text-[#8E8E96] hover:bg-[#141418] hover:text-[#F2F2F4] transition-colors cursor-pointer"
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
              className={`w-full h-8 rounded-[5px] bg-[#F2F2F4] text-[#0A0A0C] flex items-center justify-center gap-2 text-[12px] font-medium hover:bg-white transition-colors cursor-pointer ${
                sidebarCollapsed ? 'px-0' : 'px-3'
              }`}
            >
              <Plus className="h-3.5 w-3.5" />
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
                      ? 'bg-[#15223D]/70 border-l-2 border-[#2F6FED] text-[#F2F2F4] font-medium'
                      : 'border-l-2 border-transparent text-[#8E8E96] hover:bg-[#141418] hover:text-[#F2F2F4]'
                  } ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-[#2F6FED]' : 'text-[#8E8E96]'
                    }`}
                  />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </nav>

          {/* Historial de Investigaciones */}
          {!sidebarCollapsed && (
            <div className="mt-4 px-2.5 flex-1 min-h-0 flex flex-col">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8E8E96]/70">
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
                        setSelectedCitation(null);
                        setActiveNav('preguntar');
                      }}
                      className={`group flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-[4px] text-[12px] cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[#141418] text-[#F2F2F4]'
                          : 'text-[#8E8E96] hover:bg-[#141418]/60 hover:text-[#F2F2F4]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate leading-tight font-medium">{sess.title}</p>
                        <p className="font-tech text-[10px] text-[#8E8E96]/60">
                          {formatRelativeTime(sess.updatedAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => deleteSession(e, sess.id)}
                        title="Eliminar sesión"
                        className="opacity-0 group-hover:opacity-100 p-1 text-[#8E8E96] hover:text-[#F2F2F4] transition-opacity"
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
        <div className="p-3 border-t border-[#232329] bg-[#111115] flex items-center justify-between text-[11px] text-[#8E8E96]">
          {sidebarCollapsed ? (
            <span className="h-1.5 w-1.5 mx-auto rounded-full bg-[#2F6FED]" title="Modo Defensivo · RNF1" />
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#2F6FED]" />
                <span>Modo Defensivo</span>
              </div>
              <span className="font-tech text-[10px]">RNF1</span>
            </>
          )}
        </div>
      </aside>

      {/* Área Principal (flex-1, fondo #0A0A0C) */}
      <div className="relative flex-1 h-full flex flex-col min-w-0 bg-[#0A0A0C]">
        {activeNav === 'preguntar' && <ChatAtmosphere dimmed={messages.length > 0} />}

        {/* Barra Superior Minimalista (48px) */}
        <header
          className={`relative z-10 h-12 shrink-0 px-6 flex items-center justify-between transition-colors duration-200 ease-kowalski ${
            activeNav === 'preguntar'
              ? messages.length === 0
                ? 'border-b border-transparent'
                : 'border-b border-[#232329] bg-[#0A0A0C]/80 backdrop-blur-md'
              : 'border-b border-[#232329]'
          }`}
        >
          <div className="flex items-center gap-2.5 text-[12px]">
            <span className="text-[#8E8E96]">Plataforma de Investigación</span>
            <span className="text-[#232329]">/</span>
            <span className="font-medium text-[#F2F2F4]">
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
                    ? 'border-[#2F6FED]/60 bg-[#15223D] text-[#7AA7FF]'
                    : 'border-[#232329] bg-[#141418] text-[#8E8E96] hover:border-[#2F6FED]/45 hover:text-[#F2F2F4]'
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
                className="h-[30px] px-3 rounded-[5px] bg-[#141418] border border-[#232329] flex items-center gap-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/45 disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-[#8E8E96]" />
                <span>Exportar (.md)</span>
              </button>
            )}
          </div>
        </header>

        {/* Contenido Dinámico */}
        {activeNav === 'preguntar' ? (
          <ChatWorkspace
            messages={messages}
            loading={loadingChat}
            topK={topK}
            onChangeTopK={setTopK}
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
