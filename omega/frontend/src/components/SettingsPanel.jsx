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
  approveCorpusCandidate,
  createTenantUser,
  fetchApiHealth,
  fetchAuditLogs,
  fetchCorpusDiscovery,
  fetchSystemGovernance,
  getWorkspaceId,
  rejectCorpusCandidate,
  rotateWorkspaceId,
  scanCorpusDiscovery,
  testAiEngineConnection,
  verifyAuditChain,
} from '../lib/api';
import { stripUnsafeChars, validateTenantUserForm } from '../lib/validators';
import {
  getDesktopRuntimeConfig,
  isDesktopApp as checkIsDesktopApp,
  saveDesktopRuntimeConfig,
} from '../lib/desktopBridge';
import { useSingleFlight } from '../lib/useSingleFlight';
import { useScrollReveal } from '../lib/useScrollReveal';
import { OmegaWebIntelCard } from './OmegaWebIntelCard';
import { TwoFactorSettingsCard } from './TwoFactorSettingsCard';
import { RecoveryKeyCard } from './RecoveryKeyCard';
import {
  ActionConfirmationBanner,
  PanelErrorBanner,
  PanelSkeleton,
} from './PanelStatePrimitives';

const CONFIG_SECTIONS = [
  {
    id: 'cuenta',
    group: 'CUENTA',
    label: 'Mi perfil y sesión',
    subtitle: 'Sesión aislada JWT, verificación 2FA y cadena de auditoría SHA-256.',
    icon: Shield,
  },
  {
    id: 'ia',
    group: 'ESPACIO DE TRABAJO',
    label: 'Motor de IA',
    subtitle: 'Proveedor LLM activo (Groq, Ollama local, Gemini, OpenAI o router).',
    icon: Sparkles,
  },
  {
    id: 'rag',
    group: 'ESPACIO DE TRABAJO',
    label: 'Motor RAG',
    subtitle: 'Profundidad de recuperación Top-K y prioridad de fuentes CTI.',
    icon: Layers,
  },
  {
    id: 'permisos',
    group: 'ESPACIO DE TRABAJO',
    label: 'Permisos y ética',
    subtitle: 'Garantías defensivas, enlaces pasivos y consentimiento explícito.',
    icon: ShieldCheck,
  },
  {
    id: 'corpus',
    group: 'ESPACIO DE TRABAJO',
    label: 'Corpus indexado',
    subtitle: 'Documentos e informes CTI verificados e ingesta web en memoria.',
    icon: Database,
  },
];

const AI_PROVIDER_PRESETS = [
  {
    id: 'groq',
    label: 'Groq (Por defecto)',
    badge: 'Gratis · ~2s',
    baseUrl: 'https://api.groq.com/openai/v1',
    baseUrlEditable: false,
    keyRequired: true,
    keyPlaceholder: 'gsk_...',
    defaultModel: 'openai/gpt-oss-120b',
    suggestedModels: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    docsUrl: 'https://console.groq.com/keys',
    docsLabel: 'Abrir Groq Console',
    summary: 'Opción recomendada por defecto: rápida y con plan gratuito sin tarjeta.',
    steps: [
      'Haz clic en Abrir Groq Console e inicia sesión con Google o GitHub.',
      'Entra en API Keys → Create API Key y copia la clave que empieza por gsk_.',
      'Pégala aquí abajo y pulsa Guardar y activar IA.',
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    badge: 'Sin API Key',
    baseUrl: 'http://host.docker.internal:11434/v1',
    baseUrlEditable: true,
    keyRequired: false,
    keyPlaceholder: 'No requiere API key en Ollama local',
    defaultModel: 'qwen2.5:14b',
    suggestedModels: ['qwen2.5:14b', 'llama3.2', 'qwen2.5:7b', 'mistral'],
    docsUrl: 'https://ollama.com',
    docsLabel: 'Ver modelos Ollama',
    summary: '100% local en tu PC, sin internet ni cuentas externas (requiere tener Ollama ejecutándose).',
    steps: [
      'Prepara Ollama sin funciones cloud y descarga antes los modelos bge-m3, qwen2.5:14b y qwen2.5vl:7b.',
      'Usa Ollama en este equipo. No se admiten servidores remotos en Modo Soberano.',
      'Guardar activa los tres modelos locales y deshabilita consultas externas. Los documentos existentes requieren reindexación.',
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    badge: 'Google AI',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    baseUrlEditable: false,
    keyRequired: true,
    keyPlaceholder: 'AIza...',
    defaultModel: 'gemini-2.5-flash',
    suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    docsUrl: 'https://aistudio.google.com/apikey',
    docsLabel: 'Abrir Google AI Studio',
    summary: 'Usa tu propia clave de Gemini desde Google AI Studio mediante compatibilidad OpenAI.',
    steps: [
      'Abre Google AI Studio → Get API key y genera una clave (empieza por AIza...).',
      'Pégala aquí y selecciona gemini-2.5-flash o gemini-2.5-pro.',
      'Pulsa Probar conexión y luego Guardar y activar IA.',
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    badge: 'Multi-modelo',
    baseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEditable: false,
    keyRequired: true,
    keyPlaceholder: 'sk-or-v1-...',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    suggestedModels: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemma-3-27b-it:free'],
    docsUrl: 'https://openrouter.ai/keys',
    docsLabel: 'Abrir OpenRouter Keys',
    summary: 'Unifica decenas de modelos comerciales y gratuitos con una sola clave.',
    steps: [
      'Genera una clave en openrouter.ai/keys.',
      'Elige el identificador completo del modelo (o añade :free para tier gratuito).',
      'Prueba conexión y pulsa Guardar y activar IA.',
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    badge: 'ChatGPT API',
    baseUrl: 'https://api.openai.com/v1',
    baseUrlEditable: false,
    keyRequired: true,
    keyPlaceholder: 'sk-...',
    defaultModel: 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1'],
    docsUrl: 'https://platform.openai.com/api-keys',
    docsLabel: 'Abrir OpenAI Platform',
    summary: 'Usa tu propia clave de OpenAI tanto para el asistente como para embeddings vectoriales.',
    steps: [
      'Copia tu clave secreta desde platform.openai.com/api-keys.',
      'Selecciona gpt-4o-mini o el modelo de tu preferencia.',
      'Prueba conexión y pulsa Guardar y activar IA.',
    ],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    badge: 'Local',
    baseUrl: 'http://host.docker.internal:1234/v1',
    baseUrlEditable: true,
    keyRequired: false,
    keyPlaceholder: 'Opcional (ej. lm-studio)',
    defaultModel: 'local-model',
    suggestedModels: ['local-model'],
    docsUrl: 'https://lmstudio.ai',
    docsLabel: 'Abrir LM Studio',
    summary: 'Conecta el servidor local OpenAI-compatible de LM Studio en el puerto 1234.',
    steps: [
      'En LM Studio, carga un modelo y activa Local Server (Start Server en puerto 1234).',
      'Verifica que CORS / Network access permita conexiones locales.',
      'Pulsa Probar conexión para listar el modelo activo y guarda.',
    ],
  },
  {
    id: 'omniroute',
    label: 'OmniRoute',
    badge: 'Auto-Router',
    baseUrl: 'http://omniroute:20128/v1',
    baseUrlEditable: false,
    keyRequired: false,
    keyPlaceholder: 'sk-... generada en OmniRoute (opcional)',
    defaultModel: 'auto',
    suggestedModels: ['auto'],
    docsUrl: 'http://127.0.0.1:20128/dashboard',
    docsLabel: 'Abrir dashboard OmniRoute',
    summary: 'Router multi-cuenta integrado en Docker con fallback automático de cuotas.',
    steps: [
      'Activa OmniRoute guardando esta opción o visita http://127.0.0.1:20128/dashboard.',
      'Conecta ahí tus cuentas/llaves y copia el token de Endpoints si activaste autenticación.',
      'Deja el modelo en auto para balancear automáticamente.',
    ],
  },
  {
    id: 'custom',
    label: 'API personalizada',
    badge: 'Cualquier /v1',
    baseUrl: '',
    baseUrlEditable: true,
    keyRequired: false,
    keyPlaceholder: 'Bearer token (opcional si es red interna)',
    defaultModel: '',
    suggestedModels: [],
    docsUrl: '',
    docsLabel: '',
    summary: 'Conecta cualquier servidor privado, vLLM, LiteLLM, Azure o API compatible con /v1/chat/completions.',
    steps: [
      'Ingresa la URL base hasta el prefijo de API (ej. https://tu-servidor.com/v1).',
      'Escribe el nombre exacto del modelo y tu token si el endpoint lo exige.',
      'Usa Probar conexión antes de guardar para confirmar respuesta.',
    ],
  },
];

function findAiPreset(id) {
  return AI_PROVIDER_PRESETS.find((p) => p.id === id) || AI_PROVIDER_PRESETS[0];
}

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

function SplitRow({ title, description, children, className = '' }) {
  return (
    <div className={`py-7 border-b border-white/[0.07] grid grid-cols-1 lg:grid-cols-12 gap-6 ${className}`}>
      <div className="lg:col-span-4 space-y-1">
        <h2 className="text-sm font-medium text-white">{title}</h2>
        {description && (
          <p className="text-xs text-[#8E95A5] leading-relaxed">{description}</p>
        )}
      </div>
      <div className="lg:col-span-8 min-w-0">{children}</div>
    </div>
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
  embedded = false,
  saveTrigger = 0,
  onSavedFeedback,
}) {
  const [activeSection, setActiveSection] = useState(initialSection || 'cuenta');
  const [gov, setGov] = useState(null);
  const [discoveryQueue, setDiscoveryQueue] = useState([]);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
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
  const [aiProviderDraft, setAiProviderDraft] = useState('groq');
  const [aiBaseUrlDraft, setAiBaseUrlDraft] = useState('https://api.groq.com/openai/v1');
  const [aiKeyDraft, setAiKeyDraft] = useState('');
  const [showAiKey, setShowAiKey] = useState(false);
  const [aiModelDraft, setAiModelDraft] = useState('openai/gpt-oss-120b');
  const [testingAiConn, setTestingAiConn] = useState(false);
  const [aiProbeResult, setAiProbeResult] = useState(null);
  const [savingAiConfig, setSavingAiConfig] = useState(false);
  const [copiedEnvSnippet, setCopiedEnvSnippet] = useState(false);
  const [smtpHostDraft, setSmtpHostDraft] = useState('');
  const [showSmtpAdvanced, setShowSmtpAdvanced] = useState(false);
  const [smtpPortDraft, setSmtpPortDraft] = useState('587');
  const [smtpUserDraft, setSmtpUserDraft] = useState('');
  const [smtpPassDraft, setSmtpPassDraft] = useState('');
  const [smtpFromDraft, setSmtpFromDraft] = useState('');
  const [savingSmtpConfig, setSavingSmtpConfig] = useState(false);

  const cuentaRef = useRef(null);
  const iaRef = useRef(null);
  const ragRef = useRef(null);
  const permisosRef = useRef(null);
  const corpusRef = useRef(null);
  const scrollContainerRef = useRef(null);

  const isDesktopApp = checkIsDesktopApp();

  useScrollReveal(scrollContainerRef, [activeSection, gov?.reports_count]);

  const [loadingGov, setLoadingGov] = useState(Boolean(authSession));
  const [govError, setGovError] = useState('');
  const [actionBanner, setActionBanner] = useState(null);
  const [showAiGuide, setShowAiGuide] = useState(false);
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
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  useEffect(() => {
    if (!initialSection) return;
    const t = setTimeout(() => scrollToSection(initialSection), 80);
    return () => clearTimeout(t);
  }, [initialSection, initialSectionKey]);

  useEffect(() => {
    if (!isDesktopApp) return undefined;
    let cancelled = false;
    getDesktopRuntimeConfig()
      .then((res) => {
        if (cancelled || !res?.ok || !res.config) return;
        const cfg = res.config;
        setDesktopAiConfig(cfg);
        const detected =
          cfg.activeProvider && cfg.activeProvider !== 'extractive'
            ? cfg.activeProvider
            : 'groq';
        const preset = findAiPreset(detected);
        setAiProviderDraft(preset.id);
        if (cfg.customConfigured) {
          setAiBaseUrlDraft(cfg.customBaseUrl || preset.baseUrl);
          setAiModelDraft(cfg.customModel || preset.defaultModel);
        } else if (detected === 'omniroute') {
          setAiBaseUrlDraft(preset.baseUrl);
          setAiModelDraft(cfg.omniRouteModel || 'auto');
        } else if (detected === 'openai') {
          setAiBaseUrlDraft(preset.baseUrl);
          setAiModelDraft(cfg.openAiChatModel || 'gpt-4o-mini');
        } else {
          setAiBaseUrlDraft(preset.baseUrl);
          setAiModelDraft(cfg.groqModel || 'openai/gpt-oss-120b');
        }
        setSmtpHostDraft(cfg.smtpHost || '');
        setSmtpPortDraft(String(cfg.smtpPort || 587));
        setSmtpUserDraft(cfg.smtpUsername || '');
        setSmtpFromDraft(cfg.smtpFrom || '');
      })
      .catch(() => {
        // Ignorar si no hay puente desktop
      });
    return () => {
      cancelled = true;
    };
  }, [isDesktopApp]);

  function openExternalLink(url) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function handleSelectAiPreset(presetId) {
    const preset = findAiPreset(presetId);
    setAiProviderDraft(preset.id);
    setAiBaseUrlDraft(
      preset.id === 'omniroute' && desktopAiConfig?.omniRouteDashboardUrl
        ? 'http://omniroute:20128/v1'
        : preset.baseUrl,
    );
    setAiModelDraft(preset.defaultModel);
    setAiKeyDraft('');
    setAiProbeResult(null);
  }

  async function handleTestAiConnection() {
    if (testingAiConn) return;
    if (!authSession) {
      setAiProbeResult({
        ok: false,
        message: 'Inicia sesión primero para probar la conexión desde el backend.',
      });
      return;
    }
    setTestingAiConn(true);
    setAiProbeResult(null);
    try {
      const payload = {
        provider: aiProviderDraft,
        baseUrl: aiBaseUrlDraft.trim(),
        apiKey: aiKeyDraft.trim(),
        model: aiModelDraft.trim(),
      };
      let res;
      try {
        res = await testAiEngineConnection(payload);
      } catch (firstErr) {
        if (!firstErr?.isNetworkError) throw firstErr;
        await new Promise((r) => setTimeout(r, 1500));
        res = await testAiEngineConnection(payload);
      }
      setAiProbeResult(res || { ok: false, message: 'Sin respuesta del backend.' });
      if (res?.ok && Array.isArray(res.detected_models) && res.detected_models.length > 0 && !aiModelDraft.trim()) {
        setAiModelDraft(res.detected_models[0]);
      }
    } catch (err) {
      setAiProbeResult({
        ok: false,
        message: err?.message || 'No se pudo probar la conexión.',
      });
    } finally {
      setTestingAiConn(false);
    }
  }

  async function handleSaveAiEngine(e) {
    e?.preventDefault();
    if (!isDesktopApp || savingAiConfig) return;
    const preset = findAiPreset(aiProviderDraft);
    const cleanKey = aiKeyDraft.trim();
    const cleanModel = aiModelDraft.trim() || preset.defaultModel;
    const cleanBase = aiBaseUrlDraft.trim() || preset.baseUrl;

    await guard(async () => {
      setSavingAiConfig(true);
      setActionBanner({
        tone: 'info',
        message: `Guardando proveedor ${preset.label} y recargando el motor (~5 segundos)...`,
      });
      try {
        let payload;
        if (aiProviderDraft === 'groq') {
          payload = {
            clearCustomProvider: true,
            omniRouteEnabled: false,
            groqApiKey: cleanKey,
            groqModel: cleanModel,
          };
        } else if (aiProviderDraft === 'openai') {
          payload = {
            clearCustomProvider: true,
            omniRouteEnabled: false,
            openAiApiKey: cleanKey,
            openAiChatModel: cleanModel,
          };
        } else if (aiProviderDraft === 'omniroute') {
          payload = {
            clearCustomProvider: true,
            omniRouteEnabled: true,
            omniRouteApiKey: cleanKey,
            omniRouteModel: cleanModel || 'auto',
          };
        } else {
          payload = {
            customProvider: aiProviderDraft,
            customBaseUrl: cleanBase,
            customApiKey: cleanKey,
            clearCustomKey: Boolean(!cleanKey && (aiProviderDraft === 'ollama' || aiProviderDraft === 'lmstudio')),
            customModel: cleanModel,
          };
        }

        const res = await saveDesktopRuntimeConfig(payload);
        if (res?.config) {
          setDesktopAiConfig(res.config);
        }
        if (res?.ok) {
          setAiKeyDraft('');
          for (let attempt = 0; attempt < 15; attempt += 1) {
            const h = await fetchApiHealth().catch(() => ({ status: 'down' }));
            if (h?.status === 'ok') break;
            await new Promise((r) => setTimeout(r, 1200));
          }
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

  async function handleSaveDesktopSmtp(e) {
    e?.preventDefault();
    if (!isDesktopApp || savingSmtpConfig) return;
    const host = smtpHostDraft.trim();
    const port = Number.parseInt(smtpPortDraft, 10) || 587;
    await guard(async () => {
      setSavingSmtpConfig(true);
      try {
        const res = await saveDesktopRuntimeConfig({
          clearSmtpConfig: !host,
          smtpHost: host,
          smtpPort: Math.min(65535, Math.max(1, port)),
          smtpUsername: smtpUserDraft.trim(),
          smtpPassword: smtpPassDraft.trim(),
          smtpFrom: smtpFromDraft.trim(),
        });
        if (res?.config) setDesktopAiConfig(res.config);
        if (res?.ok) {
          setSmtpPassDraft('');
          setActionBanner({
            tone: 'clean',
            message: host
              ? `Correo SMTP (${host}) guardado y aplicado al backend local.`
              : 'Configuración SMTP local eliminada.',
          });
          onAiConfigured?.();
        } else {
          setActionBanner({
            tone: 'danger',
            message: res?.error || 'No se pudo aplicar la configuración SMTP local.',
          });
        }
      } catch (err) {
        setActionBanner({
          tone: 'danger',
          message: err?.message || 'Error guardando la configuración SMTP local.',
        });
      } finally {
        setSavingSmtpConfig(false);
      }
    });
  }

  function buildEnvSnippetText() {
    const preset = findAiPreset(aiProviderDraft);
    const cleanModel = aiModelDraft.trim() || preset.defaultModel || 'modelo';
    if (aiProviderDraft === 'groq') {
      return `GROQ_API_KEY=${aiKeyDraft.trim() || 'gsk_tu_clave'}\nGROQ_MODEL=${cleanModel}`;
    }
    if (aiProviderDraft === 'openai') {
      return `OPENAI_API_KEY=${aiKeyDraft.trim() || 'sk-tu_clave'}\nOMEGA_CHAT_MODEL=${cleanModel}`;
    }
    if (aiProviderDraft === 'omniroute') {
      return [
        'COMPOSE_PROFILES=omniroute',
        'OMNIROUTE_BASE_URL=http://omniroute:20128/v1',
        `OMNIROUTE_MODEL=${cleanModel}`,
        aiKeyDraft.trim() ? `OMNIROUTE_API_KEY=${aiKeyDraft.trim()}` : '# OMNIROUTE_API_KEY=',
      ].join('\n');
    }
    return [
      `CUSTOM_LLM_PROVIDER=${aiProviderDraft}`,
      `CUSTOM_LLM_BASE_URL=${aiBaseUrlDraft.trim() || preset.baseUrl}`,
      `CUSTOM_LLM_MODEL=${cleanModel}`,
      aiKeyDraft.trim() ? `CUSTOM_LLM_API_KEY=${aiKeyDraft.trim()}` : '# CUSTOM_LLM_API_KEY= (opcional)',
    ].join('\n');
  }

  function handleCopyEnvSnippet() {
    navigator.clipboard?.writeText(buildEnvSnippetText());
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
    onSavedFeedback?.(true);
    setActionBanner({
      tone: 'clean',
      message: `Preferencias guardadas en sesión local (Top-${topK} · ${sourceScope}).`,
    });
    setTimeout(() => {
      setSavedFeedback(false);
      onSavedFeedback?.(false);
    }, 1800);
  }

  useEffect(() => {
    if (saveTrigger > 0) {
      handleSaveChanges();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveTrigger]);

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
  const activeSectionMeta =
    CONFIG_SECTIONS.find((sec) => sec.id === activeSection) || CONFIG_SECTIONS[0];

  return (
    <div className={embedded ? 'space-y-4' : 'h-full flex flex-col min-h-0'}>
      {!embedded && (
        <div className="shrink-0 border-b border-white/[0.08] bg-[#0A0A0C]/65 px-4 sm:px-8 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[15px] sm:text-[17px]">
            <span className="font-semibold tracking-[-0.02em] text-[#F2F2F4]">Ajustes</span>
            <span className="text-[#7C7D87]">›</span>
            <span className="text-[#9FA6B8] font-medium">{activeSectionMeta.label}</span>
          </div>

          <div className="flex items-center justify-end gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleDiscardChanges}
              className="rounded-lg text-[12.5px] text-[#9A9AA2] hover:text-[#F2F2F4] px-2.5 py-1.5 transition-colors cursor-pointer"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={handleSaveChanges}
              className="rounded-lg bg-[#2F6FED] hover:bg-[#2F6FED]/90 text-white px-3.5 py-1.5 text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {savedFeedback ? (
                <>
                  <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>Guardado</span>
                </>
              ) : (
                <span>Guardar cambios</span>
              )}
            </button>
          </div>
        </div>
      )}

      {embedded && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-1.5">
          {CONFIG_SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => scrollToSection(sec.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#2F6FED] text-white'
                    : 'text-[#8E95A5] hover:text-white hover:bg-[#141923]/75'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span>{sec.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Área Scrollable dividida en 2 columnas (Sidebar Untitled UI + Contenido Split-Row) */}
      <div
        ref={scrollContainerRef}
        className={embedded ? 'bg-transparent' : 'flex-1 overflow-y-auto bg-transparent px-4 sm:px-8 py-6'}
      >
        <div
          className={
            embedded
              ? 'animate-fade-up'
              : 'animate-fade-up mx-auto max-w-[1120px] grid grid-cols-1 md:grid-cols-[220px_1fr] gap-8 lg:gap-12 pb-24'
          }
        >
          {/* Columna izquierda: Navegación categorizada */}
          {!embedded && (
            <aside className="md:sticky md:top-0 md:self-start space-y-6">
              {['CUENTA', 'ESPACIO DE TRABAJO'].map((groupName) => {
                const items = CONFIG_SECTIONS.filter((sec) => sec.group === groupName);
                return (
                  <div key={groupName} className="space-y-1.5">
                    <div className="px-3 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[#7C7D87]">
                      {groupName}
                    </div>
                    <div className="flex md:flex-col gap-1 overflow-x-auto no-scrollbar">
                      {items.map((sec) => {
                        const Icon = sec.icon;
                        const isActive = activeSection === sec.id;
                        return (
                          <button
                            key={sec.id}
                            type="button"
                            onClick={() => scrollToSection(sec.id)}
                            className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-left shrink-0 transition-colors duration-150 cursor-pointer ${
                              isActive
                                ? 'bg-[#2F6FED]/12 text-white font-medium'
                                : 'text-[#8E95A5] hover:text-white hover:bg-white/[0.04]'
                            }`}
                          >
                            <Icon
                              className={`h-4 w-4 shrink-0 ${
                                isActive ? 'text-[#2F6FED]' : 'text-[#7C7D87]'
                              }`}
                            />
                            <span className="whitespace-nowrap">{sec.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </aside>
          )}

          {/* Columna derecha: Header con breadcrumb, banner de estado y filas Split-Row */}
          <div className="min-w-0 rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-5 sm:p-6">
            <header className="space-y-4 pb-6 border-b border-white/[0.06]">
              <div className="space-y-1.5">
                <div className="text-xs text-[#8E95A5]">
                  Configuración <span className="mx-1 text-white/25">/</span>{' '}
                  <span className="text-[#F2F2F4]">{activeSectionMeta.label}</span>
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">
                  {activeSectionMeta.label}
                </h1>
                <p className="text-sm text-[#8E95A5] truncate">
                  {activeSectionMeta.subtitle}
                </p>
              </div>

              {/* Banner compacto de estado específico por módulo */}
              {(() => {
                const govAi = gov?.ai_engine || null;
                const aiConfigured = Boolean(desktopAiConfig ? desktopAiConfig.configured : govAi?.configured);
                const activeProvider = desktopAiConfig?.activeProvider || govAi?.active_provider || 'extractive';
                const activeModel = desktopAiConfig?.activeModel || govAi?.active_model || 'omega-extractive-fallback';

                if (activeSection === 'cuenta') {
                  return (
                    <div className="rounded-xl bg-[#141923]/75 border border-white/[0.05] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 text-xs text-[#D2D6E2]">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                        <span>
                          Postura de seguridad: <strong className="text-white">100%</strong> · Sesión JWT aislada y Zero-Retention activo
                        </span>
                      </div>
                      {authSession && (
                        <button
                          type="button"
                          onClick={() => void onPanicPurge?.()}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/35 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 text-xs font-medium text-rose-300 transition-colors cursor-pointer shrink-0"
                        >
                          <Lock className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span>Purga rápida</span>
                        </button>
                      )}
                    </div>
                  );
                }

                if (activeSection === 'ia') {
                  return (
                    <div className="rounded-xl bg-[#141923]/75 border border-white/[0.05] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 text-xs text-[#D2D6E2]">
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${
                            aiConfigured ? 'bg-emerald-400' : 'bg-amber-400'
                          }`}
                        />
                        <span>
                          {aiConfigured ? (
                            <>
                              Motor activo: <strong className="text-white">{activeProvider}</strong> ·{' '}
                              <span className="font-tech text-[#8E95A5]">{activeModel}</span>
                            </>
                          ) : (
                            'Sin motor conectado · Modo extractivo activo'
                          )}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={testingAiConn}
                        onClick={handleTestAiConnection}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white transition-colors cursor-pointer shrink-0"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${testingAiConn ? 'animate-spin' : ''}`} />
                        <span>{testingAiConn ? 'Probando...' : 'Probar conexión'}</span>
                      </button>
                    </div>
                  );
                }

                if (activeSection === 'corpus') {
                  return (
                    <div className="rounded-xl bg-white/[0.02] border border-white/[0.07] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 text-xs text-[#D2D6E2]">
                        <Database className="h-3.5 w-3.5 text-[#2F6FED] shrink-0" />
                        <span className="font-tech">
                          {stats
                            ? `${stats.reports} Reportes · ${stats.chunks} Fragmentos · ${Number(stats.iocs || 0).toLocaleString('en-US')} IOCs`
                            : 'Sesión requerida para métricas del corpus'}
                        </span>
                      </div>
                      {authSession && (
                        <button
                          type="button"
                          disabled={discoveryBusy}
                          onClick={async () => {
                            setDiscoveryBusy(true);
                            try {
                              await scanCorpusDiscovery();
                              const items = await fetchCorpusDiscovery('PENDING');
                              setDiscoveryQueue(Array.isArray(items) ? items : []);
                            } catch {} finally {
                              setDiscoveryBusy(false);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#2F6FED]/45 bg-[#2F6FED]/15 hover:bg-[#2F6FED]/25 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white transition-colors cursor-pointer shrink-0"
                        >
                          <Globe className="h-3.5 w-3.5 text-[#6EA0FF]" />
                          <span>Buscar en RSS</span>
                        </button>
                      )}
                    </div>
                  );
                }

                if (activeSection === 'rag') {
                  return (
                    <div className="rounded-xl bg-white/[0.02] border border-white/[0.07] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 text-xs text-[#D2D6E2]">
                        <Layers className="h-3.5 w-3.5 text-[#2F6FED] shrink-0" />
                        <span>
                          Recuperación híbrida RRF · <strong className="text-white">Top-{topK}</strong> fragmentos
                        </span>
                      </div>
                      <span className="font-tech text-xs text-[#8E95A5]">
                        Fuente: {sourceScope || 'Todas'}
                      </span>
                    </div>
                  );
                }

                return (
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.07] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 text-xs text-[#D2D6E2]">
                      <ShieldCheck className="h-3.5 w-3.5 text-[#30D158] shrink-0" />
                      <span>Procesamiento temporal en RAM · Cero retención en disco</span>
                    </div>
                    <span className="font-tech text-xs text-[#30D158]">Activo</span>
                  </div>
                );
              })()}
            </header>

            <div className="space-y-4 pt-4">
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
            </div>

            {/* Bloque 1 — Mi perfil y sesión (Split-Row Untitled UI) */}
            {activeSection === 'cuenta' && (
            <section ref={cuentaRef}>
              <SplitRow
                title="Identidad y Espacio"
                description="Cuenta activa, rol asignado e identificador único del espacio de trabajo."
              >
                {authSession ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-white break-all">
                            {authSession.email}
                          </span>
                          <span className="font-tech rounded-full border border-[#2F6FED]/45 bg-[#2F6FED]/15 px-2 py-0.5 text-[10.5px] font-medium text-[#CFE0FF]">
                            {authSession.role}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#8E95A5]">
                          <span>Workspace ID:</span>
                          <code className="font-tech text-[#D2D6E2] break-all">
                            {displayWorkspaceId}
                          </code>
                          <button
                            type="button"
                            onClick={handleCopyWorkspaceId}
                            className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] px-2 py-0.5 text-[11px] text-[#F2F2F4] transition-colors cursor-pointer"
                          >
                            {copiedId ? (
                              <>
                                <Check className="h-3 w-3 text-[#30D158]" />
                                <span>Copiado</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3 text-[#8E95A5]" />
                                <span>Copiar</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onOpenAuth?.('Cambia de cuenta o inicia sesión con otro correo.')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white transition-colors cursor-pointer"
                        >
                          <KeyRound className="h-3.5 w-3.5 text-[#2F6FED]" />
                          <span>Cambiar cuenta</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onLogout?.()}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white transition-colors cursor-pointer"
                        >
                          <LogOut className="h-3.5 w-3.5 text-[#8E95A5]" />
                          <span>Cerrar sesión</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-2 text-sm font-medium text-white">
                        <Lock className="h-4 w-4 text-[#2F6FED]" />
                        <span>Sin cuenta conectada</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[#8E95A5]">
                        <span>ID local:</span>
                        <code className="font-tech text-[#D2D6E2]">{displayWorkspaceId}</code>
                        <button
                          type="button"
                          onClick={handleCopyWorkspaceId}
                          className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[11px] text-[#F2F2F4] cursor-pointer"
                        >
                          {copiedId ? 'Copiado' : 'Copiar'}
                        </button>
                        <button
                          type="button"
                          onClick={handleRotateId}
                          className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[11px] text-[#F2F2F4] cursor-pointer"
                        >
                          {rotated ? 'Rotado' : 'Rotar'}
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenAuth?.('Inicia sesión o crea una cuenta para sincronizar tu biblioteca privada y OSINT.')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#2F6FED] hover:brightness-110 px-3.5 py-2 text-xs font-medium text-white cursor-pointer"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      <span>Iniciar sesión / Registrarse</span>
                    </button>
                  </div>
                )}
              </SplitRow>

              {authSession && (
                <>
                  <SplitRow
                    title="Métricas de Actividad"
                    description="Resumen de recursos privados procesados dentro de tu organización."
                  >
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div>
                        <div className="text-xs text-[#8E95A5]">Espacios privados</div>
                        <div className="font-tech mt-1 text-xl font-semibold text-white">
                          {Number(tenantStats?.expedientes || 0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-[#8E95A5]">PDFs indexados</div>
                        <div className="font-tech mt-1 text-xl font-semibold text-white">
                          {Number(tenantStats?.documents || 0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-[#8E95A5]">Zero-Retention purgados</div>
                        <div className="font-tech mt-1 text-xl font-semibold text-[#30D158]">
                          {Number(tenantStats?.zero_retention_purged_pdfs || 0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-[#8E95A5]">Activos OSINT</div>
                        <div className="font-tech mt-1 text-xl font-semibold text-white">
                          {Number(tenantStats?.osint_assets || 0)}
                        </div>
                      </div>
                    </div>
                  </SplitRow>

                  <SplitRow
                    title="Verificación en dos pasos (2FA)"
                    description="Protege el acceso solicitando un segundo código al iniciar sesión."
                  >
                    <TwoFactorSettingsCard authSession={authSession} embedded />
                  </SplitRow>

                  <SplitRow
                    title="Recuperación sin correo"
                    description="Genera una clave de respaldo fuera de línea. Crear una nueva invalida la anterior."
                  >
                    <RecoveryKeyCard embedded />
                  </SplitRow>

                  {authSession.role === 'ADMIN' && (
                    <SplitRow
                      title="Auditoría y equipo"
                      description="Verifica la cadena SHA-256 de eventos o registra analistas en tu espacio."
                      className="border-b-0"
                    >
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={verifyingAudit}
                            onClick={handleVerifyAuditChain}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[#2F6FED]/45 bg-[#2F6FED]/15 hover:bg-[#2F6FED]/25 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 cursor-pointer transition-colors"
                          >
                            <FileCheck2 className={`h-3.5 w-3.5 ${verifyingAudit ? 'animate-pulse' : ''}`} />
                            <span>
                              {verifyingAudit ? 'Verificando SHA-256...' : 'Verificar cadena de auditoría'}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setShowInviteForm((v) => !v)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white cursor-pointer transition-colors"
                          >
                            <UserPlus className="h-3.5 w-3.5 text-[#30D158]" />
                            <span>Crear analista / cliente</span>
                          </button>
                        </div>

                        {showInviteForm && (
                          <form
                            noValidate
                            onSubmit={handleInviteSubmit}
                            className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5"
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
                              className="h-9 rounded-lg border border-white/[0.1] bg-[#0A0A0C] px-3 text-xs text-white placeholder-[#8E95A5]"
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
                              className="h-9 rounded-lg border border-white/[0.1] bg-[#0A0A0C] px-3 text-xs text-white placeholder-[#8E95A5]"
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
                              className="h-9 rounded-lg border border-white/[0.1] bg-[#0A0A0C] px-3 text-xs text-white placeholder-[#8E95A5]"
                            />
                            <div className="flex items-center gap-2">
                              <select
                                aria-label="Rol del nuevo usuario"
                                value={inviteForm.role}
                                onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value }))}
                                className="h-9 flex-1 rounded-lg border border-white/[0.1] bg-[#0A0A0C] px-2.5 text-xs text-white"
                              >
                                <option value="ANALYST">ANALYST (forense + CTI)</option>
                                <option value="CLIENT">CLIENT (lectura + IOCs)</option>
                                <option value="ADMIN">ADMIN (gestión total)</option>
                              </select>
                              <button
                                type="submit"
                                disabled={invitingUser}
                                className="h-9 rounded-lg bg-[#2F6FED] hover:brightness-110 px-3.5 text-xs font-medium text-white disabled:opacity-50 cursor-pointer"
                              >
                                {invitingUser ? '...' : 'Añadir'}
                              </button>
                            </div>
                          </form>
                        )}

                        {auditVerification && (
                          <div className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span
                                className={`font-semibold ${
                                  auditVerification.valid ? 'text-[#30D158]' : 'text-[#FF453A]'
                                }`}
                              >
                                {auditVerification.valid ? 'Integridad SHA-256 verificada' : 'Ruptura de cadena detectada'}
                              </span>
                              <span className="font-tech text-[11px] text-[#8E95A5]">
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
                                    <span className="text-[#8E95A5]">
                                      {String(ev.currentHash || '').slice(0, 14)}… · {formatDateTag(ev.createdAt)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </SplitRow>
                  )}
                </>
              )}
            </section>
            )}

            {/* Bloque 2 — Motor de IA (Split-Row Untitled UI) */}
            {activeSection === 'ia' && (
            <section ref={iaRef}>
              {gov?.airGappedMode === true && (
                <div role="status" className="mt-4 rounded-xl border border-[#30D158]/30 bg-[#30D158]/10 p-3.5 text-sm text-[#8AEBA1]">
                  <strong>Modo Soberano Local · Ningún dato sale de tu equipo</strong>
                  <p className="mt-1 text-xs">IA local y consultas externas deshabilitadas en OMEGA. Requiere servicios locales sin reenvío; el aislamiento físico de red depende de la configuración del equipo.</p>
                </div>
              )}
              {(() => {
                const currentPreset = findAiPreset(aiProviderDraft);
                const savedHint =
                  aiProviderDraft === 'groq'
                    ? desktopAiConfig?.groqHint
                    : aiProviderDraft === 'openai'
                      ? desktopAiConfig?.openAiHint
                      : aiProviderDraft === 'omniroute'
                        ? desktopAiConfig?.omniRouteHint
                        : desktopAiConfig?.customProvider === aiProviderDraft
                          ? desktopAiConfig?.customHint
                          : '';
                const docsTargetUrl =
                  aiProviderDraft === 'omniroute' && desktopAiConfig?.omniRouteDashboardUrl
                    ? desktopAiConfig.omniRouteDashboardUrl
                    : currentPreset.docsUrl;
                const detectedModels = Array.isArray(aiProbeResult?.detected_models)
                  ? aiProbeResult.detected_models
                  : [];

                return (
                  <>
                    <form onSubmit={handleSaveAiEngine}>
                      {/* Fila 1: Proveedor LLM */}
                      <SplitRow
                        title="Proveedor LLM"
                        description="Selecciona el motor de inteligencia artificial. Groq ofrece plan gratuito rápido; Ollama y LM Studio corren 100% en tu equipo."
                      >
                        <div className="space-y-3">
                          <div
                            className="grid grid-cols-2 sm:grid-cols-4 gap-2.5"
                            role="group"
                            aria-label="Selector de proveedor de IA"
                          >
                            {AI_PROVIDER_PRESETS.map((preset) => {
                              const selected = aiProviderDraft === preset.id;
                              return (
                                <button
                                  key={preset.id}
                                  type="button"
                                  onClick={() => handleSelectAiPreset(preset.id)}
                                  className={`rounded-xl border px-3 py-2.5 text-left transition-all cursor-pointer ${
                                    selected
                                      ? 'border-[#2F6FED] bg-[#2F6FED]/12 text-white'
                                      : 'border-white/[0.08] bg-white/[0.02] text-[#D2D6E2] hover:border-white/[0.18] hover:bg-white/[0.04]'
                                  }`}
                                >
                                  <div className="text-xs font-medium truncate">
                                    {preset.label.replace(' (Por defecto)', '').replace(' (Local)', ' Local')}
                                  </div>
                                  <div className={`font-tech mt-0.5 text-[10.5px] truncate ${selected ? 'text-[#8BB2FF]' : 'text-[#8E95A5]'}`}>
                                    {preset.badge}
                                  </div>
                                </button>
                              );
                            })}
                          </div>

                          {/* Acordeón colapsable "¿Cómo obtener tu API Key?" */}
                          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
                            <button
                              type="button"
                              onClick={() => setShowAiGuide((v) => !v)}
                              aria-expanded={showAiGuide}
                              className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-medium text-[#D2D6E2] hover:text-white cursor-pointer"
                            >
                              <span>¿Cómo obtener tu API Key?</span>
                              <span className="font-tech text-[11px] text-[#8E95A5]">
                                {showAiGuide ? 'Ocultar' : 'Ver pasos'}
                              </span>
                            </button>
                            {showAiGuide && (
                              <div className="px-3.5 pb-3.5 pt-1 border-t border-white/[0.06] space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-xs text-[#D2D6E2]">{currentPreset.summary}</span>
                                  {docsTargetUrl && (
                                    <button
                                      type="button"
                                      onClick={() => openExternalLink(docsTargetUrl)}
                                      className="inline-flex items-center gap-1 rounded-lg border border-[#2F6FED]/45 bg-[#2F6FED]/15 hover:bg-[#2F6FED]/25 px-2.5 py-1 text-[11px] font-medium text-white cursor-pointer shrink-0"
                                    >
                                      <span>{currentPreset.docsLabel}</span>
                                      <ExternalLink className="h-3 w-3 text-[#6EA0FF]" />
                                    </button>
                                  )}
                                </div>
                                <ol className="space-y-1 text-xs text-[#8E95A5] list-decimal list-inside leading-relaxed">
                                  {currentPreset.steps.map((step, i) => (
                                    <li key={i}>{step}</li>
                                  ))}
                                </ol>
                              </div>
                            )}
                          </div>
                        </div>
                      </SplitRow>

                      {/* Fila 2: Credenciales y Modelo */}
                      <SplitRow
                        title="Credenciales y Modelo"
                        description="Ingresa tu API Key y elige el modelo. Puedes seleccionar uno de los chips sugeridos."
                        className={!(isDesktopApp && authSession?.role === 'ADMIN') ? 'border-b-0' : ''}
                      >
                        <div className="space-y-3.5">
                          {(currentPreset.baseUrlEditable || aiProviderDraft !== 'groq') && (
                            <div>
                              <label htmlFor="omega-ai-base-url" className="block text-xs font-medium text-[#D2D6E2] mb-1">
                                Endpoint Base URL (`/v1`)
                              </label>
                              <input
                                id="omega-ai-base-url"
                                type="text"
                                value={aiBaseUrlDraft}
                                readOnly={!currentPreset.baseUrlEditable}
                                onChange={(e) => setAiBaseUrlDraft(e.target.value)}
                                placeholder="https://tu-servidor.com/v1 o http://host.docker.internal:11434/v1"
                                className={`w-full h-9.5 px-3 rounded-lg border border-white/[0.1] text-xs font-tech text-white placeholder:text-[#8E95A5] focus:outline-none focus:border-[#2F6FED] ${
                                  currentPreset.baseUrlEditable ? 'bg-white/[0.03]' : 'bg-white/[0.015] text-[#8E95A5]'
                                }`}
                              />
                            </div>
                          )}

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label htmlFor="omega-ai-key" className="text-xs font-medium text-[#D2D6E2]">
                                  API Key {!currentPreset.keyRequired ? '(opcional)' : ''}
                                </label>
                                {savedHint && (
                                  <span className="font-tech text-[10.5px] text-[#30D158]">
                                    Guardada ({savedHint})
                                  </span>
                                )}
                              </div>
                              <div className="relative flex items-center">
                                <input
                                  id="omega-ai-key"
                                  type={showAiKey ? 'text' : 'password'}
                                  value={aiKeyDraft}
                                  onChange={(e) => setAiKeyDraft(e.target.value)}
                                  placeholder={
                                    savedHint
                                      ? 'Vacío para conservar la clave actual'
                                      : currentPreset.keyPlaceholder
                                  }
                                  className="w-full h-9.5 pl-3 pr-9 rounded-lg bg-white/[0.03] border border-white/[0.1] text-xs font-tech text-white placeholder:text-[#8E95A5] focus:outline-none focus:border-[#2F6FED]"
                                />
                                <button
                                  type="button"
                                  aria-label={showAiKey ? 'Ocultar clave' : 'Mostrar clave'}
                                  onClick={() => setShowAiKey((v) => !v)}
                                  className="absolute right-2.5 text-[#8E95A5] hover:text-white cursor-pointer"
                                >
                                  {showAiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </button>
                              </div>
                            </div>

                            <div>
                              <label htmlFor="omega-ai-model" className="block text-xs font-medium text-[#D2D6E2] mb-1">
                                Model ID
                              </label>
                              <input
                                id="omega-ai-model"
                                type="text"
                                value={aiModelDraft}
                                onChange={(e) => setAiModelDraft(e.target.value)}
                                placeholder={currentPreset.defaultModel || 'ej. llama3.2'}
                                className="w-full h-9.5 px-3 rounded-lg bg-white/[0.03] border border-white/[0.1] text-xs font-tech text-white placeholder:text-[#8E95A5] focus:outline-none focus:border-[#2F6FED]"
                              />
                            </div>
                          </div>

                          {(currentPreset.suggestedModels.length > 0 || detectedModels.length > 0) && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] text-[#8E95A5] mr-1">
                                {detectedModels.length > 0 ? 'Detectados:' : 'Sugeridos:'}
                              </span>
                              {(detectedModels.length > 0 ? detectedModels : currentPreset.suggestedModels).slice(0, 8).map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => setAiModelDraft(m)}
                                  className={`font-tech rounded-full border px-2.5 py-0.5 text-[10.5px] transition-colors cursor-pointer ${
                                    aiModelDraft === m
                                      ? 'border-[#2F6FED] bg-[#2F6FED]/15 text-white'
                                      : 'border-white/[0.08] bg-white/[0.02] text-[#8E95A5] hover:text-white'
                                  }`}
                                >
                                  {m}
                                </button>
                              ))}
                            </div>
                          )}

                          {aiProbeResult && (
                            <div
                              className={`rounded-lg border px-3 py-2 text-xs ${
                                aiProbeResult.ok
                                  ? 'border-[#30D158]/35 bg-[#30D158]/10 text-[#B8F2C7]'
                                  : 'border-[#FF453A]/35 bg-[#FF453A]/10 text-[#FFDAD6]'
                              }`}
                            >
                              {aiProbeResult.message}
                            </div>
                          )}

                          {isDesktopApp ? (
                            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                              <button
                                type="submit"
                                disabled={savingAiConfig}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2F6FED] hover:brightness-110 disabled:opacity-55 px-4 py-2 text-xs font-medium text-white transition-all cursor-pointer"
                              >
                                <Sparkles className="h-3.5 w-3.5" />
                                <span>{savingAiConfig ? 'Aplicando...' : 'Guardar y activar IA'}</span>
                              </button>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#8E95A5]">
                                <span>En modo web copia estas variables a tu <code className="font-tech text-white">omega/.env</code>:</span>
                                <button
                                  type="button"
                                  onClick={handleCopyEnvSnippet}
                                  className="inline-flex items-center gap-1 rounded-md border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] px-2.5 py-1 text-[11px] text-white cursor-pointer"
                                >
                                  {copiedEnvSnippet ? <Check className="h-3 w-3 text-[#30D158]" /> : <Copy className="h-3 w-3" />}
                                  <span>{copiedEnvSnippet ? 'Copiado' : 'Copiar .env'}</span>
                                </button>
                              </div>
                              <pre className="font-tech text-[11px] text-[#8E95A5] overflow-x-auto whitespace-pre-wrap">
                                {buildEnvSnippetText()}
                              </pre>
                            </div>
                          )}
                        </div>
                      </SplitRow>
                    </form>

                    {/* Fila 3: Correo SMTP local opcional (colapsado bajo Opciones avanzadas) */}
                    {isDesktopApp && authSession?.role === 'ADMIN' && (
                      <SplitRow
                        title="Opciones avanzadas"
                        description="Correo SMTP local opcional para códigos de recuperación y 2FA."
                        className="border-b-0"
                      >
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => setShowSmtpAdvanced((prev) => !prev)}
                              aria-expanded={showSmtpAdvanced}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#141923]/75 px-3 py-1.5 text-xs font-medium text-[#F2F2F4] hover:border-white/[0.14] transition-colors cursor-pointer"
                            >
                              <span>Opciones avanzadas {showSmtpAdvanced ? '▴' : '▾'}</span>
                            </button>
                            {desktopAiConfig?.smtpConfigured && (
                              <span className="font-tech rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-[10.5px] text-emerald-400">
                                SMTP activo
                              </span>
                            )}
                          </div>

                          {showSmtpAdvanced && (
                            <form onSubmit={handleSaveDesktopSmtp} className="rounded-xl bg-[#141923]/75 border border-white/[0.05] p-3.5 space-y-3">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <input
                                  type="text"
                                  value={smtpHostDraft}
                                  onChange={(e) => setSmtpHostDraft(e.target.value)}
                                  placeholder="Servidor (ej. smtp.gmail.com)"
                                  className="h-9.5 rounded-lg border border-white/[0.07] bg-[#0F131B]/80 px-3 text-xs text-white placeholder-[#8E95A5] focus:outline-none focus:border-[#2F6FED]"
                                />
                                <input
                                  type="number"
                                  min={1}
                                  max={65535}
                                  value={smtpPortDraft}
                                  onChange={(e) => setSmtpPortDraft(e.target.value)}
                                  placeholder="Puerto (ej. 587)"
                                  className="h-9.5 rounded-lg border border-white/[0.07] bg-[#0F131B]/80 px-3 text-xs text-white placeholder-[#8E95A5] focus:outline-none focus:border-[#2F6FED]"
                                />
                                <input
                                  type="email"
                                  value={smtpUserDraft}
                                  onChange={(e) => setSmtpUserDraft(e.target.value)}
                                  placeholder="Usuario / Correo SMTP"
                                  className="h-9.5 rounded-lg border border-white/[0.07] bg-[#0F131B]/80 px-3 text-xs text-white placeholder-[#8E95A5] focus:outline-none focus:border-[#2F6FED]"
                                />
                                <input
                                  type="password"
                                  value={smtpPassDraft}
                                  onChange={(e) => setSmtpPassDraft(e.target.value)}
                                  placeholder={desktopAiConfig?.smtpConfigured ? 'Nueva App Password (opcional)' : 'App Password'}
                                  className="h-9.5 rounded-lg border border-white/[0.07] bg-[#0F131B]/80 px-3 text-xs text-white placeholder-[#8E95A5] focus:outline-none focus:border-[#2F6FED]"
                                />
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-2.5">
                                <input
                                  type="email"
                                  value={smtpFromDraft}
                                  onChange={(e) => setSmtpFromDraft(e.target.value)}
                                  placeholder="Remitente (opcional)"
                                  className="h-9.5 flex-1 min-w-[200px] rounded-lg border border-white/[0.07] bg-[#0F131B]/80 px-3 text-xs text-white placeholder-[#8E95A5] focus:outline-none focus:border-[#2F6FED]"
                                />
                                <button
                                  type="submit"
                                  disabled={savingSmtpConfig}
                                  className="h-9.5 inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#0F131B] hover:border-[#2F6FED]/50 disabled:opacity-50 px-3.5 text-xs font-medium text-white transition-colors cursor-pointer"
                                >
                                  <span>{savingSmtpConfig ? 'Aplicando SMTP...' : 'Guardar SMTP local'}</span>
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      </SplitRow>
                    )}
                  </>
                );
              })()}
            </section>
            )}

            {/* Bloque 3 — Motor RAG (Split-Row Untitled UI) */}
            {activeSection === 'rag' && (
            <section ref={ragRef}>
              <SplitRow
                title="Alcance de evidencia (Top-K)"
                description="Define cuántos fragmentos evalúa el motor híbrido antes de redactar cada respuesta."
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {TOPK_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const selected = topK === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChangeTopK?.(opt.value)}
                        className={`relative rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                          selected
                            ? 'bg-[#2F6FED]/12 border-[#2F6FED] text-white'
                            : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Icon className={`h-4 w-4 ${selected ? 'text-[#2F6FED]' : 'text-[#8E95A5]'}`} />
                          <RadioDot selected={selected} />
                        </div>
                        <div className="font-tech text-xs font-medium text-white">
                          {opt.label}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[#8E95A5]">
                          {opt.caption}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </SplitRow>

              <SplitRow
                title="Fuentes prioritarias"
                description="Prioriza qué reportes de investigación pesan más en tus consultas."
                className="border-b-0"
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {SOURCE_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const selected = sourceScope === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChangeSourceScope?.(opt.value)}
                        className={`relative rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                          selected
                            ? 'bg-[#2F6FED]/12 border-[#2F6FED] text-white'
                            : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Icon className={`h-4 w-4 ${selected ? 'text-[#2F6FED]' : 'text-[#8E95A5]'}`} />
                          <RadioDot selected={selected} />
                        </div>
                        <div className="text-xs font-semibold text-white">
                          {opt.title}
                        </div>
                        <p className="mt-0.5 text-[11px] text-[#8E95A5] leading-snug line-clamp-2">
                          {opt.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </SplitRow>
            </section>
            )}

            {/* Bloque 4 — Permisos y ética (Split-Row Untitled UI) */}
            {activeSection === 'permisos' && (
            <section ref={permisosRef}>
              <SplitRow
                title="Controles de privacidad"
                description="Reglas de manejo temporal en RAM, verificación pasiva y consentimiento explícito."
                className="border-b-0"
              >
                <div className="divide-y divide-white/[0.07]">
                  <div className="pb-4 flex items-center justify-between gap-4">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">
                          Procesamiento en memoria (RAM)
                        </span>
                        <span className="rounded-full border border-[#2F6FED]/45 bg-[#2F6FED]/15 px-2 py-0.5 text-[10.5px] font-medium text-[#CFE0FF]">
                          Obligatorio
                        </span>
                      </div>
                      <p className="text-xs text-[#8E95A5]">
                        Analiza respaldos en memoria sin escribir copias en disco.
                      </p>
                    </div>
                    <TogglePill
                      checked={true}
                      disabled={true}
                      label="Procesamiento forense volátil obligatorio"
                    />
                  </div>

                  <div className="py-4 flex items-center justify-between gap-4">
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-sm font-medium text-white">
                        Inspección pasiva de enlaces
                      </div>
                      <p className="text-xs text-[#8E95A5]">
                        Verifica URLs sin establecer conexión con el destino.
                      </p>
                    </div>
                    <TogglePill
                      checked={passiveLinks}
                      onChange={setPassiveLinks}
                      label="Inspección pasiva de enlaces"
                    />
                  </div>

                  <div className="py-4 flex items-center justify-between gap-4">
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-sm font-medium text-white">
                        Confirmación previa en auditorías de dominio
                      </div>
                      <p className="text-xs text-[#8E95A5]">
                        Solicita autorización explícita antes de consultar un dominio o correo.
                      </p>
                    </div>
                    <TogglePill
                      checked={explicitConsent}
                      onChange={setExplicitConsent}
                      label="Consentimiento explícito OSINT"
                    />
                  </div>

                  <div className="pt-4 flex items-center justify-between gap-4">
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-sm font-medium text-white">
                        Sin caché de credenciales en navegador
                      </div>
                      <p className="text-xs text-[#8E95A5]">
                        OMEGA nunca persiste contraseñas ni conversaciones en localStorage.
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-[10.5px] font-medium text-emerald-400">
                      Activo
                    </span>
                  </div>
                </div>
              </SplitRow>
            </section>
            )}

            {/* Bloque 5 — Corpus indexado (Split-Row Untitled UI) */}
            {activeSection === 'corpus' && (
            <section ref={corpusRef}>
              <SplitRow
                title="Ingesta web CTI en RAM"
                description="Extrae indicadores técnicos de una URL de investigación directamente en memoria."
              >
                <div className="space-y-2">
                  <div className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-[10.5px] font-medium text-emerald-400">
                    Solo en memoria
                  </div>
                  <OmegaWebIntelCard
                    compact
                    title="Ingesta web CTI (RAM)"
                    subtitle="Extrae IPs, dominios y CVEs de una URL técnica en memoria."
                  />
                </div>
              </SplitRow>

              <SplitRow
                title="Cola de descubrimiento RSS/Atom"
                description="Reportes nuevos de Citizen Lab, Amnesty Tech y Google TAG pendientes de aprobación."
              >
                <div className="space-y-3">
                  {authSession ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={discoveryBusy}
                        onClick={async () => {
                          setDiscoveryBusy(true);
                          try {
                            const items = await fetchCorpusDiscovery('PENDING');
                            setDiscoveryQueue(Array.isArray(items) ? items : []);
                          } catch {} finally {
                            setDiscoveryBusy(false);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-xs text-white hover:bg-white/[0.08] cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${discoveryBusy ? 'animate-spin' : ''}`} />
                        <span>Cargar cola</span>
                      </button>
                      <button
                        type="button"
                        disabled={discoveryBusy}
                        onClick={async () => {
                          setDiscoveryBusy(true);
                          try {
                            await scanCorpusDiscovery();
                            const items = await fetchCorpusDiscovery('PENDING');
                            setDiscoveryQueue(Array.isArray(items) ? items : []);
                          } catch {} finally {
                            setDiscoveryBusy(false);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#2F6FED]/45 bg-[#2F6FED]/15 px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2F6FED]/25 cursor-pointer disabled:opacity-50"
                      >
                        <Globe className="h-3.5 w-3.5 text-[#6EA0FF]" />
                        <span>Buscar en RSS</span>
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-[#8E95A5]">Inicia sesión para gestionar la cola RSS.</p>
                  )}

                  {discoveryQueue.length > 0 ? (
                    <div className="divide-y divide-white/[0.06] border-t border-white/[0.06] max-h-60 overflow-y-auto">
                      {discoveryQueue.map((item) => (
                        <div key={item.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-white truncate">{item.title}</div>
                            <div className="text-[11px] text-[#8E95A5] truncate">
                              {item.source_name} · {item.source_url}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={discoveryBusy}
                              onClick={async () => {
                                setDiscoveryBusy(true);
                                try {
                                  await approveCorpusCandidate(item.id);
                                  setDiscoveryQueue((q) => q.filter((x) => x.id !== item.id));
                                } catch {} finally {
                                  setDiscoveryBusy(false);
                                }
                              }}
                              className="rounded-md border border-[#30D158]/40 bg-[#30D158]/12 px-2.5 py-1 text-[11px] font-medium text-[#30D158] hover:bg-[#30D158]/22 cursor-pointer"
                            >
                              Aprobar e indexar
                            </button>
                            <button
                              type="button"
                              disabled={discoveryBusy}
                              onClick={async () => {
                                setDiscoveryBusy(true);
                                try {
                                  await rejectCorpusCandidate(item.id);
                                  setDiscoveryQueue((q) => q.filter((x) => x.id !== item.id));
                                } catch {} finally {
                                  setDiscoveryBusy(false);
                                }
                              }}
                              className="rounded-md border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-[11px] text-[#8E95A5] hover:text-[#FFB4AE] cursor-pointer"
                            >
                              Rechazar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : authSession ? (
                    <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-3 text-xs text-[#8E95A5]">
                      Sin reportes pendientes en la cola. Usa «Buscar en RSS» para comprobar nuevas publicaciones.
                    </div>
                  ) : null}
                </div>
              </SplitRow>

              <SplitRow
                title="Documentos e informes indexados"
                description="Catálogo verificado disponible para consultas con citas."
                className="border-b-0"
              >
                <div className="divide-y divide-white/[0.06] max-h-64 overflow-y-auto border-t border-white/[0.06]">
                  {sources.length > 0 ? (
                    sources.map((rep, idx) => (
                      <div
                        key={`${rep.title}-${idx}`}
                        className="py-3 px-2 rounded-lg hover:bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition-colors"
                      >
                        <span className="text-[13px] text-white break-words sm:truncate">
                          {rep.title}
                        </span>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-[#D2D6E2]">
                            {rep.organization}
                          </span>
                          <span className="font-tech text-[11px] text-[#8E95A5]">
                            {formatDateTag(rep.ingested_at || rep.publication_date)}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="py-4 flex items-center justify-between gap-3 text-xs text-[#8E95A5]">
                      <span>
                        {authSession
                          ? 'Sin fuentes indexadas en PostgreSQL.'
                          : 'Inicia sesión para consultar las fuentes indexadas.'}
                      </span>
                      {!authSession && (
                        <button
                          type="button"
                          onClick={() => onOpenAuth?.('Inicia sesión para consultar el corpus CTI.')}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#2F6FED]/45 bg-[#2F6FED]/15 hover:bg-[#2F6FED]/25 px-2.5 py-1 text-xs text-white cursor-pointer"
                        >
                          <RefreshCw className="h-3 w-3" />
                          <span>Entrar</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </SplitRow>
            </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
