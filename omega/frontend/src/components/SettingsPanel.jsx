import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FileCheck2,
  Globe,
  KeyRound,
  Layers,
  Lock,
  LogOut,
  Microscope,
  RefreshCw,
  RotateCcw,
  Scale,
  Shield,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Zap,
} from 'lucide-react';
import {
  createTenantUser,
  fetchAuditLogs,
  fetchSystemGovernance,
  getWorkspaceId,
  rotateWorkspaceId,
  verifyAuditChain,
} from '../lib/api';
import { stripUnsafeChars, validateTenantUserForm } from '../lib/validators';
import { useSingleFlight } from '../lib/useSingleFlight';
import { useScrollReveal } from '../lib/useScrollReveal';
import { OmegaWebIntelCard } from './OmegaWebIntelCard';
import {
  ActionConfirmationBanner,
  PanelErrorBanner,
  PanelSkeleton,
} from './PanelStatePrimitives';

const CONFIG_SECTIONS = [
  { id: 'cuenta', label: 'Cuenta y sesión', icon: Shield },
  { id: 'ia', label: 'Motor de IA', icon: Sparkles },
  { id: 'rag', label: 'Motor RAG', icon: Layers },
  { id: 'permisos', label: 'Permisos y ética', icon: ShieldCheck },
  { id: 'corpus', label: 'Corpus indexado', icon: Database },
];

const GROQ_MODELS = [
  { value: 'openai/gpt-oss-120b', label: 'openai/gpt-oss-120b (Recomendado)' },
  { value: 'llama-3.3-70b-versatile', label: 'llama-3.3-70b-versatile (Alternativo)' },
  { value: 'llama-3.1-8b-instant', label: 'llama-3.1-8b-instant (Ultra rápido)' },
];

const TOPK_OPTIONS = [
  {
    value: 4,
    label: '4 fragmentos',
    caption: 'Respuesta rápida',
    icon: Zap,
  },
  {
    value: 6,
    label: '6 fragmentos',
    caption: 'Balanceado (Recomendado)',
    icon: Scale,
  },
  {
    value: 10,
    label: '10 fragmentos',
    caption: 'Auditoría exhaustiva',
    icon: Microscope,
  },
  {
    value: 14,
    label: '14 fragmentos',
    caption: 'Cobertura integral',
    icon: Layers,
  },
];

const SOURCE_OPTIONS = [
  {
    value: 'Todas las fuentes',
    title: 'Todas',
    description: 'Cruce global sobre todo el corpus.',
    icon: Layers,
  },
  {
    value: 'Citizen Lab',
    title: 'Citizen Lab',
    description: 'Investigaciones Pegasus, Candiru y QuaDream.',
    icon: Shield,
  },
  {
    value: 'Amnesty Tech',
    title: 'Amnesty Tech',
    description: 'Metodología forense MVT y Predator.',
    icon: ShieldCheck,
  },
  {
    value: 'Google TAG',
    title: 'Google TAG',
    description: 'Análisis de cadenas 0-day y vendedores.',
    icon: Globe,
  },
];

const EMPTY_GOVERNANCE = {
  corpus_stats: null,
  indexed_sources: [],
};

function formatDateTag(rawDate) {
  if (!rawDate) return 'N/D';
  return String(rawDate).slice(0, 10);
}

function RadioDot({ selected }) {
  return (
    <span
      className={`h-4 w-4 rounded-full inline-flex items-center justify-center shrink-0 transition-all duration-150 ${
        selected
          ? 'bg-[#2F6FED] shadow-[0_0_0_2px_rgba(47,111,237,0.25)]'
          : 'border border-white/20 bg-black/30'
      }`}
    >
      {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
    </span>
  );
}

function TogglePill({ checked, disabled = false, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (!disabled && onChange) onChange(!checked);
      }}
      className={`w-10 h-[22px] rounded-full p-0.5 transition-colors duration-200 flex items-center shrink-0 ${
        checked
          ? 'bg-[#2F6FED] justify-end shadow-[inset_0_1px_1px_rgba(0,0,0,0.18)]'
          : 'bg-white/[0.14] justify-start'
      } ${disabled ? 'opacity-80 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className="h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.45)] transition-transform duration-200" />
    </button>
  );
}

export function SettingsPanel({
  topK = 6,
  onChangeTopK,
  sourceScope = 'Todas las fuentes',
  onChangeSourceScope,
  authSession = null,
  onOpenAuth,
  onLogout,
  onPanicPurge,
  initialSection = '',
  initialSectionKey = 0,
  onAiConfigured,
}) {
  const [activeSection, setActiveSection] = useState(initialSection || 'cuenta');
  const [gov, setGov] = useState(null);
  const [workspaceId, setWorkspaceId] = useState(() => getWorkspaceId());
  const [auditVerification, setAuditVerification] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [verifyingAudit, setVerifyingAudit] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'ANALYST',
  });
  const [invitingUser, setInvitingUser] = useState(false);

  const [savedTopK, setSavedTopK] = useState(topK);
  const [savedScope, setSavedScope] = useState(sourceScope);
  const [savedPassiveLinks, setSavedPassiveLinks] = useState(true);
  const [savedExplicitConsent, setSavedExplicitConsent] = useState(true);

  const [passiveLinks, setPassiveLinks] = useState(true);
  const [explicitConsent, setExplicitConsent] = useState(true);

  const [copiedId, setCopiedId] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  const [desktopAiConfig, setDesktopAiConfig] = useState(null);
  const [groqKeyDraft, setGroqKeyDraft] = useState('');
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [groqModelDraft, setGroqModelDraft] = useState('openai/gpt-oss-120b');
  const [omniEnabledDraft, setOmniEnabledDraft] = useState(false);
  const [omniKeyDraft, setOmniKeyDraft] = useState('');
  const [openAiKeyDraft, setOpenAiKeyDraft] = useState('');
  const [savingAiConfig, setSavingAiConfig] = useState(false);
  const [copiedEnvSnippet, setCopiedEnvSnippet] = useState(false);

  const cuentaRef = useRef(null);
  const iaRef = useRef(null);
  const ragRef = useRef(null);
  const permisosRef = useRef(null);
  const corpusRef = useRef(null);
  const scrollContainerRef = useRef(null);

  const isDesktopApp = Boolean(typeof window !== 'undefined' && window.omegaDesktop?.saveAiEngineConfig);

  useScrollReveal(scrollContainerRef, [activeSection, gov?.reports_count]);

  const [loadingGov, setLoadingGov] = useState(Boolean(authSession));
  const [govError, setGovError] = useState('');
  const [actionBanner, setActionBanner] = useState(null);
  const guard = useSingleFlight();

  useEffect(() => {
    if (!authSession) {
      return undefined;
    }

    let cancelled = false;
    const initTimer = setTimeout(() => {
      if (cancelled) return;
      setWorkspaceId(getWorkspaceId());
      setLoadingGov(true);
      fetchSystemGovernance()
        .then((data) => {
          if (cancelled) return;
          setGovError('');
          if (data) {
            setGov(data);
            if (data.workspace_id) setWorkspaceId(data.workspace_id);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setGov(null);
          setGovError(
            err?.message ||
              'No se pudo sincronizar la gobernanza desde el backend; verifica tu sesión activa.',
          );
        })
        .finally(() => {
          if (!cancelled) setLoadingGov(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(initTimer);
    };
  }, [authSession]);

  function handleRetryGovernance() {
    if (!authSession) {
      onOpenAuth?.('Conecta una sesión tenant para consultar el estado y trazabilidad en vivo.');
      return;
    }
    setLoadingGov(true);
    setGovError('');
    fetchSystemGovernance()
      .then((data) => {
        setGovError('');
        if (data) {
          setGov(data);
          if (data.workspace_id) setWorkspaceId(data.workspace_id);
        }
      })
      .catch((err) => {
        setGov(null);
        setGovError(
          err?.message ||
            'No se pudo sincronizar la gobernanza desde el backend; verifica tu sesión activa.',
        );
      })
      .finally(() => {
        setLoadingGov(false);
      });
  }

  async function handleVerifyAuditChain() {
    if (!authSession || verifyingAudit) return;
    await guard(async () => {
      setVerifyingAudit(true);
      setGovError('');
      try {
        const [verification, logs] = await Promise.all([
          verifyAuditChain(),
          fetchAuditLogs(10),
        ]);
        setAuditVerification(verification);
        setAuditLogs(Array.isArray(logs) ? logs : []);
        setActionBanner({
          tone: verification?.valid ? 'clean' : 'danger',
          message: verification?.valid
            ? `Cadena de auditoría íntegra (${verification.verifiedCount} de ${verification.totalEntries} eventos verificados por SHA-256).`
            : `Alerta de integridad: ${verification?.detail || 'Cadena inconsistente'}.`,
        });
      } catch (err) {
        setActionBanner({
          tone: 'danger',
          message: err?.message || 'No se pudo verificar la cadena de auditoría.',
        });
      } finally {
        setVerifyingAudit(false);
      }
    });
  }

  async function handleInviteSubmit(e) {
    e.preventDefault();
    if (invitingUser) return;
    const validation = validateTenantUserForm(inviteForm);
    if (!validation.valid) {
      setActionBanner({
        tone: 'danger',
        message: validation.firstError,
      });
      return;
    }
    await guard(async () => {
      setInvitingUser(true);
      try {
        const created = await createTenantUser(validation.sanitized);
        setActionBanner({
          tone: 'clean',
          message: `Usuario ${created.email} creado con rol ${created.role} dentro del tenant ${authSession?.tenantSlug}.`,
        });
        setInviteForm({ fullName: '', email: '', password: '', role: 'ANALYST' });
        setShowInviteForm(false);
      } catch (err) {
        setActionBanner({
          tone: 'danger',
          message: err?.message || 'No se pudo crear el usuario en el tenant.',
        });
      } finally {
        setInvitingUser(false);
      }
    });
  }

  function scrollToSection(id) {
    setActiveSection(id);
    const map = {
      cuenta: cuentaRef.current,
      ia: iaRef.current,
      rag: ragRef.current,
      permisos: permisosRef.current,
      corpus: corpusRef.current,
    };
    map[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  useEffect(() => {
    if (!initialSection) return;
    const t = setTimeout(() => scrollToSection(initialSection), 80);
    return () => clearTimeout(t);
  }, [initialSection, initialSectionKey]);

  useEffect(() => {
    const getCfg = window?.omegaDesktop?.getAiEngineConfig;
    if (typeof getCfg !== 'function') return;
    getCfg()
      .then((res) => {
        if (res?.ok && res.config) {
          setDesktopAiConfig(res.config);
          if (res.config.groqModel) setGroqModelDraft(res.config.groqModel);
          setOmniEnabledDraft(Boolean(res.config.omniRouteEnabled));
        }
      })
      .catch(() => {
        // Sin acceso IPC fuera de Electron
      });
  }, []);

  function openExternalLink(url) {
    if (typeof window?.omegaDesktop?.openExternalUrl === 'function') {
      void window.omegaDesktop.openExternalUrl(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function handleSaveAiEngine(e) {
    e?.preventDefault();
    if (!isDesktopApp || savingAiConfig) return;
    await guard(async () => {
      setSavingAiConfig(true);
      setActionBanner({
        tone: 'info',
        message: 'Guardando configuración y recargando el motor de IA (~5 segundos)...',
      });
      try {
        const res = await window.omegaDesktop.saveAiEngineConfig({
          groqApiKey: groqKeyDraft.trim(),
          groqModel: groqModelDraft,
          omniRouteEnabled: omniEnabledDraft,
          omniRouteApiKey: omniKeyDraft.trim(),
          openAiApiKey: openAiKeyDraft.trim(),
        });
        if (res?.config) {
          setDesktopAiConfig(res.config);
        }
        if (res?.ok) {
          setGroqKeyDraft('');
          setOmniKeyDraft('');
          setOpenAiKeyDraft('');
          setActionBanner({
            tone: 'clean',
            message: res.config?.configured
              ? `Motor de IA activo (${res.config.activeProvider} · ${res.config.activeModel}). Ya puedes consultar en el chat.`
              : 'Configuración guardada y servicio recargado.',
          });
          if (authSession) {
            const refreshed = await fetchSystemGovernance().catch(() => null);
            if (refreshed) setGov(refreshed);
          }
          onAiConfigured?.();
        } else {
          setActionBanner({
            tone: 'danger',
            message: res?.error || 'No se pudo recargar el motor de IA.',
          });
        }
      } catch (err) {
        setActionBanner({
          tone: 'danger',
          message: err?.message || 'Error guardando la configuración de IA.',
        });
      } finally {
        setSavingAiConfig(false);
      }
    });
  }

  function handleCopyEnvSnippet() {
    const cleanGroq = groqKeyDraft.trim() || 'gsk_tu_clave_gratuita_de_groq';
    const lines = [
      `GROQ_API_KEY=${cleanGroq}`,
      `GROQ_MODEL=${groqModelDraft}`,
    ];
    if (omniEnabledDraft) {
      lines.push('COMPOSE_PROFILES=omniroute');
      lines.push('OMNIROUTE_BASE_URL=http://omniroute:20128/v1');
      if (omniKeyDraft.trim()) lines.push(`OMNIROUTE_API_KEY=${omniKeyDraft.trim()}`);
    }
    navigator.clipboard?.writeText(lines.join('\n'));
    setCopiedEnvSnippet(true);
    setTimeout(() => setCopiedEnvSnippet(false), 1800);
  }

  async function handleCopyWorkspaceId() {
    try {
      await navigator.clipboard.writeText(displayWorkspaceId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1600);
    } catch {
      // Clipboard API unavailable
    }
  }

  async function handleRotateId() {
    await guard(async () => {
      const nextId = rotateWorkspaceId();
      setWorkspaceId(nextId);
      setRotated(true);
      try {
        if (authSession) {
          const refreshed = await fetchSystemGovernance();
          if (refreshed) setGov(refreshed);
        }
      } catch {
        // Offline fallback keeps new workspaceId locally
      } finally {
        setTimeout(() => setRotated(false), 1600);
      }
    });
  }

  function handleSaveChanges() {
    setSavedTopK(topK);
    setSavedScope(sourceScope);
    setSavedPassiveLinks(passiveLinks);
    setSavedExplicitConsent(explicitConsent);
    setSavedFeedback(true);
    setActionBanner({
      tone: 'clean',
      message: `Preferencias guardadas en sesión local (Top-${topK} · ${sourceScope}).`,
    });
    setTimeout(() => setSavedFeedback(false), 1800);
  }

  function handleDiscardChanges() {
    onChangeTopK?.(savedTopK);
    onChangeSourceScope?.(savedScope);
    setPassiveLinks(savedPassiveLinks);
    setExplicitConsent(savedExplicitConsent);
    setSavedFeedback(false);
    setActionBanner({
      tone: 'info',
      message: `Cambios descartados; se restauró la configuración guardada (Top-${savedTopK}).`,
    });
  }

  const effectiveGov = authSession ? (gov || EMPTY_GOVERNANCE) : EMPTY_GOVERNANCE;
  const displayWorkspaceId = authSession?.tenantId || workspaceId;
  const stats = effectiveGov.corpus_stats;
  const tenantStats = effectiveGov.tenant_stats || null;
  const sources = effectiveGov.indexed_sources || [];

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Barra superior segmentada (reemplaza cualquier menú lateral secundario) */}
      <div className="shrink-0 border-b border-white/[0.08] bg-[#0A0A0C]/65 px-3.5 sm:px-8 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
        <nav
          aria-label="Secciones de configuración"
          className="apple-segmented flex items-center gap-1 overflow-x-auto no-scrollbar w-full sm:w-auto max-w-full rounded-[11px] p-1"
        >
          {CONFIG_SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => scrollToSection(sec.id)}
                className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12.5px] shrink-0 active:scale-[0.97] transition-all duration-150 cursor-pointer ${
                  isActive
                    ? 'apple-segmented-active'
                    : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">{sec.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleDiscardChanges}
            className="text-[12.5px] text-[#9A9AA2] hover:text-[#F2F2F4] px-2 py-1 active:scale-[0.97] transition-all cursor-pointer"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={handleSaveChanges}
            className="tactile-key-primary rounded-[9px] px-3.5 py-1.5 text-[12.5px] font-medium inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer"
          >
            {savedFeedback ? (
              <>
                <Check className="h-3.5 w-3.5" />
                <span>Guardado</span>
              </>
            ) : (
              <span>Guardar cambios</span>
            )}
          </button>
        </div>
      </div>

      {/* Área Scrollable con despeje inferior para el Dock */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-3.5 sm:px-8 py-5 sm:py-6">
        <div className="animate-fade-up mx-auto max-w-[820px] space-y-8 pb-24">
          <h1 className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.025em] text-[#F2F2F4]">
            Configuración del espacio de trabajo
          </h1>

          {govError && (
            <PanelErrorBanner
              message={govError}
              onRetry={handleRetryGovernance}
              onDismiss={() => setGovError('')}
            />
          )}

          {Boolean(authSession) && loadingGov && (
            <PanelSkeleton
              label="Cargando estado del sistema y trazabilidad..."
              lines={3}
            />
          )}

          {actionBanner && (
            <ActionConfirmationBanner
              tone={actionBanner.tone}
              message={actionBanner.message}
              onDismiss={() => setActionBanner(null)}
            />
          )}

            {/* Bloque 1 — Cuenta Multi-Tenant JWT, Auditoría & Workspace */}
            <section ref={cuentaRef} className="animate-on-scroll space-y-3 scroll-mt-6" data-delay="0">
              <div>
                <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[#F2F2F4]">
                  Cuenta y espacio de trabajo
                </h2>
                <p className="mt-0.5 text-[12px] text-[#9A9AA2]">
                  Sesión aislada JWT y trazabilidad SHA-256.
                </p>
              </div>

              <div className="omega-glass-panel rounded-[13px] p-4 space-y-4">
                {authSession ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-[#30D158]" />
                          <span className="text-[13.5px] font-semibold text-[#F2F2F4]">
                            {authSession.tenantSlug}
                          </span>
                          <span className="font-tech rounded-full border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-2 py-0.5 text-[10.5px] text-[#F2F2F4]">
                            {authSession.role}
                          </span>
                        </div>
                        <div className="font-tech text-[12px] text-[#9A9AA2] break-all">
                          {authSession.email} · ID de espacio: {authSession.tenantId}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onOpenAuth?.('Cambia de cuenta o inicia sesión con otro correo.')}
                          className="inline-flex items-center gap-1.5 rounded-[8px] bg-white/[0.045] border border-white/[0.08] hover:bg-white/[0.09] px-3 py-1.5 text-[12px] text-[#F2F2F4] active:scale-[0.97] transition-all cursor-pointer"
                        >
                          <KeyRound className="h-3.5 w-3.5 text-[#2F6FED]" />
                          <span>Cambiar cuenta</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onLogout?.()}
                          className="inline-flex items-center gap-1.5 rounded-[8px] border border-white/[0.12] bg-white/[0.05] hover:bg-white/[0.1] px-3 py-1.5 text-[12px] text-[#F2F2F4] active:scale-[0.97] transition-all cursor-pointer"
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          <span>Cerrar sesión</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void onPanicPurge?.()}
                          className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#FF453A]/35 bg-[#FF453A]/10 hover:bg-[#FF453A]/20 px-3 py-1.5 text-[12px] text-[#FFDAD6] active:scale-[0.97] transition-all cursor-pointer"
                        >
                          <Lock className="h-3.5 w-3.5" />
                          <span>Purga rápida</span>
                        </button>
                      </div>
                    </div>

                    {tenantStats && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-white/[0.06]">
                        <div className="rounded-[9px] bg-black/25 border border-white/[0.06] px-3 py-2">
                          <div className="text-[11px] text-[#9A9AA2]">Espacios privados</div>
                          <div className="font-tech text-[15px] font-semibold text-[#F2F2F4]">
                            {Number(tenantStats.expedientes || 0)}
                          </div>
                        </div>
                        <div className="rounded-[9px] bg-black/25 border border-white/[0.06] px-3 py-2">
                          <div className="text-[11px] text-[#9A9AA2]">PDFs indexados</div>
                          <div className="font-tech text-[15px] font-semibold text-[#F2F2F4]">
                            {Number(tenantStats.documents || 0)}
                          </div>
                        </div>
                        <div className="rounded-[9px] bg-black/25 border border-white/[0.06] px-3 py-2">
                          <div className="text-[11px] text-[#9A9AA2]">Zero-Retention purgados</div>
                          <div className="font-tech text-[15px] font-semibold text-[#30D158]">
                            {Number(tenantStats.zero_retention_purged_pdfs || 0)}
                          </div>
                        </div>
                        <div className="rounded-[9px] bg-black/25 border border-white/[0.06] px-3 py-2">
                          <div className="text-[11px] text-[#9A9AA2]">Activos OSINT</div>
                          <div className="font-tech text-[15px] font-semibold text-[#F2F2F4]">
                            {Number(tenantStats.osint_assets || 0)}
                          </div>
                        </div>
                      </div>
                    )}

                    {authSession.role === 'ADMIN' && (
                      <div className="pt-3 border-t border-white/[0.06] space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={verifyingAudit}
                            onClick={handleVerifyAuditChain}
                            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] hover:border-[#2F6FED]/75 hover:shadow-[0_0_24px_rgba(47,111,237,0.25)] px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] disabled:opacity-50 cursor-pointer transition-all"
                          >
                            <FileCheck2 className={`h-3.5 w-3.5 ${verifyingAudit ? 'animate-pulse' : ''}`} />
                            <span>
                              {verifyingAudit ? 'Verificando SHA-256...' : 'Verificar cadena de auditoría'}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setShowInviteForm((v) => !v)}
                            className="inline-flex items-center gap-1.5 rounded-[8px] bg-white/[0.045] border border-white/[0.08] hover:bg-white/[0.09] px-3 py-1.5 text-[12px] text-[#F2F2F4] cursor-pointer transition-colors"
                          >
                            <UserPlus className="h-3.5 w-3.5 text-[#30D158]" />
                            <span>Crear analista / cliente</span>
                          </button>
                        </div>

                        {showInviteForm && (
                          <form
                            noValidate
                            onSubmit={handleInviteSubmit}
                            className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 rounded-[10px] border border-white/[0.08] bg-black/25 p-3"
                          >
                            <input
                              type="text"
                              required
                              minLength={2}
                              maxLength={120}
                              value={inviteForm.fullName}
                              onChange={(e) => {
                                setInviteForm((f) => ({
                                  ...f,
                                  fullName: stripUnsafeChars(e.target.value, 120),
                                }));
                                if (actionBanner?.tone === 'danger') setActionBanner(null);
                              }}
                              placeholder="Nombre completo"
                              className="h-8 rounded-[7px] border border-white/[0.1] bg-[#141418] px-2.5 text-[12px] text-[#F2F2F4] placeholder-[#9A9AA2]"
                            />
                            <input
                              type="email"
                              required
                              maxLength={254}
                              value={inviteForm.email}
                              onChange={(e) => {
                                setInviteForm((f) => ({
                                  ...f,
                                  email: stripUnsafeChars(e.target.value, 254),
                                }));
                                if (actionBanner?.tone === 'danger') setActionBanner(null);
                              }}
                              placeholder="usuario@organizacion.org"
                              className="h-8 rounded-[7px] border border-white/[0.1] bg-[#141418] px-2.5 text-[12px] text-[#F2F2F4] placeholder-[#9A9AA2]"
                            />
                            <input
                              type="password"
                              required
                              minLength={12}
                              maxLength={128}
                              value={inviteForm.password}
                              onChange={(e) => {
                                setInviteForm((f) => ({
                                  ...f,
                                  password: stripUnsafeChars(e.target.value, 128),
                                }));
                                if (actionBanner?.tone === 'danger') setActionBanner(null);
                              }}
                              placeholder="Contraseña inicial (mín. 12 caracteres)"
                              className="h-8 rounded-[7px] border border-white/[0.1] bg-[#141418] px-2.5 text-[12px] text-[#F2F2F4] placeholder-[#9A9AA2]"
                            />
                            <div className="flex items-center gap-2">
                              <select
                                aria-label="Rol del nuevo usuario"
                                value={inviteForm.role}
                                onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value }))}
                                className="h-8 flex-1 rounded-[7px] border border-white/[0.1] bg-[#141418] px-2 text-[12px] text-[#F2F2F4]"
                              >
                                <option value="ANALYST">ANALYST (forense + CTI)</option>
                                <option value="CLIENT">CLIENT (lectura + IOCs)</option>
                                <option value="ADMIN">ADMIN (gestión total)</option>
                              </select>
                              <button
                                type="submit"
                                disabled={invitingUser}
                                className="h-8 rounded-[7px] bg-[#2F6FED] hover:bg-[#2F6FED]/90 px-3 text-[12px] font-medium text-white disabled:opacity-50 cursor-pointer"
                              >
                                {invitingUser ? '...' : 'Añadir'}
                              </button>
                            </div>
                          </form>
                        )}

                        {auditVerification && (
                          <div className="space-y-2 rounded-[10px] border border-white/[0.08] bg-black/25 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                              <span
                                className={`font-semibold ${
                                  auditVerification.valid ? 'text-[#30D158]' : 'text-[#FF453A]'
                                }`}
                              >
                                {auditVerification.valid ? 'Integridad SHA-256 verificada' : 'Ruptura de cadena detectada'}
                              </span>
                              <span className="font-tech text-[11px] text-[#9A9AA2]">
                                {auditVerification.verifiedCount}/{auditVerification.totalEntries} eventos ·{' '}
                                {auditVerification.detail}
                              </span>
                            </div>
                            {auditLogs.length > 0 && (
                              <div className="max-h-40 overflow-y-auto divide-y divide-white/[0.05]">
                                {auditLogs.map((ev) => (
                                  <div
                                    key={ev.id}
                                    className="py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-tech"
                                  >
                                    <span className="text-[#F2F2F4]">
                                      #{ev.chainSeq} · {ev.action} ({ev.resourceType})
                                    </span>
                                    <span className="text-[#9A9AA2]">
                                      {String(ev.currentHash || '').slice(0, 14)}… · {formatDateTag(ev.createdAt)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-2 text-[13.5px] font-medium text-[#F2F2F4]">
                        <Lock className="h-4 w-4 text-[#2F6FED]" />
                        <span>Sin cuenta conectada</span>
                      </div>
                      <p className="text-[12px] text-[#9A9AA2]">
                        Inicia sesión o regístrate para habilitar PDFs privados Zero-Retention, monitoreo OSINT y triaje forense.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenAuth?.('Inicia sesión o crea una cuenta para sincronizar tu biblioteca privada y OSINT.')}
                      className="tactile-key-primary inline-flex items-center gap-1.5 rounded-[9px] px-3.5 py-2 text-[12.5px] font-medium cursor-pointer"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      <span>Iniciar sesión / Registrarse</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="apple-group rounded-[13px] p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] text-[#9A9AA2]">
                    {authSession ? 'Tenant / Workspace ID activo' : 'ID local provisional'}
                  </div>
                  <div className="font-tech mt-1 text-[13px] text-[#F2F2F4] break-all">
                    {displayWorkspaceId}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCopyWorkspaceId}
                    className="inline-flex items-center gap-1.5 rounded-[8px] bg-white/[0.045] border border-white/[0.08] hover:bg-white/[0.09] px-3 py-1.5 text-[12px] text-[#F2F2F4] active:scale-[0.97] transition-all cursor-pointer"
                  >
                    {copiedId ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#2F6FED]" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-[#9A9AA2]" />
                        <span>Copiar ID</span>
                      </>
                    )}
                  </button>

                  {!authSession && (
                    <button
                      type="button"
                      onClick={handleRotateId}
                      className="inline-flex items-center gap-1.5 rounded-[8px] bg-white/[0.045] border border-white/[0.08] hover:bg-white/[0.09] px-3 py-1.5 text-[12px] text-[#F2F2F4] active:scale-[0.97] transition-all cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-[#9A9AA2]" />
                      <span>{rotated ? 'Rotado' : 'Rotar ID'}</span>
                    </button>
                  )}
                </div>
              </div>
            </section>

            {/* Bloque 2 — Configuración del Motor de IA (Groq gratis paso a paso) */}
            <section ref={iaRef} className="animate-on-scroll space-y-3 scroll-mt-6" data-delay="30">
              {(() => {
                const govAi = gov?.ai_engine || null;
                const aiConfigured = Boolean(desktopAiConfig ? desktopAiConfig.configured : govAi?.configured);
                const activeProvider = desktopAiConfig?.activeProvider || govAi?.active_provider || 'extractive';
                const activeModel = desktopAiConfig?.activeModel || govAi?.active_model || 'omega-extractive-fallback';
                return (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[#F2F2F4]">
                          Motor de IA para el asistente
                        </h2>
                        <p className="mt-0.5 text-[12px] text-[#9A9AA2]">
                          Sin una clave de IA, el chat solo muestra fragmentos literales. Con Groq gratuito responde en ~2 segundos.
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                          aiConfigured
                            ? 'border-[#30D158]/35 bg-[#30D158]/10 text-[#30D158]'
                            : 'border-[#FF9F0A]/40 bg-[#FF9F0A]/12 text-[#FFD60A]'
                        }`}
                      >
                        {aiConfigured ? `Activo · ${activeProvider} (${activeModel})` : 'Sin clave · Modo extractivo'}
                      </span>
                    </div>

                    <form onSubmit={handleSaveAiEngine} className="apple-group rounded-[13px] p-4 sm:p-5 space-y-4">
                      {/* Guía paso a paso */}
                      <div className="rounded-[11px] border border-white/[0.08] bg-black/25 p-3.5 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[12.5px] font-semibold text-[#F2F2F4]">
                            Cómo obtener tu clave gratuita de Groq en 1 minuto
                          </span>
                          <button
                            type="button"
                            onClick={() => openExternalLink('https://console.groq.com/keys')}
                            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#2F6FED]/50 bg-[#2F6FED]/15 hover:bg-[#2F6FED]/25 px-2.5 py-1 text-[11.5px] font-medium text-[#F2F2F4] transition-colors cursor-pointer"
                          >
                            <span>Abrir Groq Console</span>
                            <ExternalLink className="h-3 w-3 text-[#6EA0FF]" />
                          </button>
                        </div>
                        <ol className="space-y-1 text-[12px] text-[#B8C0D0] list-decimal list-inside leading-relaxed">
                          <li>Haz clic en <strong>Abrir Groq Console</strong> e inicia sesión gratis con tu cuenta de Google o GitHub (no pide tarjeta).</li>
                          <li>Entra en <strong>API Keys → Create API Key</strong>, pon cualquier nombre (ej. <code className="font-tech text-[#F2F2F4]">omega</code>) y copia la clave que empieza por <code className="font-tech text-[#F2F2F4]">gsk_</code>.</li>
                          <li>Pégala aquí abajo y pulsa <strong>Guardar y activar IA</strong>.</li>
                        </ol>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-[1.35fr_1fr] gap-3">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label htmlFor="omega-groq-key" className="text-[12px] font-medium text-[#D2D6E2]">
                              Clave API de Groq
                            </label>
                            {desktopAiConfig?.groqConfigured && (
                              <span className="font-tech text-[10.5px] text-[#30D158]">
                                Guardada ({desktopAiConfig.groqHint})
                              </span>
                            )}
                          </div>
                          <div className="relative flex items-center">
                            <input
                              id="omega-groq-key"
                              type={showGroqKey ? 'text' : 'password'}
                              value={groqKeyDraft}
                              onChange={(e) => setGroqKeyDraft(e.target.value)}
                              placeholder={
                                desktopAiConfig?.groqConfigured
                                  ? 'Deja vacío para conservar la clave guardada o pega una nueva'
                                  : 'gsk_...'
                              }
                              className="w-full h-9.5 pl-3 pr-10 rounded-[9px] bg-[#0A0A0C]/75 border border-white/[0.1] text-[12.5px] font-tech text-[#F2F2F4] placeholder:text-[#8E96AB] focus:outline-none focus:border-[#2F6FED]"
                            />
                            <button
                              type="button"
                              aria-label={showGroqKey ? 'Ocultar clave' : 'Mostrar clave'}
                              onClick={() => setShowGroqKey((v) => !v)}
                              className="absolute right-2.5 text-[#9A9AA2] hover:text-[#F2F2F4] cursor-pointer"
                            >
                              {showGroqKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>

                        <div>
                          <label htmlFor="omega-groq-model" className="block text-[12px] font-medium text-[#D2D6E2] mb-1">
                            Modelo en Groq
                          </label>
                          <select
                            id="omega-groq-model"
                            value={groqModelDraft}
                            onChange={(e) => setGroqModelDraft(e.target.value)}
                            className="w-full h-9.5 px-3 rounded-[9px] bg-[#0A0A0C]/75 border border-white/[0.1] text-[12.5px] text-[#F2F2F4] focus:outline-none focus:border-[#2F6FED]"
                          >
                            {GROQ_MODELS.map((m) => (
                              <option key={m.value} value={m.value} className="bg-[#121216] text-[#F2F2F4]">
                                {m.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Opciones avanzadas colapsables: OmniRoute / OpenAI */}
                      <details className="rounded-[10px] border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5">
                        <summary className="text-[12px] font-medium text-[#B8C0D0] hover:text-[#F2F2F4] cursor-pointer select-none">
                          Opciones avanzadas: OmniRoute (multi-proveedor) u OpenAI
                        </summary>
                        <div className="pt-3 space-y-3 border-t border-white/[0.06] mt-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="space-y-0.5">
                              <div className="text-[12.5px] font-medium text-[#F2F2F4]">
                                Activar router OmniRoute local
                              </div>
                              <p className="text-[11.5px] text-[#9A9AA2]">
                                Combina varias cuentas/APIs gratuitas con respaldo automático hacia Groq.
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {omniEnabledDraft && (
                                <button
                                  type="button"
                                  onClick={() => openExternalLink(desktopAiConfig?.omniRouteDashboardUrl || 'http://127.0.0.1:20128/dashboard')}
                                  className="inline-flex items-center gap-1 rounded-[7px] border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] px-2.5 py-1 text-[11px] text-[#F2F2F4] cursor-pointer"
                                >
                                  <span>Abrir dashboard</span>
                                  <ExternalLink className="h-3 w-3" />
                                </button>
                              )}
                              <TogglePill
                                checked={omniEnabledDraft}
                                onChange={setOmniEnabledDraft}
                                label="Activar router OmniRoute local"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label htmlFor="omega-omni-key" className="block text-[11.5px] text-[#9A9AA2] mb-1">
                                Clave de OmniRoute {desktopAiConfig?.omniRouteKeyConfigured ? `(${desktopAiConfig.omniRouteHint})` : '(opcional)'}
                              </label>
                              <input
                                id="omega-omni-key"
                                type="password"
                                value={omniKeyDraft}
                                onChange={(e) => setOmniKeyDraft(e.target.value)}
                                placeholder="sk-... generada en OmniRoute"
                                className="w-full h-9 px-3 rounded-[8px] bg-[#0A0A0C]/75 border border-white/[0.09] text-[12px] font-tech text-[#F2F2F4] placeholder:text-[#8E96AB] focus:outline-none focus:border-[#2F6FED]"
                              />
                            </div>
                            <div>
                              <label htmlFor="omega-openai-key" className="block text-[11.5px] text-[#9A9AA2] mb-1">
                                Clave OpenAI {desktopAiConfig?.openAiConfigured ? `(${desktopAiConfig.openAiHint})` : '(opcional)'}
                              </label>
                              <input
                                id="omega-openai-key"
                                type="password"
                                value={openAiKeyDraft}
                                onChange={(e) => setOpenAiKeyDraft(e.target.value)}
                                placeholder="sk-..."
                                className="w-full h-9 px-3 rounded-[8px] bg-[#0A0A0C]/75 border border-white/[0.09] text-[12px] font-tech text-[#F2F2F4] placeholder:text-[#8E96AB] focus:outline-none focus:border-[#2F6FED]"
                              />
                            </div>
                          </div>
                        </div>
                      </details>

                      {isDesktopApp ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                          <span className="text-[11.5px] text-[#9A9AA2]">
                            Se guarda cifrado localmente en tu equipo (<code className="font-tech">.env</code>) sin enviarse a terceros distintos al proveedor elegido.
                          </span>
                          <button
                            type="submit"
                            disabled={savingAiConfig}
                            className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#2F6FED] hover:brightness-110 disabled:opacity-55 px-4 py-2 text-[12.5px] font-medium text-white transition-all cursor-pointer"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            <span>{savingAiConfig ? 'Aplicando y recargando...' : 'Guardar y activar IA'}</span>
                          </button>
                        </div>
                      ) : (
                        <div className="rounded-[10px] border border-white/[0.08] bg-black/30 p-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[#B8C0D0]">
                            <span>Estás usando la versión web; agrega estas líneas en <code className="font-tech text-[#F2F2F4]">omega/.env</code> y reinicia el backend:</span>
                            <button
                              type="button"
                              onClick={handleCopyEnvSnippet}
                              className="inline-flex items-center gap-1 rounded-[7px] border border-white/[0.1] bg-white/[0.05] hover:bg-white/[0.1] px-2.5 py-1 text-[11px] text-[#F2F2F4] cursor-pointer"
                            >
                              {copiedEnvSnippet ? <Check className="h-3 w-3 text-[#30D158]" /> : <Copy className="h-3 w-3" />}
                              <span>{copiedEnvSnippet ? 'Copiado' : 'Copiar .env'}</span>
                            </button>
                          </div>
                          <pre className="font-tech text-[11px] text-[#9A9AA2] overflow-x-auto">
                            docker compose -f omega/docker-compose.yml up -d backend-java
                          </pre>
                        </div>
                      )}
                    </form>
                  </>
                );
              })()}
            </section>

            {/* Bloque 3 — Profundidad de Recuperación RAG */}
            <section ref={ragRef} className="animate-on-scroll space-y-3 scroll-mt-6" data-delay="50">
              <div>
                <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[#F2F2F4]">
                  Alcance de evidencia (<span className="font-tech">Top-K</span>)
                </h2>
                <p className="mt-1 text-[12.5px] text-[#9A9AA2]">
                  Define cuántos fragmentos documentales evalúa el motor híbrido RRF antes de redactar cada respuesta.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {TOPK_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const selected = topK === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onChangeTopK?.(opt.value)}
                      className={`relative rounded-[13px] border p-4 text-left hover:-translate-y-0.5 active:scale-[0.985] transition-all duration-150 cursor-pointer ${
                        selected
                          ? 'bg-[rgba(28,36,56,0.65)] border-[#2F6FED]/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_0_24px_rgba(47,111,237,0.22)]'
                          : 'apple-group hover:border-white/[0.15]'
                      }`}
                    >
                      <div className="absolute top-3.5 left-3.5">
                        <RadioDot selected={selected} />
                      </div>

                      <div className="pt-4 pb-1 flex flex-col items-center text-center">
                        <Icon
                          className={`h-[19px] w-[19px] mb-2 ${
                            selected ? 'text-[#2F6FED]' : 'text-[#9A9AA2]'
                          }`}
                        />
                        <div className="font-tech text-[12.5px] font-medium text-[#F2F2F4]">
                          {opt.label}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-[#9A9AA2]">
                          {opt.caption}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Bloque 3 — Prioridad de Corpus CTI */}
            <section className="animate-on-scroll space-y-3" data-delay="90">
              <div>
                <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[#F2F2F4]">
                  Fuentes prioritarias
                </h2>
                <p className="mt-0.5 text-[12px] text-[#9A9AA2]">
                  Prioridad documental en tus consultas.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {SOURCE_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const selected = sourceScope === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onChangeSourceScope?.(opt.value)}
                      className={`relative rounded-[13px] border p-3.5 text-left hover:-translate-y-0.5 active:scale-[0.985] transition-all duration-150 cursor-pointer ${
                        selected
                          ? 'bg-[rgba(28,36,56,0.65)] border-[#2F6FED]/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_0_24px_rgba(47,111,237,0.22)]'
                          : 'apple-group hover:border-white/[0.15]'
                      }`}
                    >
                      <div className="absolute top-3 left-3">
                        <RadioDot selected={selected} />
                      </div>

                      <div className="pt-4 flex flex-col items-center text-center">
                        <Icon
                          className={`h-[18px] w-[18px] mb-1.5 ${
                            selected ? 'text-[#2F6FED]' : 'text-[#9A9AA2]'
                          }`}
                        />
                        <div className="text-[13px] font-semibold text-[#F2F2F4]">
                          {opt.title}
                        </div>
                        <p className="mt-1 text-[11.5px] text-[#9A9AA2] leading-snug line-clamp-2">
                          {opt.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Bloque 4 — Permisos y Garantías Éticas */}
            <section ref={permisosRef} className="animate-on-scroll space-y-3 scroll-mt-6" data-delay="120">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[#F2F2F4]">
                  Privacidad y permisos
                </h2>
                <span className="text-[11px] text-[#9A9AA2]">
                  Procesamiento temporal en memoria
                </span>
              </div>

              <div className="apple-group rounded-[13px] divide-y divide-white/[0.06] overflow-hidden">
                <div className="p-4 flex items-center justify-between gap-3 sm:gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium text-[#F2F2F4]">
                        Procesamiento en memoria (RAM)
                      </span>
                      <span className="rounded-full bg-[rgba(28,36,56,0.65)] border border-[#2F6FED]/45 px-2.5 py-0.5 text-[10.5px] font-medium text-[#F2F2F4]">
                        Activo
                      </span>
                    </div>
                    <p className="text-[12px] text-[#9A9AA2]">
                      Analiza respaldos en memoria sin escribir copias en disco.
                    </p>
                  </div>

                  <TogglePill
                    checked={true}
                    disabled={true}
                    label="Procesamiento forense volátil obligatorio"
                  />
                </div>

                <div className="p-4 flex items-center justify-between gap-3 sm:gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[13.5px] font-medium text-[#F2F2F4]">
                      Inspección pasiva de enlaces
                    </div>
                    <p className="text-[12px] text-[#9A9AA2]">
                      Verifica URLs sin establecer conexión con el destino.
                    </p>
                  </div>

                  <TogglePill
                    checked={passiveLinks}
                    onChange={setPassiveLinks}
                    label="Inspección pasiva de enlaces"
                  />
                </div>

                <div className="p-4 flex items-center justify-between gap-3 sm:gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[13.5px] font-medium text-[#F2F2F4]">
                      Confirmación previa en auditorías de dominio
                    </div>
                    <p className="text-[12px] text-[#9A9AA2]">
                      Solicita autorización explícita antes de consultar un dominio o correo.
                    </p>
                  </div>

                  <TogglePill
                    checked={explicitConsent}
                    onChange={setExplicitConsent}
                    label="Consentimiento explícito OSINT"
                  />
                </div>

                <div className="p-4 flex items-center justify-between gap-3 sm:gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[13.5px] font-medium text-[#F2F2F4]">
                      Recomendación: cifrado de disco del equipo
                    </div>
                    <p className="text-[12px] text-[#9A9AA2]">
                      OMEGA no guarda contraseñas ni conversaciones en el navegador; activa BitLocker, FileVault o LUKS para proteger también tu sistema.
                    </p>
                  </div>

                  <span className="shrink-0 rounded-full border border-[#30D158]/35 bg-[#30D158]/10 px-2.5 py-0.5 text-[10.5px] font-medium text-[#30D158]">
                    Sin caché local
                  </span>
                </div>
              </div>
            </section>

            {/* Bloque 5 — Trazabilidad del Corpus Indexado */}
            <section ref={corpusRef} className="animate-on-scroll space-y-3 scroll-mt-6" data-delay="150">
              <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-[#9A9AA2] shrink-0" />
                  <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[#F2F2F4]">
                    Documentos e informes indexados
                  </h2>
                </div>

                <span className="font-tech rounded-full bg-[rgba(28,36,56,0.65)] border border-[#2F6FED]/45 px-3 py-1 text-[11px] text-[#F2F2F4]">
                  {stats
                    ? `${stats.reports} Reportes · ${stats.chunks} Fragmentos · ${Number(stats.iocs || 0).toLocaleString('en-US')} IOCs · Corte ${effectiveGov.catalog_freshness?.catalog_cutoff_date || '2024-12-16'}`
                    : 'Sesión requerida para métricas en vivo'}
                </span>
              </div>

              <div className="apple-group rounded-[13px] divide-y divide-white/[0.06] max-h-56 overflow-y-auto">
                {sources.length > 0 ? (
                  sources.map((rep, idx) => (
                    <div
                      key={`${rep.title}-${idx}`}
                      className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4"
                    >
                      <span className="text-[12.5px] text-[#F2F2F4] break-words sm:truncate">
                        {rep.title}
                      </span>

                      <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
                        <span className="text-[11.5px] sm:text-[12px] text-[#9A9AA2]">
                          {rep.organization}
                        </span>
                        <span className="font-tech text-[11px] text-[#9A9AA2]">
                          {formatDateTag(rep.ingested_at || rep.publication_date)}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-4 flex items-center justify-between gap-3 text-[12px] text-[#9A9AA2]">
                    <span>
                      {authSession
                        ? 'Sin fuentes indexadas en PostgreSQL.'
                        : 'Inicia sesión para consultar las fuentes indexadas.'}
                    </span>
                    {!authSession && (
                      <button
                        type="button"
                        onClick={() => onOpenAuth?.('Inicia sesión para consultar el corpus CTI.')}
                        className="inline-flex items-center gap-1 rounded-[7px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] hover:border-[#2F6FED]/75 px-2.5 py-1 text-[11.5px] text-[#F2F2F4] cursor-pointer"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>Entrar</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <OmegaWebIntelCard
                compact
                title="Ingesta web CTI (RAM)"
                subtitle="Extrae IPs, dominios y CVEs de una URL técnica en memoria."
              />
            </section>
        </div>
      </div>
    </div>
  );
}
