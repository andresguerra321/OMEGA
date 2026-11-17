import { Suspense, lazy, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { pageVariants, popVariants } from './lib/motion';
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
  sendMultimodalQuery,
  analyzePcLiveSnapshot,
  syncStixFeeds,
  getAuthSession,
  clearAuthSession,
  isAuthenticated,
  logoutSession,
  panicPurgeClient,
  restoreCookieAuthSession,
  ensurePersonalWorkspace,
  listExpedienteDocuments,
  uploadExpedientePdf,
} from './lib/api';
import { ChatAtmosphere } from './components/ChatAtmosphere';
import { OmegaAuthBackdrop } from './components/OmegaAuthBackdrop';
import { OmegaLogo } from './components/OmegaLogo';
import { OmegaLoader } from './components/OmegaLoader';
import { SpatialNavPill } from './components/SpatialNavPill';
import { AuthModulePanel } from './components/AuthModulePanel';
import { HostProtectionPanel } from './components/HostProtectionPanel';
import { sanitizeSearchInput, validateChatMessage, validateUploadFile } from './lib/validators';

const SecurityPostureStage = lazy(() =>
  import('./components/SecurityPostureStage').then((m) => ({ default: m.SecurityPostureStage }))
);
const CopilotDrawer = lazy(() =>
  import('./components/CopilotDrawer').then((m) => ({ default: m.CopilotDrawer }))
);
const ChatWorkspace = lazy(() =>
  import('./components/ChatWorkspace').then((m) => ({ default: m.ChatWorkspace }))
);
const CampaignsPanel = lazy(() =>
  import('./components/CampaignsPanel').then((m) => ({ default: m.CampaignsPanel }))
);
const MvtVerifierPanel = lazy(() =>
  import('./components/MvtVerifierPanel').then((m) => ({ default: m.MvtVerifierPanel }))
);
const OsintPanel = lazy(() =>
  import('./components/OsintPanel').then((m) => ({ default: m.OsintPanel }))
);
const LinkVerifierPanel = lazy(() =>
  import('./components/LinkVerifierPanel').then((m) => ({ default: m.LinkVerifierPanel }))
);
const SettingsPanel = lazy(() =>
  import('./components/SettingsPanel').then((m) => ({ default: m.SettingsPanel }))
);
const AuthModal = lazy(() =>
  import('./components/AuthModal').then((m) => ({ default: m.AuthModal }))
);
const OnboardingTourModal = lazy(() =>
  import('./components/OnboardingTourModal').then((m) => ({ default: m.OnboardingTourModal }))
);

const NAV_ITEMS = [
  { id: 'inicio', label: 'Inicio', subtitle: 'Estado en vivo y escudos', icon: Gauge },
  { id: 'equipo', label: 'Equipos', subtitle: 'PC Windows, Android e iPhone', icon: Laptop },
  { id: 'exposicion', label: 'Enlaces y OSINT', subtitle: 'URLs, dominios y correos', icon: Radar },
  { id: 'amenazas', label: 'Amenazas', subtitle: 'Campañas, CVEs y actores', icon: Layers },
  { id: 'preguntar', label: 'Asistente', subtitle: 'Consultas con citas', icon: MessageSquare },
  { id: 'cuenta', label: 'Cuenta', subtitle: 'Registro, sesión y PDFs privados', icon: UserCheck },
  { id: 'ajustes', label: 'Ajustes', subtitle: 'Motor RAG, cuenta y permisos', icon: Settings },
];

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

const BOOT_LOADER_STEPS = [
  'Verificando sesión',
  'Contactando el servicio local',
  'Preparando la interfaz',
];

const LOGIN_LOADER_STEPS = [
  'Identidad verificada',
  'Cargando espacio de trabajo',
  'Abriendo cabina OMEGA',
];

function getSmoothDelayMs(targetMs) {
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  ) {
    return 0;
  }
  return targetMs;
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
  const [lastAnalysisContext, setLastAnalysisContext] = useState('');
  const [deviceInitialTab, setDeviceInitialTab] = useState('android');
  const [deviceNavKey, setDeviceNavKey] = useState(0);
  const [linkJump, setLinkJump] = useState({ url: '', key: 0 });
  const [threatJump, setThreatJump] = useState({ query: '', key: 0 });
  const [settingsJump, setSettingsJump] = useState({ section: '', key: 0 });
  const [osintJump, setOsintJump] = useState({ value: '', type: 'domain', key: 0 });
  const [intelTab, setIntelTab] = useState('link');
  const [selectedNodeId, setSelectedNodeId] = useState('windows');
  const [scanningPc, setScanningPc] = useState(false);
  const [syncingStix, setSyncingStix] = useState(false);
  const [stageFeedback, setStageFeedback] = useState(null);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [pinnedCopilotContext, setPinnedCopilotContext] = useState('');
  const [sessionsMenuOpen, setSessionsMenuOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);

  const [loadingChat, setLoadingChat] = useState(false);
  const [topK, setTopK] = useState(6);
  const [generalChatMode, setGeneralChatMode] = useState(false);
  const [sourceScope, setSourceScope] = useState('Todas las fuentes');
  const [selectedCitation, setSelectedCitation] = useState(null);
  const [isSourcesPanelOpen, setIsSourcesPanelOpen] = useState(false);
  const [draftContext, setDraftContext] = useState(null);

  const [authSession, setAuthSession] = useState(() => getAuthSession());
  const [verifyingSession, setVerifyingSession] = useState(true);
  const [enteringWorkspace, setEnteringWorkspace] = useState(false);
  const [authGateReason, setAuthGateReason] = useState('');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalReason, setAuthModalReason] = useState('');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [activeExpedienteId, setActiveExpedienteId] = useState('');
  const [usePrivateDocs, setUsePrivateDocs] = useState(false);
  const [expedienteDocs, setExpedienteDocs] = useState([]);
  const [loadingExpedientes, setLoadingExpedientes] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [expedienteNotice, setExpedienteNotice] = useState('');
  const [expedienteError, setExpedienteError] = useState('');

  const textareaRef = useRef(null);
  const sendLockRef = useRef(false);
  const enterRunIdRef = useRef(0);
  const workspaceMainRef = useRef(null);

  const openAuthModal = useCallback((reason = '') => {
    setAuthModalReason(reason || '');
    setAuthModalOpen(true);
  }, []);

  const handleLogout = useCallback(() => {
    void logoutSession();
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
    setLastAnalysisContext('');
    setStageFeedback(null);
    setActiveExpedienteId('');
    setUsePrivateDocs(false);
    setExpedienteDocs([]);
    setGovStats(null);
    setExpedienteNotice('');
    setExpedienteError('');
  }, []);

  const handlePanicPurge = useCallback(async () => {
    await panicPurgeClient();
    setSessions([]);
    setCurrentSessionId(null);
    setAuthSession(null);
    setVerifyingSession(false);
    setAuthGateReason('Purga rápida ejecutada: credenciales, historial en RAM y caché local destruidos.');
    setActiveNav('inicio');
    setIsCopilotOpen(false);
    setCommandOpen(false);
    setSessionsMenuOpen(false);
    setAuthModalOpen(false);
    setSelectedCitation(null);
    setIsSourcesPanelOpen(false);
    setDraftContext(null);
    setPcAudit(null);
    setPcScannedAt('');
    setLastLinkResult(null);
    setLastAnalysisContext('');
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
      const hasSession = isAuthenticated();
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
    if (!isAuthenticated()) {
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
    if (!targetId || !isAuthenticated()) {
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
    const hadInMemorySession = isAuthenticated();
    const isHttpOrigin = typeof window !== 'undefined' && window.location?.protocol !== 'file:';
    const shouldFetchPrincipal = hadInMemorySession || isHttpOrigin;
    const minHoldMs = getSmoothDelayMs(850);

    const authPromise = shouldFetchPrincipal
      ? fetchCurrentPrincipal()
          .then((me) => {
            if (cancelled) return;
            if (me?.userId && me?.tenantId) {
              const restored = restoreCookieAuthSession(me);
              if (restored) {
                setAuthSession(restored);
              }
            }
          })
          .catch((err) => {
            if (cancelled) return;
            if (err?.requiresAuth || err?.status === 401 || err?.status === 403) {
              clearAuthSession();
              setAuthSession(null);
              if (hadInMemorySession) {
                setAuthGateReason('Tu sesión expiró o no es válida. Inicia sesión para continuar.');
              }
            }
          })
      : Promise.resolve();

    const holdPromise =
      minHoldMs > 0
        ? new Promise((resolve) => {
            setTimeout(resolve, minHoldMs);
          })
        : Promise.resolve();

    void Promise.all([authPromise, holdPromise]).finally(() => {
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
      if (next && (next.accessToken || next.cookieBacked)) {
        setAuthGateReason('');
      } else {
        enterRunIdRef.current += 1;
        setEnteringWorkspace(false);
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
      if (!isAuthenticated()) {
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
      if (authSession) {
        void refreshPrivateWorkspace();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [authSession, refreshSystemTelemetry, refreshPrivateWorkspace]);

  useEffect(() => {
    if (!activeExpedienteId || !authSession) return undefined;
    const timer = setTimeout(() => {
      void refreshActiveExpedienteDocs(activeExpedienteId);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeExpedienteId, authSession, refreshActiveExpedienteDocs]);

  useEffect(() => {
    const hasPending = expedienteDocs.some(
      (d) => d.status === 'PENDING' || d.status === 'PROCESSING',
    );
    if (!hasPending || !activeExpedienteId || !authSession) return undefined;
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
  }, [expedienteDocs, activeExpedienteId, authSession, refreshSystemTelemetry]);

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
    if (!bridge?.isDesktop || !authSession) return undefined;
    let cancelled = false;

    const pollUsb = async () => {
      try {
        const [adb, ios] = await Promise.all([
          bridge.checkAdbStatus ? bridge.checkAdbStatus('').catch(() => null) : null,
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
  }, [authSession]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.omegaDesktop?.setTitleBarTheme) {
      void window.omegaDesktop.setTitleBarTheme('dark');
    }
  }, [activeNav]);

  useEffect(() => {
    if (!authSession) return undefined;
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
  }, [authSession]);

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
    if (!isAuthenticated()) {
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
      const targetExpedienteId = usePrivateDocs && activeExpedienteId ? activeExpedienteId : null;
      const res = options?.imageFile
        ? await sendMultimodalQuery({
            expedienteId: targetExpedienteId,
            imageFile: options.imageFile,
            question: query,
          })
        : await sendChatQuery(
            query,
            historyPayload,
            topK,
            effectiveScope,
            pinnedContextPayload,
            {
              expedienteId: targetExpedienteId,
              generalMode: generalChatMode,
              analysisContext: options?.analysisContext ?? (lastAnalysisContext || null),
            },
          );
      const latency = ((performance.now() - t0) / 1000).toFixed(2);
      const assistantTurn = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: res.answer,
        generalMode: Boolean(res.generalMode),
        citations: res.citations || [],
        warnings: res.warnings || [],
        reindexRequiredDocuments: res.reindexRequiredDocuments || [],
        model: res.model,
        analysis: res.analysis,
        multimodal: res.multimodal || null,
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
    if (!isAuthenticated()) {
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
    if (opts?.settingsSection) {
      setSettingsJump((prev) => ({
        section: opts.settingsSection,
        key: prev.key + 1,
      }));
    }
    setSessionsMenuOpen(false);
    if (navId === 'enlace') {
      setIntelTab('link');
      setActiveNav('exposicion');
      return;
    }
    if (navId === 'exposicion' && opts?.assetValue) {
      setIntelTab('osint');
    }
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
              : 'Auditoría finalizada: sin coincidencias en las fuentes examinadas. Esto no descarta todas las amenazas.',
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

  function formatLinkTelemetryContext(res) {
    if (!res) return '';
    const ctiMatches = Array.isArray(res.cti_matches) ? res.cti_matches : [];
    const heuristics = Array.isArray(res.heuristics) ? res.heuristics : [];
    const owasp = Array.isArray(res.owasp_findings) ? res.owasp_findings : [];
    const vt = res.external_reputation?.virustotal;
    const abuse = res.external_reputation?.abuseipdb;
    const trace = res.trace_result;
    const lines = [
      `URL analizada: ${res.normalized_url || res.host || 'N/D'}`,
      `Host: ${res.host || 'N/D'} | Dominio raíz: ${res.root_domain || res.host || 'N/D'} | Esquema: ${res.scheme || 'N/D'}`,
      `Nivel de riesgo: ${res.risk_level || 'N/D'} — ${res.verdict || ''}`,
      res.recommendation ? `Recomendación: ${res.recommendation}` : '',
      res.passive_ct_certificates !== null && res.passive_ct_certificates !== undefined
        ? `Certificados CT (crt.sh/CertSpotter): ${res.passive_ct_certificates} registros`
        : 'Certificados CT: N/D',
      vt && vt.status === 'ok'
        ? `VirusTotal / Reputación: ${vt.malicious || 0} maliciosos, ${vt.suspicious || 0} sospechosos`
        : '',
      abuse && abuse.status === 'ok'
        ? `AbuseIPDB: Score ${abuse.abuse_confidence_score}% (${abuse.total_reports} reportes)`
        : '',
      ctiMatches.length > 0
        ? `Coincidencias CTI (${ctiMatches.length}): ${ctiMatches.slice(0, 5).map((m) => `${m.ioc_value} [${m.spyware_family || m.campaign || 'CTI'}: ${m.context || ''}]`).join(' ; ')}`
        : 'Coincidencias CTI: 0',
      owasp.length > 0
        ? `Reglas OWASP activadas (${owasp.length}): ${owasp.map((f) => `[${f.rule_id} ${f.severity}] ${f.title}: ${f.detail}`).join(' ; ')}`
        : '',
      heuristics.length > 0
        ? `Alertas estructurales (${heuristics.length}): ${heuristics.join(' ; ')}`
        : '',
      trace?.final_url && trace.final_url !== res.normalized_url
        ? `Destino tras redirecciones (sin JS): ${trace.final_url}`
        : '',
    ];
    return lines.filter(Boolean).join('\n');
  }

  function handleLinkVerified(res) {
    setLastLinkResult(res);
    const ctx = formatLinkTelemetryContext(res);
    if (ctx) setLastAnalysisContext(ctx);
  }

  function handleOpenCopilot(opts = {}) {
    if (opts?.pinnedContext) {
      setPinnedCopilotContext(opts.pinnedContext);
    }
    if (opts?.analysisContext) {
      setLastAnalysisContext(opts.analysisContext);
    }
    setSessionsMenuOpen(false);
    setIsCopilotOpen(true);
    if (opts?.prompt) {
      setSelectedCitation(null);
      setSourceScope('Todas las fuentes');
      handleSend(opts.prompt, 'Todas las fuentes', {
        forceNewSession: Boolean(opts.forceNewSession || !currentSessionId),
        analysisContext: opts?.analysisContext,
      });
    }
  }

  function askInChat(promptText, opts = {}) {
    const cleanPrompt = String(promptText || '').trim();
    if (!cleanPrompt) return;
    if (opts?.analysisContext) {
      setLastAnalysisContext(opts.analysisContext);
    }
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
    handleSend(cleanPrompt, 'Todas las fuentes', {
      forceNewSession: true,
      analysisContext: opts?.analysisContext,
    });
  }

  const completeAuthenticationTransition = useCallback(
    (session, meta = {}) => {
      const runId = ++enterRunIdRef.current;
      setAuthGateReason('');
      setAuthModalReason('');
      setAuthModalOpen(false);
      setVerifyingSession(false);
      setAuthSession(session);
      setActiveNav('inicio');
      setEnteringWorkspace(true);

      const minHoldMs = getSmoothDelayMs(1150);
      const workspaceReady = Promise.allSettled([
        refreshSystemTelemetry(),
        refreshPrivateWorkspace(),
      ]);
      const holdPromise =
        minHoldMs > 0
          ? new Promise((resolve) => {
              setTimeout(resolve, minHoldMs);
            })
          : Promise.resolve();
      const maxWait = new Promise((resolve) => {
        setTimeout(resolve, 2600);
      });

      void Promise.all([holdPromise, Promise.race([workspaceReady, maxWait])]).finally(() => {
        if (enterRunIdRef.current !== runId) return;
        setEnteringWorkspace(false);
        if (meta?.isNewAccount) {
          setOnboardingOpen(true);
        } else {
          requestAnimationFrame(() => workspaceMainRef.current?.focus({ preventScroll: true }));
        }
      });
    },
    [refreshSystemTelemetry, refreshPrivateWorkspace],
  );

  const isDesktop = typeof window !== 'undefined' && Boolean(window.omegaDesktop?.isDesktop);
  const isSignedIn = Boolean(authSession);
  const activeNavItem = NAV_ITEMS.find((n) => n.id === activeNav) || NAV_ITEMS[0];
  const reportsCount = Number(govStats?.corpus_stats?.reports ?? 26);
  const usbConnected = Boolean(usbStatus?.android?.connected || usbStatus?.ios?.connected);
  const pcRawVerdict = pcAudit?.triage?.diagnosis?.verdict_code || pcAudit?.verdict;
  const pcVerdict = pcRawVerdict ? String(pcRawVerdict).toLowerCase() : null;
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const drawerFailedPrompt = lastMsg?.isError ? lastMsg.retryQuery : '';
  const isHome = activeNav === 'inicio';

  const screenKey =
    verifyingSession || enteringWorkspace
      ? enteringWorkspace
        ? 'screen-entering-loader'
        : 'screen-boot-loader'
      : !isSignedIn
        ? 'screen-auth-gate'
        : 'screen-workspace';

  return (
    <AnimatePresence mode="wait" initial={false}>
      {verifyingSession || enteringWorkspace ? (
        <motion.div
          key={screenKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.22 } }}
          exit={{ opacity: 0, scale: 0.99, transition: { duration: 0.2 } }}
          className="roam-obsidian-sheet relative h-screen w-screen overflow-hidden flex flex-col items-center justify-center bg-[#0A0A0C] text-[#F2F2F4] select-none"
        >
          <OmegaAuthBackdrop />
          <OmegaLoader
            key={enteringWorkspace ? 'entering' : 'boot'}
            steps={enteringWorkspace ? LOGIN_LOADER_STEPS : BOOT_LOADER_STEPS}
            stepIntervalMs={enteringWorkspace ? 420 : 380}
            label={enteringWorkspace ? 'Preparando cabina OMEGA' : 'Iniciando OMEGA'}
          />
        </motion.div>
      ) : !isSignedIn ? (
        <motion.div
          key="screen-auth-gate"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.28 } }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
          className="roam-obsidian-sheet relative h-screen w-screen overflow-hidden flex flex-col bg-[#0A0A0C] text-[#F2F2F4]"
        >
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
            onAuthenticated={completeAuthenticationTransition}
          />
        </motion.div>
      ) : (
        <motion.div
          key="screen-workspace"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.3 } }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
          className="relative h-screen w-screen overflow-hidden flex flex-col bg-[#0A0A0C] text-[#F2F2F4] select-none"
        >
      <main
        ref={workspaceMainRef}
        tabIndex={-1}
        className="relative flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden select-text focus:outline-none"
      >
        <HostProtectionPanel session={authSession} expanded={activeNav === 'equipo'} desktop={isDesktop} expedienteId={activeExpedienteId || null} />
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center">
              <OmegaLoader />
            </div>
          }
        >
        <AnimatePresence mode="wait" initial={false}>
        {isHome ? (
          <motion.div
            key="home-stage"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex-1 min-h-0 flex flex-col"
          >
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
            onOpenOnboarding={() => setOnboardingOpen(true)}
            onNavigate={handleNavigate}
            onLinkVerified={handleLinkVerified}
            onPanicPurge={handlePanicPurge}
            authSession={authSession}
          />
          </motion.div>
        ) : (
          <motion.div
            key="instrument-shell"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="roam-obsidian-sheet relative flex-1 min-h-0 flex flex-col overflow-hidden text-[#F2F2F4]"
          >
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
                  onClick={() => setOnboardingOpen(true)}
                  aria-label="Abrir guía rápida de uso"
                  title="Guía rápida de OMEGA"
                  className="omega-glass-chip h-8 px-2 rounded-[9px] inline-flex items-center gap-1 text-[11.5px] text-[#9A9AA2] hover:text-[#F2F2F4] transition-colors cursor-pointer"
                >
                  <BookOpen className="h-3.5 w-3.5 text-[#6FA0FF]" />
                  <span className="hidden 2xl:inline">Guía</span>
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

                {authSession && (
                  <button
                    type="button"
                    onClick={() => void handlePanicPurge()}
                    title="Purga rápida de emergencia: borra tokens, memoria volátil y caché local"
                    aria-label="Purga rápida de emergencia"
                    className="omega-glass-chip h-8 px-2 rounded-[9px] border-[#FF453A]/35 bg-[#FF453A]/10 hover:bg-[#FF453A]/20 text-[#FFDAD6] inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer transition-colors"
                  >
                    <Trash2 className="h-3 w-3 shrink-0" />
                    <span className="hidden xl:inline">Purga</span>
                  </button>
                )}
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

                  <AnimatePresence>
                  {sessionsMenuOpen && (
                    <motion.div variants={popVariants} initial="initial" animate="animate" exit="exit" className="apple-group origin-top-left absolute left-0 mt-1.5 w-[min(300px,calc(100vw-1.75rem))] rounded-[13px] bg-[#141418]/96 p-1.5 z-50 space-y-1">
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
                    </motion.div>
                  )}
                  </AnimatePresence>
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
               <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={activeNav}
                  variants={pageVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="flex-1 min-h-0 flex flex-col overflow-hidden"
                >
                {activeNav === 'preguntar' ? (
                  <ChatWorkspace
                    messages={messages}
                    loading={loadingChat}
                    topK={topK}
                    onChangeTopK={setTopK}
                    generalChatMode={generalChatMode}
                    onToggleGeneralChatMode={() => setGeneralChatMode((v) => !v)}
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
                    activeExpedienteId={activeExpedienteId}
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
                    aiEngine={govStats?.ai_engine || null}
                    onOpenAiSetup={() => handleNavigate('ajustes', { settingsSection: 'ia' })}
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
                    activeExpedienteId={activeExpedienteId}
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
                      <div className="space-y-6">
                        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] pb-4">
                          <button
                            type="button"
                            onClick={() => setIntelTab('link')}
                            className={`inline-flex items-center gap-2 rounded-[10px] border px-3.5 py-2 text-[12.5px] font-medium transition-all cursor-pointer ${
                              intelTab === 'link'
                                ? 'border-[#2F6FED]/55 bg-[#2F6FED]/15 text-[#F2F2F4]'
                                : 'border-white/[0.08] bg-white/[0.03] text-[#9A9AA2] hover:text-[#F2F2F4]'
                            }`}
                          >
                            <Link2 className="h-3.5 w-3.5 text-[#6EA0FF]" />
                            <span>Verificar enlace (URL + OWASP)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setIntelTab('osint')}
                            className={`inline-flex items-center gap-2 rounded-[10px] border px-3.5 py-2 text-[12.5px] font-medium transition-all cursor-pointer ${
                              intelTab === 'osint'
                                ? 'border-[#2F6FED]/55 bg-[#2F6FED]/15 text-[#F2F2F4]'
                                : 'border-white/[0.08] bg-white/[0.03] text-[#9A9AA2] hover:text-[#F2F2F4]'
                            }`}
                          >
                            <Radar className="h-3.5 w-3.5 text-[#6EA0FF]" />
                            <span>Dominios y correos (OSINT + HIBP)</span>
                          </button>
                        </div>
                        {intelTab === 'link' ? (
                          <LinkVerifierPanel
                            onAskInChat={askInChat}
                            onAuditDomain={(assetValue) => {
                              setOsintJump((prev) => ({ value: assetValue, type: 'domain', key: prev.key + 1 }));
                              setIntelTab('osint');
                            }}
                            onAuditDevice={(tab = 'android') => handleNavigate('equipo', { tab })}
                            onOpenThreat={(campaignQuery) => handleNavigate('amenazas', { campaignQuery })}
                            initialUrl={linkJump.url}
                            initialCheckKey={linkJump.key}
                            onLinkVerified={handleLinkVerified}
                          />
                        ) : (
                          <OsintPanel
                            onAskInChat={askInChat}
                            onVerifyLink={(url) => {
                              setLinkJump((prev) => ({ url, key: prev.key + 1 }));
                              setIntelTab('link');
                            }}
                            onAuditDevice={(tab = 'pc') => handleNavigate('equipo', { tab })}
                            onOpenThreat={(campaignQuery) => handleNavigate('amenazas', { campaignQuery })}
                            initialAsset={osintJump}
                            initialJumpKey={osintJump.key}
                          />
                        )}
                      </div>
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
                    onPanicPurge={handlePanicPurge}
                    initialSection={settingsJump.section}
                    initialSectionKey={settingsJump.key}
                    onAiConfigured={() => void refreshSystemTelemetry()}
                  />
                )}
                </motion.div>
               </AnimatePresence>
              </div>
          </motion.div>
          )}
        </AnimatePresence>
        </Suspense>
        </main>

      {/* Panel Deslizable No Destructivo de Copiloto */}
      <Suspense fallback={null}>
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
              <button
                type="button"
                onClick={() => {
                  setCommandOpen(false);
                  setOnboardingOpen(true);
                }}
                className="w-full flex items-center justify-between rounded-[10px] px-3 py-2 text-left text-[13px] text-[#F2F2F4] hover:bg-[rgba(28,36,56,0.65)] transition-colors cursor-pointer"
              >
                <span className="inline-flex items-center gap-3">
                  <BookOpen className="h-4 w-4 text-[#6FA0FF]" />
                  <span>Abrir guía interactiva de primeros pasos</span>
                </span>
                <span className="text-[11.5px] text-[#9A9AA2]">Tutorial</span>
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
        onAuthenticated={completeAuthenticationTransition}
        reasonMessage={authModalReason}
        onOpenCuenta={() => handleNavigate('cuenta')}
      />

      <OnboardingTourModal
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onNavigate={(targetNav) => handleNavigate(targetNav)}
        onOpenCopilot={handleOpenCopilot}
        authSession={authSession}
      />
      </Suspense>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
