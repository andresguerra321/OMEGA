import { useEffect, useMemo, useRef, useState } from 'react';
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
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { fetchSystemGovernance, sendChatQuery } from './lib/api';
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
    description: 'Consulta vulnerabilidades como FORCEDENTRY o BLASTPASS en Pegasus.',
    prompt: '¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus y qué versiones afectaron?',
  },
  {
    icon: Network,
    title: 'Campañas y Actores',
    description: 'Analiza operaciones de Predator o Candiru, sectores y regiones.',
    prompt: '¿Qué sectores y regiones fueron objetivo en las campañas de Predator e Intellexa?',
  },
  {
    icon: FileSearch,
    title: 'Vectores e Indicadores',
    description: 'Revisa mecanismos de infección y artefactos de Citizen Lab y Amnesty.',
    prompt: 'Resume los principales vectores de infección inicial y artefactos forenses descritos en los reportes.',
  },
];

const SESSIONS_STORAGE_KEY = 'omega_chat_sessions_v1';

function buildDemoSessions() {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  return [
    {
      id: 'demo-pegasus-cves',
      title: 'CVEs zero-click FORCEDENTRY y BLASTPASS',
      updatedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      messages: [
        {
          role: 'user',
          content: '¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus y qué mecanismos emplearon?',
        },
        {
          role: 'assistant',
          content:
            'Los reportes técnicos documentan cadenas de explotación zero-click dirigidas a iOS mediante iMessage y procesamiento de imágenes sin interacción del usuario [1][2].\n\n- **FORCEDENTRY (`CVE-2021-30860`):** Explotó un desbordamiento de enteros en CoreGraphics al procesar archivos PDF disfrazados como GIF dentro de iMessage para evadir la mitigación `BlastDoor` [1].\n- **Escalamiento y fuga de sandbox (`CVE-2021-31010`):** Encadenada junto con la ejecución remota inicial para consolidar persistencia en el dispositivo objetivo [2].\n- **BLASTPASS (`CVE-2023-41064`):** Cadena zero-click posterior detectada en iOS 16 mediante adjuntos PassKit maliciosos con imágenes WebP manipuladas [1].',
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
          model: 'omega-demo-cti',
        },
      ],
    },
    {
      id: 'demo-predator-sectors',
      title: 'Campañas Predator y sectores objetivo',
      updatedAt: new Date(now - dayMs).toISOString(),
      messages: [
        {
          role: 'user',
          content: '¿Qué sectores e infraestructura se identificaron en las operaciones de Predator / Intellexa?',
        },
        {
          role: 'assistant',
          content:
            'Las investigaciones sobre la alianza Intellexa y el spyware **Predator** detallan campañas dirigidas mediante enlaces de 1-click y sistemas tácticos de inyección de red [1][2].\n\n- **Sectores afectados:** Periodistas de investigación, funcionarios gubernamentales, parlamentarios europeos y personal de organizaciones de derechos humanos [1].\n- **Infraestructura de entrega:** Uso de dominios de suplantación como `smscentro.com` y `tookcheckout.com` para redirigir víctimas desde mensajería SMS o redes sociales [2].\n\n> "Commercial surveillance vendors continue to proliferate sophisticated mobile exploits against civil society despite export control frameworks." [1]',
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
                'One-click links delivered over SMS masqueraded as legitimate URL shorteners and regional news portals before triggering Chrome and Android kernel exploits (CVE-2021-1048).',
              source_url: 'https://blog.google/threat-analysis-group/',
            },
          ],
          model: 'omega-demo-cti',
        },
      ],
    },
    {
      id: 'demo-candiru-infra',
      title: 'Infraestructura Candiru y artefactos MVT',
      updatedAt: new Date(now - 4 * dayMs).toISOString(),
      messages: [
        {
          role: 'user',
          content: '¿Qué artefactos forenses y dominios señuelo se asocian a Candiru y Pegasus en MVT?',
        },
        {
          role: 'assistant',
          content:
            'Los análisis forenses con Mobile Verification Toolkit (`MVT`) permiten identificar rastros persistentes de infección en dispositivos móviles [1][2].\n\n- **Dominios señuelo de Candiru:** Se documentó infraestructura imitando organizaciones de derechos humanos y medios, como `blacklivesmatters.info` y `cnn24-7.online` [1].\n- **Artefactos locales en iOS:** Anomalías en `shutdown.log` (procesos sospechosos como `abscarrylog`), redirecciones en `safari_history.json` y fallos repetidos en `IMTranscoderAgent` [2].',
          citations: [
            {
              index: 1,
              title: 'Hooking Candiru: Another Mercenary Spyware Vendor Comes into Focus',
              organization: 'Citizen Lab',
              page: 7,
              similarity: 0.883,
              retrieval_method: 'Híbrido (Vector + Exacto)',
              snippet:
                'Candiru operated masquerading domains mimicking advocacy groups and international media outlets including blacklivesmatters.info and cnn24-7.online.',
              source_url: 'https://citizenlab.ca/',
            },
            {
              index: 2,
              title: 'Forensic Methodology Report: How to Catch NSO Group Pegasus',
              organization: 'Amnesty Tech',
              page: 58,
              similarity: 0.905,
              retrieval_method: 'Coincidencia Exacta',
              snippet:
                'Examining Shutdown.log alongside Safari History.db and crash logs from IMTranscoderAgent provides high-confidence corroboration of Pegasus activity.',
              source_url: 'https://securitylab.amnesty.org/latest/2021/07/the-pegasus-project/',
            },
          ],
          model: 'omega-demo-cti',
        },
      ],
    },
  ];
}

function buildFallbackAnswer(query) {
  return {
    answer: `Modo de vista previa sin conexión activa con el backend en \`localhost:8000\`. Resumen ilustrativo para **"${query}"**:\n\n- **Trazabilidad documental:** Los reportes de **Citizen Lab** y **Amnesty Tech** correlacionan cadenas zero-click (\`CVE-2021-30860\`, \`CVE-2023-41064\`) con artefactos locales en \`shutdown.log\`, historial de Safari y dominios de comando y control como \`weather4free.com\` [1][2].\n- **Verificación recomendada:** Puedes inspeccionar el fragmento fuente haciendo clic en cualquier insignia de cita [1] o cruzar un respaldo forense en el módulo **Revisar mi equipo** [2].`,
    citations: [
      {
        index: 1,
        title: 'FORCEDENTRY: NSO Group iMessage Zero-Click Exploit Captured in the Wild',
        organization: 'Citizen Lab',
        page: 3,
        similarity: 0.91,
        retrieval_method: 'Vista previa local',
        snippet:
          'FORCEDENTRY (CVE-2021-30860) enabled remote code execution without user interaction on iOS devices prior to iOS 14.8.',
        source_url: 'https://citizenlab.ca/',
      },
      {
        index: 2,
        title: 'Forensic Methodology Report: How to Catch NSO Group Pegasus',
        organization: 'Amnesty Tech',
        page: 58,
        similarity: 0.87,
        retrieval_method: 'Vista previa local',
        snippet:
          'Correlating DNS caches, Safari redirections and Shutdown.log process timelines allows analysts to distinguish false positives from confirmed infections.',
        source_url: 'https://securitylab.amnesty.org/',
      },
    ],
    model: 'omega-preview-fallback',
  };
}

function groupSessionsByDate(sessionList) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfLast7Days = startOfToday - 7 * 24 * 60 * 60 * 1000;

  const groups = [
    { label: 'Hoy', items: [] },
    { label: 'Ayer', items: [] },
    { label: 'Últimos 7 días', items: [] },
    { label: 'Anteriores', items: [] },
  ];

  for (const s of sessionList) {
    const ts = new Date(s.updatedAt || now).getTime();
    if (ts >= startOfToday) {
      groups[0].items.push(s);
    } else if (ts >= startOfYesterday) {
      groups[1].items.push(s);
    } else if (ts >= startOfLast7Days) {
      groups[2].items.push(s);
    } else {
      groups[3].items.push(s);
    }
  }

  return groups.filter((g) => g.items.length > 0);
}

export default function App() {
  const [activeNav, setActiveNav] = useState('preguntar');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sessions, setSessions] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSIONS_STORAGE_KEY));
      if (Array.isArray(saved) && saved.length > 0) return saved;
      return buildDemoSessions();
    } catch {
      return buildDemoSessions();
    }
  });
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [historyFilter, setHistoryFilter] = useState('');
  const [corpusSummary, setCorpusSummary] = useState({
    reports: 15,
    chunks: 530,
    iocs: 4855,
  });

  const [input, setInput] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState(null);
  const [topK, setTopK] = useState(6);

  const searchInputRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    fetchSystemGovernance()
      .then((data) => {
        if (data?.corpus_stats) {
          setCorpusSummary({
            reports: data.corpus_stats.reports ?? 15,
            chunks: data.corpus_stats.chunks ?? 530,
            iocs: data.corpus_stats.iocs ?? 4855,
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onGlobalKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (sidebarCollapsed) setSidebarCollapsed(false);
        setTimeout(() => searchInputRef.current?.focus(), 20);
      }
    }
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [sidebarCollapsed]);

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

  const groupedSessions = useMemo(
    () => groupSessionsByDate(filteredSessions),
    [filteredSessions]
  );

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
    const nowIso = new Date().toISOString();

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
      {/* Sidebar Fija Izquierda (268px, colapsable) */}
      <aside
        className={`${
          sidebarCollapsed ? 'w-[56px]' : 'w-[268px]'
        } shrink-0 border-r border-[#232329] bg-[#111115] flex flex-col justify-between transition-[width] duration-150`}
      >
        <div className="flex flex-col min-h-0 flex-1">
          {/* Cabecera (48px) */}
          <div className="h-12 px-3 border-b border-[#232329] flex items-center justify-between">
            {!sidebarCollapsed && (
              <div className="flex items-center gap-2.5 pl-1">
                <div className="h-5 w-5 rounded-[4px] border border-[#232329] bg-[#141418] flex items-center justify-center">
                  <div className="h-2 w-2 rounded-[2px] bg-[#2F6FED]" />
                </div>
                <span className="text-[13px] font-semibold tracking-wider text-[#F2F2F4]">
                  OMEGA
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              title={sidebarCollapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
              className="mx-auto flex h-7 w-7 items-center justify-center rounded-[4px] border border-transparent text-[#8E8E96] hover:border-[#232329] hover:bg-[#141418] hover:text-[#F2F2F4] transition-colors cursor-pointer"
              style={!sidebarCollapsed ? { marginLeft: 'auto', marginRight: 0 } : undefined}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>

          {sidebarCollapsed ? (
            /* Modo colapsado: solo iconos de acción + 6 módulos */
            <div className="p-2 space-y-1.5 flex-1">
              <button
                type="button"
                onClick={startNewChat}
                title="Nueva consulta"
                className="w-full h-9 flex items-center justify-center rounded-[5px] bg-[#F2F2F4] text-[#0A0A0C] font-medium hover:bg-[#E4E4E8] transition-colors cursor-pointer"
              >
                <Plus className="h-4 w-4" />
              </button>

              <div className="pt-2 border-t border-[#232329] space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeNav === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveNav(item.id)}
                      title={`${item.label} — ${item.subtitle}`}
                      className={`w-full h-9 flex items-center justify-center rounded-[4px] border-l-2 transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-[#191B22] border-l-[#2F6FED] text-[#F2F2F4]'
                          : 'border-l-transparent text-[#8E8E96] hover:bg-[#191B22]/60 hover:text-[#F2F2F4]'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              {/* Acción Primaria + Buscar en historial */}
              <div className="p-3 space-y-2 border-b border-[#232329]">
                <button
                  type="button"
                  onClick={startNewChat}
                  className="w-full flex items-center justify-center gap-2 rounded-[5px] bg-[#F2F2F4] px-3 py-2 text-[12px] font-medium text-[#0A0A0C] hover:bg-[#E4E4E8] transition-colors cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Nueva consulta</span>
                </button>

                <div className="relative flex items-center">
                  <Search className="absolute left-2.5 h-3.5 w-3.5 text-[#8E8E96] pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={historyFilter}
                    onChange={(e) => setHistoryFilter(e.target.value)}
                    placeholder="Buscar en historial..."
                    className="w-full rounded-[4px] border border-[#232329] bg-[#141418] py-1.5 pl-8 pr-11 text-[12px] text-[#F2F2F4] placeholder-[#8E8E96] focus:border-[#32323A] focus:outline-none"
                  />
                  <span className="font-tech absolute right-2 rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-1.5 py-0.5 text-[10px] text-[#8E8E96] pointer-events-none">
                    ⌘K
                  </span>
                </div>
              </div>

              {/* Navegación Principal (6 módulos exactos) */}
              <nav className="p-2.5 space-y-0.5 border-b border-[#232329]">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeNav === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveNav(item.id)}
                      className={`w-full flex items-center gap-2.5 rounded-[4px] border-l-2 px-2.5 py-2 text-left transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-[#191B22] border-l-[#2F6FED] text-[#F2F2F4]'
                          : 'border-l-transparent text-[#8E8E96] hover:bg-[#191B22]/60 hover:text-[#F2F2F4]'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          isActive ? 'text-[#F2F2F4]' : 'text-[#8E8E96]'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium leading-tight">{item.label}</p>
                        <p className="text-[11px] text-[#8E8E96] truncate">{item.subtitle}</p>
                      </div>
                    </button>
                  );
                })}
              </nav>

              {/* Historial Cronológico Agrupado */}
              <div className="p-2.5 flex-1 overflow-y-auto space-y-3">
                {groupedSessions.length === 0 ? (
                  <p className="px-2 py-2 text-[11px] text-[#8E8E96]">
                    Sin consultas que coincidan con el filtro.
                  </p>
                ) : (
                  groupedSessions.map((group) => (
                    <div key={group.label} className="space-y-1">
                      <p className="px-2 text-[10px] font-medium uppercase tracking-wider text-[#8E8E96]">
                        {group.label}
                      </p>
                      {group.items.map((sess) => {
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
                                ? 'bg-[#191B22] text-[#F2F2F4]'
                                : 'text-[#8E8E96] hover:bg-[#191B22]/60 hover:text-[#F2F2F4]'
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
                      })}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer de Sidebar */}
        <div className="p-3 border-t border-[#232329] bg-[#111115] flex items-center justify-between text-[11px]">
          {sidebarCollapsed ? (
            <div className="mx-auto h-2 w-2 rounded-[2px] bg-[#2F6FED]" title="Modo Defensivo · RNF1" />
          ) : (
            <>
              <div className="flex items-center gap-2 text-[#8E8E96]">
                <span className="h-2 w-2 rounded-[2px] bg-[#2F6FED]" />
                <span>Sesión local</span>
              </div>
              <span className="text-[10px] text-[#8E8E96]">Modo Defensivo · RNF1</span>
            </>
          )}
        </div>
      </aside>

      {/* Panel Principal */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0A0A0C]">
        {/* Barra Superior de Ventana (48px) */}
        <header className="h-12 shrink-0 border-b border-[#232329] px-6 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {activeNav === 'preguntar' ? (
              <>
                <span className="text-[12px] font-medium text-[#F2F2F4]">
                  Omega RAG · Búsqueda Híbrida
                </span>
                <span className="text-[#232329]">|</span>
                <span className="font-tech text-[11px] text-[#8E8E96] truncate">
                  {corpusSummary.reports} reportes · {corpusSummary.chunks} fragmentos · {corpusSummary.iocs.toLocaleString()} IOCs
                </span>
              </>
            ) : (
              <>
                <span className="text-[13px] font-medium text-[#F2F2F4]">
                  {currentNavMeta?.label}
                </span>
                <span className="text-[#232329]">/</span>
                <span className="text-[12px] text-[#8E8E96]">{currentNavMeta?.subtitle}</span>
              </>
            )}
          </div>

          {activeNav === 'preguntar' && (
            <button
              type="button"
              onClick={handleExportSession}
              disabled={messages.length === 0}
              className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-3 py-1.5 text-[12px] text-[#F2F2F4] hover:border-[#32323A] hover:bg-[#191B22] disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
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
              /* Estado A: Pantalla Inicial Centrada */
              <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-6 py-10">
                <div className="w-full max-w-[680px] space-y-6">
                  <div className="flex flex-col items-center text-center space-y-3">
                    {/* Emblema geométrico minimalista */}
                    <div
                      aria-hidden="true"
                      className="h-9 w-9 rounded-[6px] border border-[#232329] bg-[#141418] flex items-center justify-center"
                    >
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                        <rect
                          x="2.25"
                          y="2.25"
                          width="13.5"
                          height="13.5"
                          rx="2"
                          stroke="#232329"
                          strokeWidth="1.25"
                        />
                        <rect x="6" y="6" width="6" height="6" rx="1" fill="#2F6FED" />
                      </svg>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[15px] text-[#8E8E96]">
                        Plataforma defensiva de inteligencia de amenazas
                      </p>
                      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[#F2F2F4]">
                        ¿Qué campaña o indicador deseas investigar?
                      </h1>
                    </div>
                  </div>

                  {/* Composer Central */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSend();
                    }}
                    className="rounded-[6px] border border-[#232329] bg-[#141418] focus-within:border-[#32323A] transition-colors"
                  >
                    <textarea
                      rows={2}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Pregunta sobre CVEs, vectores zero-click, campañas o indicadores..."
                      className="min-h-[64px] w-full resize-none bg-transparent p-4 text-[14px] leading-relaxed text-[#F2F2F4] placeholder-[#8E8E96] focus:outline-none"
                    />

                    <div className="flex items-center justify-between border-t border-[#232329] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#1C1C22] px-2 py-1 text-[11px] font-medium text-[#8E8E96]">
                          <ShieldCheck className="h-3 w-3 text-[#8E8E96]" />
                          <span>Citas obligatorias</span>
                        </span>

                        <select
                          value={topK}
                          onChange={(e) => setTopK(Number(e.target.value))}
                          className="rounded-[4px] border border-[#232329] bg-[#1C1C22] px-2 py-1 text-[11px] text-[#8E8E96] focus:border-[#32323A] focus:outline-none"
                        >
                          <option value={4}>4 fuentes</option>
                          <option value={6}>6 fuentes</option>
                          <option value={10}>10 fuentes</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <span className="hidden sm:inline text-[11px] text-[#8E8E96]">
                          Enter ↵
                        </span>
                        <button
                          type="submit"
                          disabled={loadingChat || !input.trim()}
                          aria-label="Enviar consulta"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] bg-[#2F6FED] text-[#F2F2F4] hover:bg-[#255ED4] disabled:opacity-40 transition-colors cursor-pointer"
                        >
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
                          className="group flex flex-col items-start justify-between rounded-[6px] border border-[#232329] bg-[#141418] p-3.5 text-left hover:border-[#32323A] hover:bg-[#191B22] transition-colors cursor-pointer"
                        >
                          <div className="space-y-2">
                            <CardIcon className="h-4 w-4 text-[#8E8E96] group-hover:text-[#2F6FED] transition-colors" />
                            <h2 className="text-[13px] font-semibold text-[#F2F2F4]">
                              {card.title}
                            </h2>
                            <p className="line-clamp-2 text-[12px] leading-[1.45] text-[#8E8E96]">
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
              /* Estado B: Hilo Activo de Investigación */
              <>
                <div className="flex-1 overflow-y-auto px-6 py-7">
                  <div className="mx-auto max-w-[740px] space-y-6">
                    {messages.map((msg, idx) =>
                      msg.role === 'user' ? (
                        <div
                          key={idx}
                          className="rounded-[6px] border border-[#232329] bg-[#141418] px-4 py-3 text-[14px] text-[#F2F2F4]"
                        >
                          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[#8E8E96]">
                            CONSULTA
                          </p>
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        </div>
                      ) : (
                        <div
                          key={idx}
                          className="border-l-2 border-[#2F6FED] pl-[20px] py-1 space-y-4"
                        >
                          <MarkdownMessage
                            content={msg.content}
                            citations={msg.citations}
                            onSelectCitation={setSelectedCitation}
                          />

                          {/* Chips compactos de citas al pie */}
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
                                    className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-2.5 py-1 text-[11px] text-[#F2F2F4] hover:border-[#32323A] hover:bg-[#191B22] transition-colors cursor-pointer"
                                  >
                                    <span className="font-medium text-[#8E8E96]">
                                      [{cit.index}]
                                    </span>
                                    <span className="max-w-[220px] truncate">{cit.title}</span>
                                    <span className="text-[#8E8E96]">· p.{cit.page}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    )}

                    {loadingChat && (
                      <div className="border-l-2 border-[#232329] pl-[20px] py-2 text-[13px] text-[#8E8E96]">
                        Recuperando fragmentos y verificando citas en el corpus...
                      </div>
                    )}
                  </div>
                </div>

                {/* Composer Inferior Fijo */}
                <div className="shrink-0 border-t border-[#232329] bg-[#0A0A0C] px-6 py-3.5">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSend();
                    }}
                    className="mx-auto max-w-[740px] flex items-center gap-2 rounded-[6px] border border-[#232329] bg-[#141418] px-3 py-2 focus-within:border-[#32323A] transition-colors"
                  >
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Realiza una pregunta de seguimiento sobre esta evidencia..."
                      className="flex-1 bg-transparent text-[13px] text-[#F2F2F4] placeholder-[#8E8E96] focus:outline-none"
                    />
                    <span className="hidden sm:inline text-[11px] text-[#8E8E96]">
                      Enter ↵
                    </span>
                    <button
                      type="submit"
                      disabled={loadingChat || !input.trim()}
                      aria-label="Enviar seguimiento"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] bg-[#2F6FED] text-[#F2F2F4] hover:bg-[#255ED4] disabled:opacity-40 transition-colors cursor-pointer"
                    >
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
