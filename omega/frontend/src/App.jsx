import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  ChevronDown,
  BookOpen,
  Gauge,
  Sparkles,
  UserCheck,
  Bell,
  KeyRound,
} from 'lucide-react';
import {
  fetchApiHealth,
  fetchSystemGovernance,
  fetchCurrentPrincipal,
  sendChatQuery,
  analyzePcLiveSnapshot,
  syncStixFeeds,
  getAuthSession,
  clearAuthSession,
  ensurePersonalWorkspace,
  listExpedienteDocuments,
  uploadExpedientePdf,
} from './lib/api';
import { ChatAtmosphere } from './components/ChatAtmosphere';
import { OmegaAuthBackdrop } from './components/OmegaAuthBackdrop';
import { OmegaLogo } from './components/OmegaLogo';
import { SpatialNavPill } from './components/SpatialNavPill';
import { SecurityPostureStage } from './components/SecurityPostureStage';
import { CopilotDrawer } from './components/CopilotDrawer';
import { ChatWorkspace } from './components/ChatWorkspace';
import { CampaignsPanel } from './components/CampaignsPanel';
import { MvtVerifierPanel } from './components/MvtVerifierPanel';
import { OsintPanel } from './components/OsintPanel';
import { LinkVerifierPanel } from './components/LinkVerifierPanel';
import { AuthModulePanel } from './components/AuthModulePanel';
import { SettingsPanel } from './components/SettingsPanel';
import { AuthModal } from './components/AuthModal';
import { sanitizeSearchInput, validateChatMessage, validateUploadFile } from './lib/validators';

const NAV_ITEMS = [
  { id: 'inicio', label: 'Inicio', subtitle: 'Estado en vivo y escudos', icon: Gauge },
  { id: 'equipo', label: 'Equipos', subtitle: 'PC Windows, Android e iPhone', icon: Laptop },
  { id: 'enlace', label: 'Enlaces', subtitle: 'Verificar antes de abrir', icon: Link2 },
  { id: 'amenazas', label: 'Amenazas', subtitle: 'Campañas, CVEs y actores', icon: Layers },
  { id: 'exposicion', label: 'Exposición', subtitle: 'Huella pública y OSINT', icon: Radar },
  { id: 'preguntar', label: 'Asistente', subtitle: 'Consultas con citas', icon: MessageSquare },
  { id: 'cuenta', label: 'Cuenta', subtitle: 'Registro, sesión y PDFs privados', icon: UserCheck },
  { id: 'ajustes', label: 'Ajustes', subtitle: 'Motor RAG, cuenta y permisos', icon: Settings },
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
      context: { family: 'Pegasus (NSO Group)', os: 'iOS', cve: 'CVE-2021-30860' },
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
      context: { family: 'Predator (Intellexa)', os: null, cve: null },
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

function formatClockTime(date = new Date()) {
  try {
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'ahora';
  }
}

export default function App() {
  const [activeNav, setActiveNav] = useState('inicio');
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [technicalMode, setTechnicalMode] = useState(false);
  const [apiOnline, setApiOnline] = useState(true);
  const [govStats, setGovStats] = useState(null);
  const [usbStatus, setUsbStatus] = useState({
    android: { connected: false },
    ios: { connected: false },
  });
  const [pcAudit, setPcAudit] = useState(null);
  const [pcScannedAt, setPcScannedAt] = useState('');
  const [lastLinkResult, setLastLinkResult] = useState(null);
  const [deviceInitialTab, setDeviceInitialTab] = useState('android');
  const [deviceNavKey, setDeviceNavKey] = useState(0);
  const [linkJump, setLinkJump] = useState({ url: '', key: 0 });
  const [threatJump, setThreatJump] = useState({ query: '', key: 0 });
  const [osintJump, setOsintJump] = useState({ value: '', type: 'domain', key: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState('windows');
  const [scanningPc, setScanningPc] = useState(false);
  const [syncingStix, setSyncingStix] = useState(false);
  const [stageFeedback, setStageFeedback] = useState(null);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [pinnedCopilotContext, setPinnedCopilotContext] = useState('');
  const [sessionsMenuOpen, setSessionsMenuOpen] = useState(false);
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
  const [draftContext, setDraftContext] = useState(null);

  const [authSession, setAuthSession] = useState(() => getAuthSession());
  const [verifyingSession, setVerifyingSession] = useState(() => Boolean(getAuthSession()?.accessToken));
  const [authGateReason, setAuthGateReason] = useState('');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalReason, setAuthModalReason] = useState('');
  const [activeExpedienteId, setActiveExpedienteId] = useState('');
  const [usePrivateDocs, setUsePrivateDocs] = useState(false);
  const [expedienteDocs, setExpedienteDocs] = useState([]);
  const [loadingExpedientes, setLoadingExpedientes] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [expedienteNotice, setExpedienteNotice] = useState('');
  const [expedienteError, setExpedienteError] = useState('');

  const textareaRef = useRef(null);
  const sendLockRef = useRef(false);

  const openAuthModal = useCallback((reason = '') => {
    setAuthModalReason(reason || '');
    setAuthModalOpen(true);
  }, []);

  const handleLogout = useCallback(() => {
    clearAuthSession();
    setAuthSession(null);
    setVerifyingSession(false);
    setAuthGateReason('');
    setActiveNav('inicio');
    setIsCopilotOpen(false);
    setCommandOpen(false);
    setSessionsMenuOpen(false);
    setAuthModalOpen(false);
    setSelectedCitation(null);
    setIsSourcesPanelOpen(false);
    setCurrentSessionId(null);
    setDraftContext(null);
    setPcAudit(null);
    setPcScannedAt('');
    setLastLinkResult(null);
    setStageFeedback(null);
    setActiveExpedienteId('');
    setUsePrivateDocs(false);
    setExpedienteDocs([]);
    setGovStats(null);
    setExpedienteNotice('');
    setExpedienteError('');
  }, []);

  const refreshSystemTelemetry = useCallback(async () => {
    try {
      const hasSession = Boolean(getAuthSession()?.accessToken);
      const [health, gov] = await Promise.all([
        fetchApiHealth(),
        hasSession ? fetchSystemGovernance().catch(() => null) : Promise.resolve(null),
      ]);
      setApiOnline(Boolean(health && health.status === 'ok'));
      if (gov) setGovStats(gov);
      else if (!hasSession) setGovStats(null);
    } catch {
      setApiOnline(false);
    }
  }, []);

  const refreshPrivateWorkspace = useCallback(async () => {
    if (!getAuthSession()?.accessToken) {
      setActiveExpedienteId('');
      setUsePrivateDocs(false);
      setExpedienteDocs([]);
      return null;
    }
    setLoadingExpedientes(true);
    try {
      const workspace = await ensurePersonalWorkspace();
      const workspaceId = workspace?.id || '';
      setActiveExpedienteId(workspaceId);
      return workspaceId;
    } catch (err) {
      setExpedienteError(err?.message || 'No se pudo sincronizar tu biblioteca privada.');
      return null;
    } finally {
      setLoadingExpedientes(false);
    }
  }, []);

  const refreshActiveExpedienteDocs = useCallback(async (targetId = activeExpedienteId) => {
    if (!targetId || !getAuthSession()?.accessToken) {
      setExpedienteDocs([]);
      return;
    }
    setLoadingExpedientes(true);
    try {
      const docs = await listExpedienteDocuments(targetId);
      setExpedienteDocs(Array.isArray(docs) ? docs : []);
    } catch (err) {
      setExpedienteError(err?.message || 'No se pudo consultar la lista de documentos.');
    } finally {
      setLoadingExpedientes(false);
    }
  }, [activeExpedienteId]);

  useEffect(() => {
    if (!verifyingSession) return undefined;
    let cancelled = false;
    fetchCurrentPrincipal()
      .then((me) => {
        if (cancelled) return;
        if (me?.role || me?.tenantId) {
          setAuthSession((prev) => (prev ? { ...prev, role: me.role || prev.role, tenantId: me.tenantId || prev.tenantId } : prev));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.requiresAuth || err?.status === 401 || err?.status === 403) {
          clearAuthSession();
          setAuthSession(null);
          setAuthGateReason('Tu sesión expiró o no es válida. Inicia sesión para continuar.');
        }
      })
      .finally(() => {
        if (!cancelled) setVerifyingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [verifyingSession]);

  useEffect(() => {
    const onAuthChanged = (e) => {
      const next = e?.detail ?? getAuthSession();
      setAuthSession(next);
      if (next?.accessToken) {
        setAuthGateReason('');
      } else {
        setIsCopilotOpen(false);
        setCommandOpen(false);
        setAuthModalOpen(false);
        setActiveExpedienteId('');
        setUsePrivateDocs(false);
        setExpedienteDocs([]);
        setGovStats(null);
      }
    };
    const onAuthRequired = () => {
      const reason = 'Tu sesión expiró. Inicia sesión para continuar.';
      setAuthGateReason(reason);
      setAuthModalReason(reason);
      if (!getAuthSession()?.accessToken) {
        setAuthModalOpen(false);
      }
    };
    window.addEventListener('omega:auth-changed', onAuthChanged);
    window.addEventListener('omega:auth-required', onAuthRequired);
    return () => {
      window.removeEventListener('omega:auth-changed', onAuthChanged);
      window.removeEventListener('omega:auth-required', onAuthRequired);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshSystemTelemetry();
      if (authSession?.accessToken) {
        void refreshPrivateWorkspace();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [authSession?.accessToken, refreshSystemTelemetry, refreshPrivateWorkspace]);

  useEffect(() => {
    if (!activeExpedienteId || !authSession?.accessToken) return undefined;
    const timer = setTimeout(() => {
      void refreshActiveExpedienteDocs(activeExpedienteId);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeExpedienteId, authSession?.accessToken, refreshActiveExpedienteDocs]);

  useEffect(() => {
    const hasPending = expedienteDocs.some(
      (d) => d.status === 'PENDING' || d.status === 'PROCESSING',
    );
    if (!hasPending || !activeExpedienteId || !authSession?.accessToken) return undefined;
    const timer = setInterval(() => {
      void listExpedienteDocuments(activeExpedienteId)
        .then((docs) => {
          const next = Array.isArray(docs) ? docs : [];
          setExpedienteDocs(next);
          if (!next.some((d) => d.status === 'PENDING' || d.status === 'PROCESSING')) {
            void refreshSystemTelemetry();
          }
        })
        .catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
  }, [expedienteDocs, activeExpedienteId, authSession?.accessToken, refreshSystemTelemetry]);

  async function handleUploadExpedientePdf(file) {
    if (!file || uploadingPdf) return;
    const fileCheck = validateUploadFile(file, {
      extensions: ['.pdf'],
      maxBytes: 25 * 1024 * 1024,
      label: 'PDF',
    });
    if (!fileCheck.valid) {
      setExpedienteNotice('');
      setExpedienteError(fileCheck.error);
      return;
    }
    setUploadingPdf(true);
    setExpedienteError('');
    setExpedienteNotice('');
    try {
      let targetId = activeExpedienteId;
      if (!targetId) {
        targetId = await refreshPrivateWorkspace();
      }
      if (!targetId) {
        setExpedienteError('Inicia sesión para habilitar tu biblioteca privada de PDFs.');
        return;
      }
      const meta = await uploadExpedientePdf(targetId, file);
      await refreshActiveExpedienteDocs(targetId);
      setUsePrivateDocs(true);
      setExpedienteNotice(
        `PDF "${meta.originalFilename}" recibido (SHA-256 ${String(meta.sha256Hash || '').slice(0, 12)}…) · Custodia Zero-Retention en curso.`,
      );
      void refreshSystemTelemetry();
    } catch (err) {
      setExpedienteError(err?.message || 'No se pudo procesar el PDF.');
    } finally {
      setUploadingPdf(false);
    }
  }

  useEffect(() => {
    const initTimer = setTimeout(() => {
      void refreshSystemTelemetry();
    }, 0);
    const timer = setInterval(() => {
      void refreshSystemTelemetry();
    }, 15000);
    return () => {
      clearTimeout(initTimer);
      clearInterval(timer);
    };
  }, [refreshSystemTelemetry]);

  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.omegaDesktop : null;
    if (!bridge?.isDesktop || !authSession?.accessToken) return undefined;
    let cancelled = false;

    const pollUsb = async () => {
      try {
        let customPath = '';
        try {
          customPath = localStorage.getItem('omega_custom_adb_path') || '';
        } catch {
          customPath = '';
        }
        const [adb, ios] = await Promise.all([
          bridge.checkAdbStatus ? bridge.checkAdbStatus(customPath).catch(() => null) : null,
          bridge.checkIosStatus ? bridge.checkIosStatus().catch(() => null) : null,
        ]);
        if (cancelled) return;
        setUsbStatus({
          android: adb || { connected: false },
          ios: ios || { connected: false },
        });
      } catch {
        // Ignore transient bridge errors
      }
    };

    void pollUsb();
    const timer = setInterval(pollUsb, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [authSession?.accessToken]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.omegaDesktop?.setTitleBarTheme) {
      void window.omegaDesktop.setTitleBarTheme('dark');
    }
  }, [activeNav]);

  useEffect(() => {
    const persistable = sessions.map((s) => ({
      ...s,
      messages: (s.messages || []).map(({ animateTyping: _animate, ...rest }) => rest),
    }));
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(persistable));
  }, [sessions]);

  useEffect(() => {
    if (!authSession?.accessToken) return undefined;
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
        setCommandQuery('');
        setSessionsMenuOpen(false);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setIsCopilotOpen((prev) => !prev);
        setSessionsMenuOpen(false);
      } else if (e.key === 'Escape') {
        setCommandOpen(false);
        setSessionsMenuOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [authSession?.accessToken]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId) || null,
    [sessions, currentSessionId]
  );

  const messages = useMemo(() => activeSession?.messages || [], [activeSession]);

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

  const activeChatContext = activeSession ? (activeSession.context ?? null) : draftContext;

  function startNewInvestigation() {
    setCurrentSessionId(null);
    setDraftContext(null);
    setSelectedCitation(null);
    setIsSourcesPanelOpen(false);
    setActiveNav('preguntar');
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function handleUpdateChatContext(nextCtx) {
    if (currentSessionId) {
      setSessions((prev) =>
        prev.map((s) => (s.id === currentSessionId ? { ...s, context: nextCtx } : s)),
      );
    } else {
      setDraftContext(nextCtx);
    }
  }

  function handleClearChatContext() {
    const cleared = { family: null, os: null, cve: null };
    if (currentSessionId) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === currentSessionId ? { ...s, context: cleared, lastRewrittenQuery: null } : s,
        ),
      );
    } else {
      setDraftContext(cleared);
    }
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
    if (!getAuthSession()?.accessToken) {
      setAuthSession(null);
      return;
    }
    const chatCheck = validateChatMessage(rawPrompt || '');
    const query = chatCheck.value;
    if (!chatCheck.valid || loadingChat || sendLockRef.current) return;
    sendLockRef.current = true;
    setTimeout(() => {
      sendLockRef.current = false;
    }, 600);

    const { forceNewSession = false } = options;
    const effectiveScope = requestedScope || 'Todas las fuentes';
    const targetSession =
      !forceNewSession && currentSessionId
        ? sessions.find((s) => s.id === currentSessionId)
        : null;
    const pinnedContextPayload = forceNewSession
      ? null
      : (targetSession ? (targetSession.context ?? null) : draftContext);
    if (forceNewSession) setDraftContext(null);

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
        context: pinnedContextPayload,
        lastRewrittenQuery: null,
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
      const res = await sendChatQuery(
        query,
        historyPayload,
        topK,
        effectiveScope,
        pinnedContextPayload,
        { expedienteId: usePrivateDocs && activeExpedienteId ? activeExpedienteId : null },
      );
      const latency = ((performance.now() - t0) / 1000).toFixed(2);
      const assistantTurn = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: res.answer,
        citations: res.citations || [],
        warnings: res.warnings || [],
        reindexRequiredDocuments: res.reindexRequiredDocuments || [],
        model: res.model,
        analysis: res.analysis,
        standaloneQuery: res.rewritten_query || res.standalone_query,
        sourceScope: effectiveScope,
        latency,
        animateTyping: true,
      };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? {
                ...s,
                updatedAt: new Date().toISOString(),
                context: res.resolved_context || s.context || null,
                lastRewrittenQuery: res.rewritten_query || res.standalone_query || null,
                messages: [...s.messages, assistantTurn],
              }
            : s
        )
      );
    } catch (err) {
      const errorTurn = {
        role: 'assistant',
        isError: true,
        retryQuery: query,
        sourceScope: effectiveScope,
        content: err?.message || 'No fue posible conectar con el motor RAG de OMEGA.',
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

  function handleNavigate(navId, opts = {}) {
    if (!getAuthSession()?.accessToken) {
      setAuthSession(null);
      return;
    }
    if (opts?.tab) {
      setDeviceInitialTab(opts.tab);
      setDeviceNavKey((k) => k + 1);
    }
    if (opts?.url) {
      setLinkJump((prev) => ({ url: opts.url, key: prev.key + 1 }));
    }
    if (opts?.campaignQuery) {
      setThreatJump((prev) => ({ query: opts.campaignQuery, key: prev.key + 1 }));
    }
    if (opts?.assetValue) {
      setOsintJump((prev) => ({
        value: opts.assetValue,
        type: opts.assetType || 'domain',
        key: prev.key + 1,
      }));
    }
    setSessionsMenuOpen(false);
    setActiveNav(navId);
  }

  function handlePcAuditComplete(analysis) {
    setPcAudit(analysis);
    setPcScannedAt(formatClockTime());
  }

  async function handleRunPcScan() {
    const bridge = typeof window !== 'undefined' ? window.omegaDesktop : null;
    if (scanningPc) return;
    if (!bridge?.collectPcAuditSnapshot) {
      handleNavigate('equipo', { tab: 'pc' });
      return;
    }
    setScanningPc(true);
    setStageFeedback(null);
    try {
      const col = await bridge.collectPcAuditSnapshot();
      if (col?.ok && col.snapshot) {
        const analysis = await analyzePcLiveSnapshot(col.snapshot);
        handlePcAuditComplete(analysis);
        const signals =
          Number(analysis?.triage?.total_matches ?? analysis?.high_findings ?? 0) +
          Number(analysis?.yara_hits?.length ?? 0) +
          Number(analysis?.behavioral_anomalies?.length ?? 0);
        setStageFeedback({
          tone: signals > 0 ? 'alert' : 'clean',
          message:
            signals > 0
              ? `Auditoría de esta PC en RAM finalizada: ${signals} señal(es) requieren revisión.`
              : 'Auditoría de esta PC en RAM finalizada: sin señales de spyware (0 bytes en disco).',
          actionLabel: 'Ver informe',
          actionNav: 'equipo',
        });
      } else {
        setStageFeedback({
          tone: 'alert',
          message: col?.error || 'No se pudo capturar la instantánea de esta PC; revisa desde el inspector.',
        });
        handleNavigate('equipo', { tab: 'pc' });
      }
    } catch (err) {
      setStageFeedback({
        tone: 'alert',
        message: err?.message || 'Error ejecutando la auditoría en RAM de esta PC.',
      });
    } finally {
      setScanningPc(false);
    }
  }

  async function handleSyncStix() {
    if (syncingStix) return;
    setSyncingStix(true);
    setStageFeedback(null);
    try {
      await syncStixFeeds();
      await refreshSystemTelemetry();
      setStageFeedback({
        tone: 'clean',
        message: 'Firmas STIX 2.1 sincronizadas y telemetría actualizada en memoria.',
      });
    } catch (err) {
      setStageFeedback({
        tone: 'alert',
        message: err?.message || 'No se pudieron sincronizar los feeds STIX 2.1; verifica el backend.',
      });
    } finally {
      setSyncingStix(false);
    }
  }

  function handleLinkVerified(res) {
    setLastLinkResult(res);
  }

  function handleOpenCopilot(opts = {}) {
    if (opts?.pinnedContext) {
      setPinnedCopilotContext(opts.pinnedContext);
    }
    setSessionsMenuOpen(false);
    setIsCopilotOpen(true);
    if (opts?.prompt) {
      setSelectedCitation(null);
      setSourceScope('Todas las fuentes');
      handleSend(opts.prompt, 'Todas las fuentes', {
        forceNewSession: Boolean(opts.forceNewSession || !currentSessionId),
      });
    }
  }

  function askInChat(promptText, opts = {}) {
    const cleanPrompt = String(promptText || '').trim();
    if (!cleanPrompt) return;
    const firstLine = cleanPrompt
      .split('\n')[0]
      .replace(/^[#*\-\s]+/, '')
      .slice(0, 72);
    setSelectedCitation(null);
    setIsSourcesPanelOpen(false);
    setSourceScope('Todas las fuentes');

    if (opts?.fullPage) {
      setActiveNav('preguntar');
      setIsCopilotOpen(false);
    } else {
      setPinnedCopilotContext(opts?.pinnedContext || firstLine);
      setIsCopilotOpen(true);
    }
    handleSend(cleanPrompt, 'Todas las fuentes', { forceNewSession: true });
  }

  const isDesktop = typeof window !== 'undefined' && Boolean(window.omegaDesktop?.isDesktop);
  const isSignedIn = Boolean(authSession?.accessToken);
  const activeNavItem = NAV_ITEMS.find((n) => n.id === activeNav) || NAV_ITEMS[0];
  const reportsCount = Number(govStats?.corpus_stats?.reports ?? 26);
  const usbConnected = Boolean(usbStatus?.android?.connected || usbStatus?.ios?.connected);
  const pcRawVerdict = pcAudit?.triage?.diagnosis?.verdict_code || pcAudit?.verdict;
  const pcVerdict = pcRawVerdict ? String(pcRawVerdict).toLowerCase() : null;
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const drawerFailedPrompt = lastMsg?.isError ? lastMsg.retryQuery : '';
  const isHome = activeNav === 'inicio';

  if (verifyingSession) {
    return (
      <div className="roam-obsidian-sheet relative h-screen w-screen overflow-hidden flex flex-col items-center justify-center bg-[#0A0A0C] text-[#F2F2F4] select-none">
        <OmegaAuthBackdrop />
        <div className="relative z-10 flex flex-col items-center gap-3 motion-safe:animate-scale-in">
          <OmegaLogo size={54} isThinking framed />
          <span className="font-tech text-[11px] uppercase tracking-[0.12em] text-[#9A9AA2] motion-safe:animate-pulse">
            Verificando sesión...
          </span>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="roam-obsidian-sheet relative h-screen w-screen overflow-hidden flex flex-col bg-[#0A0A0C] text-[#F2F2F4]">
        <OmegaAuthBackdrop />
        {isDesktop && (
          <header
            aria-label="Barra superior de acceso OMEGA"
            className="titlebar-drag motion-safe:animate-fade-in absolute top-0 left-0 right-0 z-20 h-[48px] px-4 flex items-center justify-between select-none [&_button]:[-webkit-app-region:no-drag]"
          >
            <div className="inline-flex items-center gap-2">
              <OmegaLogo size={20} />
              <span className="font-display text-[13px] font-semibold tracking-[0.06em] text-[#F2F2F4]">
                OMEGA
              </span>
            </div>
            <div className="sm:mr-36" />
          </header>
        )}
        <AuthModulePanel
          gateMode
          authSession={null}
          apiOnline={apiOnline}
          reasonMessage={authGateReason}
          onAuthenticated={(session) => {
            setAuthGateReason('');
            setVerifyingSession(false);
            setAuthSession(session);
            setActiveNav('inicio');
            void refreshSystemTelemetry();
            void refreshPrivateWorkspace();
          }}
        />
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden flex flex-col bg-[#0A0A0C] text-[#F2F2F4] select-none">
      <main className="relative flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden select-text">
        {isHome ? (
          <SecurityPostureStage
            isDesktop={isDesktop}
            activeNav={activeNav}
            onSelectNav={(id) => handleNavigate(id)}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            pcAudit={pcAudit}
            pcScannedAt={pcScannedAt}
            usbStatus={usbStatus}
            lastLinkResult={lastLinkResult}
            govStats={govStats}
            technicalMode={technicalMode}
            onToggleTechnicalMode={setTechnicalMode}
            apiOnline={apiOnline}
            isLoadingChat={loadingChat}
            scanningPc={scanningPc}
            syncingStix={syncingStix}
            onRunPcScan={handleRunPcScan}
            onSyncStix={handleSyncStix}
            stageFeedback={stageFeedback}
            onDismissStageFeedback={() => setStageFeedback(null)}
            onOpenCopilot={handleOpenCopilot}
            onOpenCommandPalette={() => {
              setCommandOpen(true);
              setCommandQuery('');
            }}
            onNavigate={handleNavigate}
            onLinkVerified={handleLinkVerified}
            authSession={authSession}
          />
        ) : (
          <div className="roam-obsidian-sheet relative flex-1 min-h-0 flex flex-col overflow-hidden text-[#F2F2F4]">
            <ChatAtmosphere
              variant={activeNav === 'preguntar' && messages.length === 0 ? 'stage' : 'workspace'}
              showWaves={activeNav !== 'preguntar' || messages.length === 0}
              dimmed={activeNav === 'preguntar' && messages.length > 0}
            />

            {/* Barra Principal Unificada — Pill de navegación flotante separada (sin doble blur debajo) */}
            <header
              aria-label="Barra principal OMEGA"
              className={`relative z-20 min-h-[60px] h-[60px] shrink-0 px-3.5 sm:px-7 border-b border-white/[0.07] bg-[#0A0A0C]/55 flex items-center justify-between gap-2 select-none ${
                isDesktop
                  ? 'titlebar-drag [&_button]:[-webkit-app-region:no-drag] [&_input]:[-webkit-app-region:no-drag] [&_select]:[-webkit-app-region:no-drag] [&_a]:[-webkit-app-region:no-drag]'
                  : ''
              }`}
            >
              <div className="relative z-10 min-w-0 flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleNavigate('inicio')}
                  className="titlebar-no-drag inline-flex items-center gap-2 rounded-[10px] px-1.5 py-1 hover:bg-white/[0.06] transition-colors cursor-pointer"
                  title="Volver a Inicio"
                >
                  <OmegaLogo size={22} isThinking={loadingChat} />
                  <span className="font-display hidden sm:inline text-[14px] font-semibold tracking-[0.06em] text-[#F2F2F4]">
                    OMEGA
                  </span>
                </button>

                <span className="hidden lg:inline text-white/20 text-[12px]">/</span>
                <span className="hidden lg:inline text-[13px] font-medium text-[#F2F2F4] truncate max-w-[115px] xl:max-w-[145px]">
                  {activeNavItem.label}
                </span>
              </div>

              {/* Barra de navegación segmentada matemáticamente centrada */}
              <div className="titlebar-no-drag hidden md:flex items-center justify-center md:absolute md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 z-20">
                <SpatialNavPill
                  activeNav={activeNav}
                  onSelectNav={(id) => handleNavigate(id)}
                  pcVerdict={pcVerdict}
                  usbConnected={usbConnected}
                  apiOnline={apiOnline}
                  isLoadingChat={loadingChat}
                  authConnected={Boolean(authSession)}
                />
              </div>

              {/* Controles globales derechos unificados en todas las vistas */}
              <div className={`titlebar-no-drag relative z-10 flex items-center gap-1.5 shrink-0 ${isDesktop ? 'sm:mr-36' : ''}`}>
                <div
                  role="group"
                  aria-label="Nivel de detalle"
                  className="apple-segmented hidden sm:inline-flex items-center rounded-[9px] p-0.5 h-8"
                >
                  <button
                    type="button"
                    onClick={() => setTechnicalMode(false)}
                    className={`px-2 py-1 rounded-[6px] text-[11px] font-medium transition-all cursor-pointer ${
                      !technicalMode
                        ? 'apple-segmented-active'
                        : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                    }`}
                  >
                    Simple
                  </button>
                  <button
                    type="button"
                    onClick={() => setTechnicalMode(true)}
                    className={`px-2 py-1 rounded-[6px] text-[11px] font-medium transition-all cursor-pointer ${
                      technicalMode
                        ? 'apple-segmented-active'
                        : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                    }`}
                  >
                    Técnico
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setIsCopilotOpen((v) => !v)}
                  aria-label="Abrir o cerrar copiloto lateral"
                  title="Copiloto (Ctrl+J)"
                  className={`omega-glass-chip h-8 px-2 2xl:px-2.5 rounded-[9px] inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
                    isCopilotOpen
                      ? 'border-[#2F6FED]/55 bg-[rgba(28,36,56,0.65)] text-[#F2F2F4] shadow-[0_0_20px_rgba(47,111,237,0.22)]'
                      : 'text-[#F2F2F4]'
                  }`}
                >
                  <Bell className="h-3.5 w-3.5 text-[#2F6FED]" />
                  <span className="hidden 2xl:inline">Copiloto</span>
                  <span className="font-tech h-4 min-w-[16px] px-1 rounded-full bg-[#2F6FED] text-white text-[10px] font-bold inline-flex items-center justify-center">
                    {reportsCount}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCommandOpen(true);
                    setCommandQuery('');
                  }}
                  aria-label="Abrir búsqueda rápida (⌘K)"
                  title="Saltar a módulo o acción (⌘K)"
                  className="omega-glass-chip h-8 px-2 2xl:px-2.5 rounded-[9px] inline-flex items-center gap-1.5 text-[11.5px] text-[#9A9AA2] hover:text-[#F2F2F4] transition-colors cursor-pointer"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span className="font-tech hidden 2xl:inline">⌘K</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleNavigate('cuenta')}
                  title={
                    authSession
                      ? `Cuenta: ${authSession.email} (${authSession.role})`
                      : 'Iniciar sesión o crear cuenta OMEGA'
                  }
                  className={`omega-glass-chip h-8 px-2 xl:px-2.5 rounded-[9px] inline-flex items-center gap-1.5 text-[11.5px] font-medium transition-colors cursor-pointer ${
                    authSession
                      ? 'border-[#30D158]/35 text-[#F2F2F4]'
                      : 'border-[#2F6FED]/45 text-[#F2F2F4]'
                  }`}
                >
                  {authSession ? (
                    <>
                      <span className="h-2 w-2 rounded-full bg-[#30D158] shrink-0" />
                      <span className="hidden lg:inline max-w-[88px] truncate font-tech">
                        {authSession.email?.split('@')[0] || authSession.tenantSlug}
                      </span>
                    </>
                  ) : (
                    <>
                      <KeyRound className="h-3.5 w-3.5 text-[#2F6FED]" />
                      <span className="hidden lg:inline">Entrar</span>
                    </>
                  )}
                </button>
              </div>
            </header>

            {/* Sub-barra contextual de conversación cuando existen mensajes o historial */}
            {activeNav === 'preguntar' && (messages.length > 0 || sessions.length > 0) && (
              <header
                aria-label="Controles de sesión de chat"
                className="relative z-15 min-h-[42px] shrink-0 px-3.5 sm:px-7 py-1.5 border-b border-white/[0.07] bg-[#0A0A0C]/65 flex items-center justify-between gap-2 select-none"
              >
                <div className="relative min-w-0 flex-1 max-w-[210px] sm:max-w-[300px]">
                  <button
                    type="button"
                    onClick={() => setSessionsMenuOpen((v) => !v)}
                    className="h-7 w-full px-2 sm:px-2.5 rounded-[7px] border border-white/[0.08] bg-white/[0.04] hover:bg-[rgba(28,36,56,0.65)] flex items-center gap-1.5 text-[11.5px] text-[#F2F2F4] transition-colors cursor-pointer"
                  >
                    <MessageSquare className="h-3 w-3 text-[#2F6FED] shrink-0" />
                    <span className="truncate flex-1 text-left">
                      {activeSession?.title || 'Nueva consulta'}
                    </span>
                    <ChevronDown className="h-3 w-3 text-[#9A9AA2] shrink-0" />
                  </button>

                  {sessionsMenuOpen && (
                    <div className="apple-group animate-scale-in origin-top-left absolute left-0 mt-1.5 w-[min(300px,calc(100vw-1.75rem))] rounded-[13px] bg-[#141418]/96 p-1.5 z-50 space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSessionsMenuOpen(false);
                          startNewInvestigation();
                        }}
                        className="w-full flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-[12.5px] font-medium text-[#F2F2F4] hover:bg-[rgba(28,36,56,0.65)] transition-colors cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5 text-[#2F6FED]" />
                        <span>Nueva consulta limpia</span>
                      </button>

                      <div className="h-px bg-white/[0.08] my-1" />

                      <div className="max-h-[240px] overflow-y-auto space-y-0.5">
                        {sessions.map((sess) => {
                          const selected = sess.id === currentSessionId;
                          return (
                            <div
                              key={sess.id}
                              className={`group flex items-center justify-between gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[12px] ${
                                selected
                                  ? 'bg-[rgba(28,36,56,0.65)] text-[#F2F2F4]'
                                  : 'text-[#9A9AA2] hover:bg-white/[0.05] hover:text-[#F2F2F4]'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setCurrentSessionId(sess.id);
                                  setSelectedCitation(null);
                                  setSessionsMenuOpen(false);
                                }}
                                className="flex-1 min-w-0 text-left truncate cursor-pointer"
                              >
                                <span className="block truncate font-medium">{sess.title}</span>
                                <span className="font-tech text-[10.5px] text-[#9A9AA2]">
                                  {formatRelativeTime(sess.updatedAt)}
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={(e) => deleteSession(e, sess.id)}
                                title="Eliminar conversación"
                                aria-label="Eliminar conversación"
                                className="p-1 rounded-[6px] text-[#9A9AA2] hover:text-[#FF7A73] hover:bg-white/[0.08] cursor-pointer"
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

                <div className="flex items-center gap-1.5 shrink-0">
                  {messages.length > 0 && activeConversationCitations.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsSourcesPanelOpen((v) => !v)}
                      title={`Fuentes (${activeConversationCitations.length})`}
                      className={`h-7 px-2 sm:px-2.5 rounded-[7px] border flex items-center gap-1.5 text-[11.5px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        isSourcesPanelOpen
                          ? 'border-[#2F6FED]/55 bg-[rgba(28,36,56,0.65)] text-[#F2F2F4]'
                          : 'border-white/[0.08] bg-white/[0.04] text-[#9A9AA2] hover:bg-[rgba(28,36,56,0.65)] hover:text-[#F2F2F4]'
                      }`}
                    >
                      <BookOpen className="h-3 w-3 shrink-0 text-[#2F6FED]" />
                      <span>Fuentes ({activeConversationCitations.length})</span>
                    </button>
                  )}

                  {messages.length > 0 && (
                    <button
                      type="button"
                      onClick={handleExportSession}
                      title="Exportar investigación"
                      aria-label="Exportar investigación"
                      className="h-7 px-2 sm:px-2.5 rounded-[7px] bg-white/[0.04] hover:bg-[rgba(28,36,56,0.65)] border border-white/[0.08] flex items-center gap-1.5 text-[11.5px] font-medium text-[#F2F2F4] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                    >
                      <Download className="h-3 w-3 text-[#9A9AA2] shrink-0" />
                      <span className="hidden min-[360px]:inline">Exportar</span>
                    </button>
                  )}
                </div>
              </header>
            )}

              {/* Navegación móvil en anchos estrechos */}
              <div className="md:hidden shrink-0 border-b border-white/[0.06] py-1.5 flex justify-center">
                <SpatialNavPill
                  compact
                  activeNav={activeNav}
                  onSelectNav={(id) => handleNavigate(id)}
                  pcVerdict={pcVerdict}
                  usbConnected={usbConnected}
                  apiOnline={apiOnline}
                  isLoadingChat={loadingChat}
                  authConnected={Boolean(authSession)}
                />
              </div>

              {/* Contenido del instrumento activo */}
              <div className="relative z-10 flex-1 min-h-0 flex flex-col overflow-hidden">
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
                    chatContext={activeChatContext}
                    lastRewrittenQuery={activeSession?.lastRewrittenQuery || null}
                    onUpdateChatContext={handleUpdateChatContext}
                    onClearChatContext={handleClearChatContext}
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
                    authSession={authSession}
                    onOpenAuth={openAuthModal}
                    usePrivateDocs={usePrivateDocs}
                    onTogglePrivateDocs={(nextVal) => setUsePrivateDocs(Boolean(nextVal))}
                    privateDocs={expedienteDocs}
                    loadingDocs={loadingExpedientes}
                    uploadingPdf={uploadingPdf}
                    docNotice={expedienteNotice}
                    docError={expedienteError}
                    onDismissDocBanner={() => {
                      setExpedienteNotice('');
                      setExpedienteError('');
                    }}
                    onUploadPdf={handleUploadExpedientePdf}
                    onRefreshDocs={() => refreshActiveExpedienteDocs(activeExpedienteId)}
                  />
                ) : activeNav === 'cuenta' ? (
                  <AuthModulePanel
                    authSession={authSession}
                    onAuthenticated={(session) => {
                      setAuthSession(session);
                      void refreshSystemTelemetry();
                      void refreshPrivateWorkspace();
                    }}
                    onLogout={handleLogout}
                    govStats={govStats}
                    privateDocs={expedienteDocs}
                    loadingDocs={loadingExpedientes}
                    uploadingPdf={uploadingPdf}
                    docNotice={expedienteNotice}
                    docError={expedienteError}
                    onDismissDocBanner={() => {
                      setExpedienteNotice('');
                      setExpedienteError('');
                    }}
                    onUploadPdf={handleUploadExpedientePdf}
                    onRefreshDocs={() => refreshActiveExpedienteDocs(activeExpedienteId)}
                    onOpenChat={(preferPrivate) => {
                      if (preferPrivate && activeExpedienteId) {
                        setUsePrivateDocs(true);
                      }
                      handleNavigate('preguntar');
                    }}
                    onOpenSettings={() => handleNavigate('ajustes')}
                    onOpenAuth={openAuthModal}
                  />
                ) : activeNav === 'amenazas' ? (
                  <CampaignsPanel
                    onAskInChat={askInChat}
                    onVerifyLink={(url) => handleNavigate('enlace', { url })}
                    onAuditDevice={(tab = 'android') => handleNavigate('equipo', { tab })}
                    initialSearch={threatJump.query}
                    initialSearchKey={threatJump.key}
                  />
                ) : activeNav === 'equipo' || activeNav === 'exposicion' || activeNav === 'enlace' ? (
                  <div className="flex-1 overflow-y-auto px-3.5 sm:px-6 py-4 sm:py-8 flex flex-col">
                    {activeNav === 'equipo' && (
                      <MvtVerifierPanel
                        key={`mvt-${deviceNavKey}`}
                        onAskInChat={askInChat}
                        onVerifyLink={(url) => handleNavigate('enlace', { url })}
                        onOpenThreat={(campaignQuery) => handleNavigate('amenazas', { campaignQuery })}
                        initialTab={deviceInitialTab}
                        preloadedAudit={pcAudit}
                        onAuditUpdate={handlePcAuditComplete}
                      />
                    )}
                    {activeNav === 'exposicion' && (
                      <OsintPanel
                        onAskInChat={askInChat}
                        onVerifyLink={(url) => handleNavigate('enlace', { url })}
                        onAuditDevice={(tab = 'pc') => handleNavigate('equipo', { tab })}
                        onOpenThreat={(campaignQuery) => handleNavigate('amenazas', { campaignQuery })}
                        initialAsset={osintJump}
                        initialJumpKey={osintJump.key}
                      />
                    )}
                    {activeNav === 'enlace' && (
                      <LinkVerifierPanel
                        onAskInChat={askInChat}
                        onAuditDomain={(assetValue) =>
                          handleNavigate('exposicion', { assetValue, assetType: 'domain' })
                        }
                        onAuditDevice={(tab = 'android') => handleNavigate('equipo', { tab })}
                        onOpenThreat={(campaignQuery) => handleNavigate('amenazas', { campaignQuery })}
                        initialUrl={linkJump.url}
                        initialCheckKey={linkJump.key}
                        onLinkVerified={handleLinkVerified}
                      />
                    )}
                  </div>
                ) : (
                  <SettingsPanel
                    topK={topK}
                    onChangeTopK={setTopK}
                    sourceScope={sourceScope}
                    onChangeSourceScope={setSourceScope}
                    authSession={authSession}
                    onOpenAuth={openAuthModal}
                    onLogout={handleLogout}
                  />
                )}
              </div>
            </div>
          )}
        </main>

      {/* Panel Deslizable No Destructivo de Copiloto */}
      <CopilotDrawer
        isOpen={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
        onOpenFullWorkspace={() => handleNavigate('preguntar')}
        activeSession={activeSession}
        isLoading={loadingChat}
        failedPrompt={drawerFailedPrompt}
        onRetryFailedTurn={() =>
          lastMsg?.isError &&
          handleRetryFailedTurn(messages.length - 1, lastMsg.retryQuery, lastMsg.sourceScope)
        }
        activeCitation={selectedCitation}
        onSelectCitation={(cit) => {
          handleSelectCitation(cit);
          setIsCopilotOpen(false);
          setActiveNav('preguntar');
        }}
        onSendPrompt={(promptText) =>
          handleSend(promptText, 'Todas las fuentes', {
            forceNewSession: !currentSessionId,
          })
        }
        pinnedContext={pinnedCopilotContext}
        onClearPinnedContext={() => setPinnedCopilotContext('')}
        reportsCount={reportsCount}
      />

      {/* Paleta Spotlight (⌘K) */}
      {commandOpen && (
        <div
          onClick={() => setCommandOpen(false)}
          className="fixed inset-0 z-50 bg-[#0A0A0C]/72 flex items-start justify-center pt-[14vh] px-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="apple-modal-in omega-glass-panel w-full max-w-[540px] rounded-[16px] overflow-hidden"
          >
            <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3.5">
              <Search strokeWidth={1.7} className="h-[18px] w-[18px] text-[#9A9AA2] shrink-0" />
              <input
                type="text"
                autoFocus
                value={commandQuery}
                onChange={(e) => setCommandQuery(sanitizeSearchInput(e.target.value))}
                maxLength={120}
                placeholder="Ir a módulo, herramienta o conversación reciente..."
                className="flex-1 bg-transparent text-[14.5px] tracking-[-0.01em] text-[#F2F2F4] placeholder-[#9A9AA2] focus:outline-none"
              />
              <span className="font-tech rounded-[5px] bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 text-[10.5px] text-[#9A9AA2]">
                ESC
              </span>
            </div>

            <div className="max-h-[460px] overflow-y-auto p-2 pb-2.5 space-y-1">
              <p className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold tracking-[0.02em] text-[#9A9AA2]">
                Instrumentos y módulos
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
                      handleNavigate(item.id);
                      setCommandOpen(false);
                    }}
                    className="w-full flex items-center justify-between rounded-[10px] px-3 py-2 text-left text-[13px] text-[#F2F2F4] hover:bg-[rgba(28,36,56,0.65)] transition-colors duration-150 cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-3">
                      <Icon strokeWidth={1.7} className="h-4 w-4 text-[#2F6FED]" />
                      <span className="font-medium tracking-[-0.01em]">{item.label}</span>
                    </span>
                    <span className="text-[11.5px] text-[#9A9AA2]">{item.subtitle}</span>
                  </button>
                );
              })}

              <p className="px-2.5 pt-2.5 pb-0.5 text-[11px] font-semibold tracking-[0.02em] text-[#9A9AA2]">
                Acciones rápidas
              </p>
              <button
                type="button"
                onClick={() => {
                  setIsCopilotOpen(true);
                  setCommandOpen(false);
                }}
                className="w-full flex items-center justify-between rounded-[10px] px-3 py-2 text-left text-[13px] text-[#F2F2F4] hover:bg-[rgba(28,36,56,0.65)] transition-colors cursor-pointer"
              >
                <span className="inline-flex items-center gap-3">
                  <Sparkles className="h-4 w-4 text-[#2F6FED]" />
                  <span>Abrir Copiloto lateral</span>
                </span>
                <span className="font-tech text-[11px] text-[#9A9AA2]">⌘J</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTechnicalMode((v) => !v);
                  setCommandOpen(false);
                }}
                className="w-full flex items-center justify-between rounded-[10px] px-3 py-2 text-left text-[13px] text-[#F2F2F4] hover:bg-[rgba(28,36,56,0.65)] transition-colors cursor-pointer"
              >
                <span className="inline-flex items-center gap-3">
                  <Gauge className="h-4 w-4 text-[#2F6FED]" />
                  <span>
                    Cambiar a modo {technicalMode ? 'Simple (lenguaje claro)' : 'Técnico'}
                  </span>
                </span>
                <span className="text-[11.5px] text-[#9A9AA2]">Vista actual</span>
              </button>

              {sessions.length > 0 && (
                <>
                  <p className="px-2.5 pt-2.5 pb-0.5 text-[11px] font-semibold tracking-[0.02em] text-[#9A9AA2]">
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
                        className="w-full flex items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[12.5px] text-[#9A9AA2] hover:bg-[rgba(28,36,56,0.65)] hover:text-[#F2F2F4] transition-colors duration-150 cursor-pointer"
                      >
                        <MessageSquare strokeWidth={1.65} className="h-3.5 w-3.5 text-[#9A9AA2] shrink-0" />
                        <span className="truncate">{s.title}</span>
                      </button>
                    ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => {
          setAuthModalOpen(false);
          setAuthModalReason('');
        }}
        onAuthenticated={(session) => {
          setAuthSession(session);
          setAuthModalOpen(false);
          setAuthModalReason('');
          void refreshSystemTelemetry();
          void refreshPrivateWorkspace();
        }}
        reasonMessage={authModalReason}
        onOpenCuenta={() => handleNavigate('cuenta')}
      />
    </div>
  );
}
