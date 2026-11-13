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
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  Fingerprint,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  Clock,
  ChevronRight,
} from 'lucide-react';
import { fetchSystemGovernance, sendChatQuery } from './lib/api';
import { formatRelativeTimestamp } from './lib/investigationParser';
import { CitationDrawer } from './components/CitationDrawer';
import { InvestigationDossier } from './components/InvestigationDossier';
import { CampaignsPanel } from './components/CampaignsPanel';
import { MvtVerifierPanel } from './components/MvtVerifierPanel';
import { OsintPanel } from './components/OsintPanel';
import { LinkVerifierPanel } from './components/LinkVerifierPanel';
import { SettingsPanel } from './components/SettingsPanel';

const NAV_GROUPS = [
  {
    category: 'Inteligencia',
    items: [
      {
        id: 'preguntar',
        label: 'Preguntar',
        headerLabel: 'Intelligence',
        subtitle: 'Consultas con citas verificables',
        icon: MessageSquare,
      },
      {
        id: 'amenazas',
        label: 'Amenazas',
        headerLabel: 'Amenazas',
        subtitle: 'Campañas, CVEs y actores',
        icon: Layers,
      },
    ],
  },
  {
    category: 'Exposición',
    items: [
      {
        id: 'equipo',
        label: 'Revisar mi equipo',
        headerLabel: 'Revisar mi equipo',
        subtitle: 'Verificación forense en RAM',
        icon: Laptop,
      },
      {
        id: 'exposicion',
        label: 'Mi exposición',
        headerLabel: 'Mi exposición',
        subtitle: 'Auditoría OSINT autorizada',
        icon: Radar,
      },
      {
        id: 'enlace',
        label: 'Verificar enlace',
        headerLabel: 'Verificar enlace',
        subtitle: 'Inspección pasiva pre-clic',
        icon: Link2,
      },
    ],
  },
  {
    category: 'Sistema',
    items: [
      {
        id: 'ajustes',
        label: 'Ajustes',
        headerLabel: 'Ajustes',
        subtitle: 'Cuenta, alcance y permisos',
        icon: Settings,
      },
    ],
  },
];

const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

const STARTER_CARDS = [
  {
    category: 'Vulnerabilidades',
    icon: ShieldAlert,
    title: 'CVEs y exploits zero-click',
    description: 'Cadenas iMessage, adjuntos WebP y evasión de BlastDoor documentadas en iOS.',
    example: 'CVE-2021-30860 · CVE-2023-41064',
    prompt:
      '¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus y qué versiones afectaron?',
  },
  {
    category: 'Actores y campañas',
    icon: Radar,
    title: 'APT, operaciones y sectores',
    description: 'Sectores vigilados e infraestructura táctica de Intellexa Predator y NSO Group.',
    example: 'smscentro.com · Google TAG',
    prompt:
      '¿Qué sectores y regiones fueron objetivo en las campañas de Predator e Intellexa?',
  },
  {
    category: 'Indicadores',
    icon: Fingerprint,
    title: 'IOCs, artefactos y TTPs',
    description: 'Artefactos locales en shutdown.log, Safari y dominios señuelo de Candiru.',
    example: 'shutdown.log · blacklivesmatters.info',
    prompt:
      'Resume los principales vectores de infección inicial y artefactos forenses descritos en los reportes.',
  },
];

const SESSIONS_STORAGE_KEY = 'omega_chat_sessions_v1';

function buildDemoSessions() {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  const t1 = new Date(now - 2 * hourMs).toISOString();
  const t2 = new Date(now - dayMs).toISOString();
  const t3 = new Date(now - 4 * dayMs).toISOString();

  return [
    {
      id: 'demo-pegasus-cves',
      title: 'FORCEDENTRY · Zero-click exploitation',
      updatedAt: t1,
      messages: [
        {
          role: 'user',
          createdAt: t1,
          content:
            '¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus y qué mecanismos emplearon?',
        },
        {
          role: 'assistant',
          createdAt: t1,
          content:
            'Los reportes técnicos documentan cadenas de explotación zero-click dirigidas a iOS mediante iMessage y procesamiento de imágenes sin interacción del usuario [1][2].\n\n- **Vector de explotación (FORCEDENTRY):** Explotó un desbordamiento de enteros en CoreGraphics al procesar archivos PDF disfrazados como GIF dentro de iMessage (`CVE-2021-30860`) para evadir la mitigación `BlastDoor` [1].\n- **Escalamiento y fuga de sandbox:** Encadenó `CVE-2021-31010` junto con la ejecución remota inicial para consolidar persistencia en el dispositivo objetivo [2].\n- **Vector posterior (BLASTPASS):** Cadena zero-click detectada en iOS 16 (`CVE-2023-41064`) mediante adjuntos PassKit maliciosos con imágenes WebP manipuladas [1].',
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
          model: 'llama-3.3-70b-versatile',
        },
      ],
    },
    {
      id: 'demo-predator-sectors',
      title: 'Predator · Campaign analysis',
      updatedAt: t2,
      messages: [
        {
          role: 'user',
          createdAt: t2,
          content:
            '¿Qué sectores e infraestructura se identificaron en las operaciones de Predator / Intellexa?',
        },
        {
          role: 'assistant',
          createdAt: t2,
          content:
            'Las investigaciones sobre la alianza Intellexa y el spyware **Predator** detallan campañas dirigidas mediante enlaces de 1-click y sistemas tácticos de inyección de red [1][2].\n\n- **Actores y objetivos:** Periodistas de investigación, funcionarios gubernamentales, parlamentarios europeos y personal de organizaciones de derechos humanos [1].\n- **Infraestructura y C2:** Uso de dominios de suplantación como `smscentro.com` y `tookcheckout.com` para redirigir víctimas desde mensajería SMS o redes sociales [2].\n- **Explotación móvil:** Enlaces maliciosos en Android y Chrome encadenados con `CVE-2021-1048` en el kernel para ejecución privilegiada [2].',
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
          model: 'llama-3.3-70b-versatile',
        },
      ],
    },
    {
      id: 'demo-candiru-infra',
      title: 'Candiru · Infrastructure & MVT traces',
      updatedAt: t3,
      messages: [
        {
          role: 'user',
          createdAt: t3,
          content:
            '¿Qué artefactos forenses y dominios señuelo se asocian a Candiru y Pegasus en MVT?',
        },
        {
          role: 'assistant',
          createdAt: t3,
          content:
            'Los análisis forenses con Mobile Verification Toolkit (`MVT`) permiten identificar rastros persistentes de infección y dominios señuelo en dispositivos comprometidos [1][2].\n\n- **Infraestructura C2 de Candiru:** Se documentó infraestructura imitando organizaciones de derechos humanos y medios, incluyendo `blacklivesmatters.info` y `cnn24-7.online` [1].\n- **Artefactos forenses locales en iOS:** Anomalías en `shutdown.log` (procesos sospechosos como `abscarrylog`), redirecciones en `safari_history.json` y fallos repetidos en `IMTranscoderAgent` [2].',
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
          model: 'llama-3.3-70b-versatile',
        },
      ],
    },
  ];
}

function loadInitialSessions() {
  const freshDemos = buildDemoSessions();
  const demoById = new Map(freshDemos.map((d) => [d.id, d]));

  try {
    const saved = JSON.parse(localStorage.getItem(SESSIONS_STORAGE_KEY));
    if (Array.isArray(saved) && saved.length > 0) {
      // Actualiza sesiones demo heredadas para mantener estructura analítica coherente sin perder sesiones del usuario
      return saved.map((s) => (demoById.has(s.id) ? demoById.get(s.id) : s));
    }
    return freshDemos;
  } catch {
    return freshDemos;
  }
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

function buildFallbackAnswer(query) {
  return {
    answer: `Modo de vista previa sin conexión activa con el backend en \`localhost:8000\`. Conclusión preliminar para **"${query}"** basada en índices locales de demostración [1][2].\n\n- **Trazabilidad documental:** Los reportes de **Citizen Lab** y **Amnesty Tech** correlacionan cadenas zero-click (\`CVE-2021-30860\`, \`CVE-2023-41064\`) con artefactos locales en \`shutdown.log\`, historial de Safari y dominios de comando y control como \`weather4free.com\` [1][2].\n- **Verificación forense recomendada:** Inspecciona cada fragmento recuperado para validar evidencia o cruza un respaldo local en el módulo **Revisar mi equipo** [2].`,
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

function ContextStatPill({ value, label, tooltip }) {
  return (
    <div className="group/tip relative flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] cursor-default">
      <span className="font-tech font-medium text-[#F0F2F5]">{value}</span>
      <span className="text-[#929BAA]">{label}</span>

      <div
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full mt-2 w-60 rounded-[5px] border border-[#262B33] bg-[#171A20] px-3 py-2 text-[11px] leading-relaxed text-[#929BAA] opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-40"
      >
        <span className="font-medium text-[#F0F2F5] block mb-0.5">
          {value} {label}
        </span>
        {tooltip}
      </div>
    </div>
  );
}

export default function App() {
  const [activeNav, setActiveNav] = useState('preguntar');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sessions, setSessions] = useState(loadInitialSessions);
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

  const recentHomeActivity = useMemo(() => sessions.slice(0, 3), [sessions]);

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
    const nowIso = new Date().toISOString();
    const userTurn = { role: 'user', content: query, createdAt: nowIso };

    if (!targetSessionId) {
      targetSessionId = crypto.randomUUID();
      const newSession = {
        id: targetSessionId,
        title: query.length > 48 ? `${query.slice(0, 48)}...` : query,
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
      const replyTime = new Date().toISOString();
      const assistantTurn = {
        role: 'assistant',
        createdAt: replyTime,
        content: res.answer,
        citations: res.citations || [],
        model: res.model,
        analysis: res.analysis || null,
      };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? { ...s, updatedAt: replyTime, messages: [...s.messages, assistantTurn] }
            : s
        )
      );
    } catch {
      const fallback = buildFallbackAnswer(query);
      const replyTime = new Date().toISOString();
      const fallbackTurn = {
        role: 'assistant',
        createdAt: replyTime,
        content: fallback.answer,
        citations: fallback.citations,
        model: fallback.model,
        analysis: null,
      };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? { ...s, updatedAt: replyTime, messages: [...s.messages, fallbackTurn] }
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
      `# Dossier de Investigación CTI — ${activeSession.title}`,
      `- **Fecha:** ${new Date().toISOString()}`,
      `- **Sistema:** Omega Threat Intelligence Platform`,
      '',
    ];

    messages.forEach((m) => {
      if (m.role === 'user') {
        lines.push(`## Consulta del Analista\n${m.content}\n`);
      } else {
        lines.push(`## Respuesta Trazable\n${m.content}\n`);
        if (m.citations?.length) {
          lines.push('### Evidencias y Fuentes Citadas');
          m.citations.forEach((c) => {
            lines.push(
              `- **[${c.index}]** ${c.title} (${c.organization}) — p.${c.page} · Similitud ${(Number(c.similarity || 0) * 100).toFixed(1)}%`
            );
          });
          lines.push('');
        }
      }
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omega_dossier_${Date.now()}.md`;
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

  const currentNavMeta = ALL_NAV_ITEMS.find((n) => n.id === activeNav);
  const isTyping = input.trim().length > 0;

  return (
    <div className="h-screen flex overflow-hidden bg-[#0D0F12] text-[#F0F2F5]">
      {/* Sidebar Fija Izquierda (#111318) */}
      <aside
        className={`${
          sidebarCollapsed ? 'w-[56px]' : 'w-[268px]'
        } shrink-0 border-r border-[#262B33] bg-[#111318] flex flex-col justify-between transition-[width] duration-150`}
      >
        <div className="flex flex-col min-h-0 flex-1">
          {/* Cabecera Sidebar (48px) */}
          <div className="h-12 px-3 border-b border-[#262B33] flex items-center justify-between">
            {!sidebarCollapsed && (
              <div className="flex items-center gap-2.5 pl-1">
                <div className="h-5 w-5 rounded-[4px] border border-[#262B33] bg-[#171A20] flex items-center justify-center">
                  <div className="h-2 w-2 rounded-[2px] bg-[#3978F6]" />
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
              className="mx-auto flex h-7 w-7 items-center justify-center rounded-[4px] border border-transparent text-[#929BAA] hover:border-[#262B33] hover:bg-[#171A20] hover:text-[#F0F2F5] transition-colors duration-150 cursor-pointer"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-3.5 w-3.5" />
              ) : (
                <PanelLeftClose className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {sidebarCollapsed ? (
            <div className="p-2 space-y-2 flex-1 overflow-y-auto">
              <button
                type="button"
                onClick={startNewChat}
                title="Nueva investigación"
                className="w-full h-9 flex items-center justify-center rounded-[5px] bg-[#F0F2F5] text-[#0D0F12] font-medium hover:bg-[#E2E6EC] transition-colors duration-150 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
              </button>

              <div className="pt-2 border-t border-[#262B33] space-y-1">
                {ALL_NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeNav === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveNav(item.id)}
                      title={`${item.label} — ${item.subtitle}`}
                      className={`w-full h-8 flex items-center justify-center rounded-[4px] border-l-2 transition-colors duration-150 cursor-pointer ${
                        isActive
                          ? 'bg-[#171A20] border-l-[#3978F6] text-[#3978F6]'
                          : 'border-l-transparent text-[#929BAA] hover:bg-[#171A20]/60 hover:text-[#F0F2F5]'
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
              {/* Acción primaria y buscador */}
              <div className="p-3 space-y-2 border-b border-[#262B33]">
                <button
                  type="button"
                  onClick={startNewChat}
                  className="w-full flex items-center justify-center gap-2 rounded-[5px] bg-[#F0F2F5] px-3 py-1.5 text-[12px] font-medium text-[#0D0F12] hover:bg-[#E2E6EC] transition-colors duration-150 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Nueva investigación</span>
                </button>

                <div className="relative flex items-center">
                  <Search className="absolute left-2.5 h-3.5 w-3.5 text-[#929BAA] pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={historyFilter}
                    onChange={(e) => setHistoryFilter(e.target.value)}
                    placeholder="Buscar investigaciones..."
                    className="w-full rounded-[4px] border border-[#262B33] bg-[#171A20] py-1.5 pl-8 pr-11 text-[12px] text-[#F0F2F5] placeholder-[#929BAA]/75 focus:border-[#3978F6] focus:outline-none transition-colors duration-150"
                  />
                  <span className="font-tech absolute right-2 rounded-[4px] border border-[#262B33] bg-[#0D0F12] px-1.5 py-0.5 text-[10px] text-[#929BAA] pointer-events-none">
                    ⌘K
                  </span>
                </div>
              </div>

              {/* Navegación Agrupada por Categorías (Inteligencia, Exposición, Sistema) */}
              <nav className="px-2.5 py-2.5 space-y-3 border-b border-[#262B33]">
                {NAV_GROUPS.map((group) => (
                  <div key={group.category} className="space-y-0.5">
                    <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#929BAA]/70">
                      {group.category}
                    </p>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeNav === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setActiveNav(item.id)}
                          title={item.subtitle}
                          className={`w-full flex items-center gap-2.5 rounded-[4px] border-l-2 px-2.5 py-1.5 text-left transition-colors duration-150 cursor-pointer ${
                            isActive
                              ? 'bg-[#171A20] border-l-[#3978F6] text-[#F0F2F5] font-medium'
                              : 'border-l-transparent text-[#929BAA] hover:bg-[#171A20]/60 hover:text-[#F0F2F5]'
                          }`}
                        >
                          <Icon
                            className={`h-3.5 w-3.5 shrink-0 ${
                              isActive ? 'text-[#3978F6]' : 'text-[#929BAA]'
                            }`}
                          />
                          <span className="text-[12.5px] truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </nav>

              {/* Historial Reciente con mayor protagonismo */}
              <div className="px-2.5 py-3 flex-1 overflow-y-auto space-y-3">
                <div className="px-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#929BAA]">
                    Historial reciente
                  </span>
                  <span className="font-tech text-[10px] text-[#929BAA]">
                    {filteredSessions.length}
                  </span>
                </div>

                {groupedSessions.length === 0 ? (
                  <p className="px-2 py-2 text-[11px] text-[#929BAA]">
                    Sin investigaciones coincidentes.
                  </p>
                ) : (
                  groupedSessions.map((group) => (
                    <div key={group.label} className="space-y-0.5">
                      <p className="px-2 pb-0.5 text-[10px] font-medium text-[#929BAA]/65">
                        {group.label}
                      </p>
                      {group.items.map((sess) => {
                        const selected =
                          activeNav === 'preguntar' && sess.id === currentSessionId;
                        return (
                          <div
                            key={sess.id}
                            onClick={() => {
                              setCurrentSessionId(sess.id);
                              setActiveNav('preguntar');
                            }}
                            className={`group flex items-center justify-between gap-2 rounded-[4px] px-2.5 py-1.5 cursor-pointer transition-colors duration-150 ${
                              selected
                                ? 'bg-[#171A20] text-[#F0F2F5]'
                                : 'text-[#929BAA] hover:bg-[#171A20]/60 hover:text-[#F0F2F5]'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-medium leading-snug truncate">
                                {sess.title}
                              </p>
                              <p className="font-tech text-[10px] text-[#929BAA]/75">
                                {formatRelativeTimestamp(sess.updatedAt)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => deleteSession(e, sess.id)}
                              title="Eliminar investigación"
                              className="opacity-0 group-hover:opacity-100 text-[#929BAA] hover:text-[#F0F2F5] transition-opacity duration-150 shrink-0"
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

        {/* Footer Discreto */}
        <div className="p-3 border-t border-[#262B33] bg-[#111318] flex items-center justify-between text-[11px]">
          {sidebarCollapsed ? (
            <div
              className="mx-auto h-2 w-2 rounded-full bg-[#3978F6]"
              title="Modo Defensivo · RNF1"
            />
          ) : (
            <>
              <div className="flex items-center gap-2 text-[#929BAA]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#3978F6]" />
                <span>Sesión local</span>
              </div>
              <span className="text-[10.5px] text-[#929BAA]">Modo Defensivo · RNF1</span>
            </>
          )}
        </div>
      </aside>

      {/* Panel Principal (#0D0F12) */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0D0F12]">
        {/* Header Funcional con Breadcrumb, Indicadores de Contexto y Exportar */}
        <header className="h-12 shrink-0 border-b border-[#262B33] bg-[#0D0F12] px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0 text-[12.5px]">
            <span className="font-semibold tracking-wide text-[#F0F2F5]">OMEGA</span>
            <span className="text-[#929BAA]">/</span>
            <span className="font-medium text-[#F0F2F5] truncate">
              {currentNavMeta?.headerLabel || currentNavMeta?.label}
            </span>
            <span className="hidden sm:inline-block h-3.5 w-px bg-[#262B33] mx-1" />
            <div className="hidden sm:flex items-center gap-1.5 text-[11.5px] text-[#929BAA]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3978F6]" />
              <span>Sistema operativo</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Indicadores de Contexto separados por divisores con tooltip */}
            <div className="hidden lg:flex items-center rounded-[5px] border border-[#262B33] bg-[#171A20] divide-x divide-[#262B33]">
              <ContextStatPill
                value={corpusSummary.reports}
                label="reportes"
                tooltip="Publicaciones técnicas verificadas (Citizen Lab, Amnesty Tech y Google TAG) indexadas con hash SHA-256."
              />
              <ContextStatPill
                value={corpusSummary.chunks}
                label="fragmentos"
                tooltip="Pasajes paginados indexados en pgvector + índice léxico GIN para búsqueda híbrida RRF con citas exactas."
              />
              <ContextStatPill
                value={corpusSummary.iocs.toLocaleString()}
                label="IOCs"
                tooltip="Indicadores normalizados (dominios, hashes, IPs y artefactos MVT) listos para correlación forense."
              />
            </div>

            {activeNav === 'preguntar' && (
              <button
                type="button"
                onClick={handleExportSession}
                disabled={messages.length === 0}
                className="inline-flex items-center gap-1.5 rounded-[5px] border border-[#262B33] bg-[#171A20] px-3 py-1.5 text-[12px] font-medium text-[#F0F2F5] hover:border-[#3978F6]/60 hover:bg-[#1B1F27] disabled:opacity-40 disabled:pointer-events-none transition-colors duration-150 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-[#F0F2F5]" />
                <span>Exportar sesión</span>
              </button>
            )}
          </div>
        </header>

        {/* Contenido Dinámico por Módulo */}
        {activeNav === 'preguntar' ? (
          <main className="flex-1 flex flex-col min-h-0">
            {messages.length === 0 ? (
              /* Home Analítico: Composición de Inteligencia */
              <div className="flex-1 overflow-y-auto px-8 py-9">
                <div className="mx-auto w-full max-w-[920px] space-y-7">
                  {/* Encabezado contextual */}
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#3978F6]">
                      THREAT INTELLIGENCE PLATFORM
                    </p>
                    <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[#F0F2F5]">
                      ¿Qué necesitas investigar?
                    </h1>
                    <p className="text-[14px] leading-relaxed text-[#929BAA] max-w-[660px]">
                      Investiga vulnerabilidades, campañas y actores de amenazas a partir de fuentes documentadas.
                    </p>
                  </div>

                  {/* Input Protagonista */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSend();
                    }}
                    className={`rounded-[6px] border bg-[#171A20] transition-colors duration-150 ${
                      isTyping
                        ? 'border-[#3978F6]/70 focus-within:border-[#3978F6]'
                        : 'border-[#262B33] focus-within:border-[#3978F6]'
                    }`}
                  >
                    <textarea
                      rows={3}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Describe una amenaza, indicador, CVE o campaña..."
                      className="min-h-[96px] w-full resize-none bg-transparent px-4 pt-4 pb-2.5 text-[14.5px] leading-relaxed text-[#F0F2F5] placeholder-[#929BAA]/80 focus:outline-none"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#262B33] bg-[#13161B] px-3.5 py-2.5 rounded-b-[5px]">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#262B33] bg-[#171A20] px-2.5 py-1 text-[11.5px] font-medium text-[#F0F2F5]">
                          <ShieldCheck className="h-3.5 w-3.5 text-[#3978F6]" />
                          <span>Citas obligatorias</span>
                        </span>

                        <span className="h-3.5 w-px bg-[#262B33]" />

                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-[#929BAA]">Alcance</span>
                          <select
                            value={topK}
                            onChange={(e) => setTopK(Number(e.target.value))}
                            aria-label="Cantidad de fuentes a recuperar"
                            className="rounded-[4px] border border-[#262B33] bg-[#171A20] px-2 py-1 text-[11.5px] text-[#F0F2F5] focus:border-[#3978F6] focus:outline-none cursor-pointer"
                          >
                            <option value={4}>4 fuentes</option>
                            <option value={6}>6 fuentes</option>
                            <option value={10}>10 fuentes</option>
                          </select>
                        </div>

                        <span className="hidden md:inline-block h-3.5 w-px bg-[#262B33]" />
                        <span className="hidden md:inline text-[11px] text-[#929BAA]">
                          Recuperación Híbrida RRF
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="hidden sm:inline text-[11px] text-[#929BAA]">
                          {isTyping
                            ? 'Enter para investigar'
                            : 'Shift+Enter nueva línea'}
                        </span>
                        <button
                          type="submit"
                          disabled={loadingChat || !isTyping}
                          aria-label="Ejecutar investigación"
                          className={`inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3.5 text-[12px] font-medium transition-colors duration-150 cursor-pointer ${
                            isTyping && !loadingChat
                              ? 'bg-[#3978F6] text-[#F0F2F5] hover:bg-[#2F69DE]'
                              : 'bg-[#262B33] text-[#929BAA] cursor-not-allowed'
                          }`}
                        >
                          <span>Investigar</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </form>

                  {/* Investigaciones sugeridas */}
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#929BAA]">
                        Investigaciones sugeridas
                      </h2>
                      <button
                        type="button"
                        onClick={() => setActiveNav('amenazas')}
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-[#3978F6] hover:text-[#F0F2F5] transition-colors duration-150 cursor-pointer"
                      >
                        <span>Ver todas</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="grid gap-3.5 md:grid-cols-3">
                      {STARTER_CARDS.map((card) => {
                        const CardIcon = card.icon;
                        return (
                          <button
                            key={card.title}
                            type="button"
                            onClick={() => handleSend(card.prompt)}
                            className="group flex flex-col justify-between rounded-[6px] border border-[#262B33] bg-[#171A20] p-4 text-left hover:border-[#3978F6]/60 hover:bg-[#1B1F27] transition-colors duration-150 cursor-pointer space-y-3"
                          >
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#929BAA]">
                                  <CardIcon className="h-3.5 w-3.5 text-[#3978F6]" />
                                  <span>{card.category}</span>
                                </span>
                                <ArrowRight className="h-3.5 w-3.5 text-[#929BAA] opacity-0 group-hover:opacity-100 group-hover:text-[#3978F6] transition-all duration-150" />
                              </div>

                              <h3 className="text-[13.5px] font-semibold text-[#F0F2F5]">
                                {card.title}
                              </h3>

                              <p className="text-[12.5px] leading-relaxed text-[#929BAA]">
                                {card.description}
                              </p>
                            </div>

                            <div className="pt-2.5 border-t border-[#262B33] w-full flex items-center justify-between gap-2">
                              <span className="font-tech text-[11px] text-[#929BAA] truncate">
                                {card.example}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  {/* Actividad Reciente */}
                  {recentHomeActivity.length > 0 && (
                    <section className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#929BAA]">
                          Actividad reciente
                        </h2>
                        <span className="text-[11px] text-[#929BAA]">
                          Últimas investigaciones registradas
                        </span>
                      </div>

                      <div className="rounded-[6px] border border-[#262B33] bg-[#171A20] divide-y divide-[#262B33]">
                        {recentHomeActivity.map((sess) => {
                          const lastAssistant = [...(sess.messages || [])]
                            .reverse()
                            .find((m) => m.role === 'assistant');
                          const citCount = lastAssistant?.citations?.length || 0;
                          return (
                            <button
                              key={sess.id}
                              type="button"
                              onClick={() => {
                                setCurrentSessionId(sess.id);
                                setActiveNav('preguntar');
                              }}
                              className="group w-full px-4 py-3 flex items-center justify-between gap-4 text-left hover:bg-[#1B1F27] transition-colors duration-150 cursor-pointer"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <Clock className="h-3.5 w-3.5 text-[#929BAA] group-hover:text-[#3978F6] shrink-0 transition-colors duration-150" />
                                <div className="min-w-0">
                                  <p className="text-[13px] font-medium text-[#F0F2F5] truncate">
                                    {sess.title}
                                  </p>
                                  <p className="text-[11px] text-[#929BAA]">
                                    {citCount > 0
                                      ? `${citCount} fuentes documentales verificadas`
                                      : 'Sesión de análisis CTI'}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2.5 shrink-0">
                                <span className="font-tech text-[11px] text-[#929BAA]">
                                  {formatRelativeTimestamp(sess.updatedAt)}
                                </span>
                                <ChevronRight className="h-3.5 w-3.5 text-[#929BAA] group-hover:text-[#F0F2F5] transition-colors duration-150" />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </div>
              </div>
            ) : (
              /* Estado B: Workspace Activo de Investigación (Dossier Analítico) */
              <>
                <div className="flex-1 overflow-y-auto px-6 py-7">
                  <div className="mx-auto max-w-[920px] space-y-6">
                    {messages.map((msg, idx) =>
                      msg.role === 'user' ? (
                        <div
                          key={idx}
                          className="rounded-[6px] border border-[#262B33] bg-[#171A20] px-4 py-3.5 space-y-1.5"
                        >
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold uppercase tracking-wider text-[#929BAA]">
                              Consulta del analista
                            </span>
                            {msg.createdAt && (
                              <span className="font-tech text-[#929BAA]">
                                {formatRelativeTimestamp(msg.createdAt)}
                              </span>
                            )}
                          </div>
                          <div className="text-[14px] text-[#F0F2F5] whitespace-pre-wrap">
                            {msg.content}
                          </div>
                        </div>
                      ) : (
                        <InvestigationDossier
                          key={idx}
                          message={msg}
                          onSelectCitation={setSelectedCitation}
                          onNavigateToCampaigns={() => setActiveNav('amenazas')}
                        />
                      )
                    )}

                    {loadingChat && (
                      <div className="rounded-[6px] border border-[#262B33] border-l-2 border-l-[#3978F6] bg-[#171A20] p-4 space-y-1">
                        <p className="text-[12.5px] font-medium text-[#F0F2F5]">
                          Ejecutando búsqueda híbrida y correlación en base CTI...
                        </p>
                        <p className="text-[12px] text-[#929BAA]">
                          Recuperando fragmentos verificables, extrayendo CVEs e indicadores vinculados.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Composer Inferior Fijo */}
                <div className="shrink-0 border-t border-[#262B33] bg-[#0D0F12] px-6 py-3.5">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSend();
                    }}
                    className="mx-auto max-w-[920px] flex items-center gap-3 rounded-[6px] border border-[#262B33] bg-[#171A20] px-3.5 py-2 focus-within:border-[#3978F6] transition-colors duration-150"
                  >
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Profundiza en indicadores, actores o evidencias de esta investigación..."
                      className="flex-1 bg-transparent text-[13.5px] text-[#F0F2F5] placeholder-[#929BAA]/80 focus:outline-none"
                    />
                    <span className="hidden sm:inline text-[11px] text-[#929BAA]">
                      Enter ↵
                    </span>
                    <button
                      type="submit"
                      disabled={loadingChat || !isTyping}
                      aria-label="Enviar seguimiento"
                      className={`inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-[12px] font-medium transition-colors duration-150 cursor-pointer ${
                        isTyping && !loadingChat
                          ? 'bg-[#3978F6] text-[#F0F2F5] hover:bg-[#2F69DE]'
                          : 'bg-[#262B33] text-[#929BAA] cursor-not-allowed'
                      }`}
                    >
                      <span>Investigar</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </form>
                </div>
              </>
            )}
          </main>
        ) : (
          <main className="flex-1 overflow-y-auto px-8 py-8">
            <div className="mx-auto max-w-[960px]">
              {activeNav === 'amenazas' && (
                <CampaignsPanel onAskInChat={handleAskCampaignInChat} />
              )}
              {activeNav === 'equipo' && <MvtVerifierPanel />}
              {activeNav === 'exposicion' && <OsintPanel />}
              {activeNav === 'enlace' && <LinkVerifierPanel />}
              {activeNav === 'ajustes' && (
                <SettingsPanel topK={topK} onChangeTopK={setTopK} />
              )}
            </div>
          </main>
        )}
      </div>

      <CitationDrawer
        citation={selectedCitation}
        onClose={() => setSelectedCitation(null)}
      />
    </div>
  );
}
