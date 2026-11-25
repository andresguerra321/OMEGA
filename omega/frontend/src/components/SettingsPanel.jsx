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
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  UserPlus,
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
  { value: 4, label: 'Rápido' },
  { value: 6, label: 'Balanceado' },
  { value: 10, label: 'Exhaustivo' },
  { value: 14, label: 'Integral' },
];

const SOURCE_OPTIONS = [
  {
    value: 'Todas las fuentes',
    title: 'Todas',
    description: 'Cruce global sobre todo el corpus verificado.',
  },
  {
    value: 'Citizen Lab',
    title: 'Citizen Lab',
    description: 'Investigaciones Pegasus, Candiru y QuaDream.',
  },
  {
    value: 'Amnesty Tech',
    title: 'Amnesty Tech',
    description: 'Metodología forense MVT y Predator.',
  },
  {
    value: 'Google TAG',
    title: 'Google TAG',
    description: 'Análisis de cadenas 0-day y vendedores.',
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
          ? 'bg-[#EDEDEF] justify-end'
          : 'bg-white/[0.12] justify-start'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`h-[18px] w-[18px] rounded-full shadow transition-transform duration-200 ${
          checked ? 'bg-[#09090B]' : 'bg-zinc-300'
        }`}
      />
    </button>
  );
}

function SplitRow({ title, description, children, className = '' }) {
  return (
    <div className={`py-6 border-t border-white/[0.06] space-y-4 ${className}`}>
      <div className="space-y-0.5">
        <h2 className="text-[14px] font-medium tracking-[-0.015em] text-[#EDEDEF]">{title}</h2>
        {description && (
          <p className="text-[12.5px] text-[#7E8691] leading-relaxed">{description}</p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
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
  activeSectionOverride = '',
  saveTrigger = 0,
  onSavedFeedback,
  onDirtyChange,
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

  const isDirty =
    topK !== savedTopK ||
    sourceScope !== savedScope ||
    passiveLinks !== savedPassiveLinks ||
    explicitConsent !== savedExplicitConsent;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

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
  const currentSection = activeSectionOverride || activeSection;
  const activeSectionMeta =
    CONFIG_SECTIONS.find((sec) => sec.id === currentSection) || CONFIG_SECTIONS[0];

  const govAi = gov?.ai_engine || null;
  const aiConfigured = Boolean(desktopAiConfig ? desktopAiConfig.configured : govAi?.configured);
  const activeProvider = desktopAiConfig?.activeProvider || govAi?.active_provider || 'extractive';
  const activeModel = desktopAiConfig?.activeModel || govAi?.active_model || 'omega-extractive-fallback';

  const expedientesCount = Number(tenantStats?.expedientes || 0);
  const documentsCount = Number(tenantStats?.documents || 0);

  return (
    <div className={embedded ? '' : 'h-full flex flex-col min-h-0 bg-[#09090B]'}>
      {!embedded && (
        <div className="shrink-0 border-b border-white/[0.06] bg-[#09090B] px-4 sm:px-8 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[14px]">
            <span className="font-medium tracking-[-0.015em] text-[#EDEDEF]">Ajustes</span>
            <span className="text-zinc-600">/</span>
            <span className="text-[#7E8691]">{activeSectionMeta.label}</span>
          </div>

          <div className="flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDiscardChanges}
              className="h-8 rounded-md text-xs text-zinc-400 hover:text-[#EDEDEF] px-2.5 transition-colors cursor-pointer"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={handleSaveChanges}
              className="h-8 rounded-md bg-[#EDEDEF] hover:bg-white text-[#09090B] px-3 text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer"
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

      <div
        ref={scrollContainerRef}
        className={embedded ? '' : 'flex-1 overflow-y-auto px-4 sm:px-8 py-7'}
      >
        <div
          className={
            embedded
              ? ''
              : 'w-full max-w-[1440px] 2xl:max-w-[1560px] mx-auto grid grid-cols-1 md:grid-cols-[220px_1fr] lg:grid-cols-[248px_1fr] gap-8 md:gap-10 pb-20'
          }
        >
          {/* Sidebar izquierda cuando no está embebido */}
          {!embedded && (
            <aside className="md:sticky md:top-0 md:self-start space-y-5">
              {[
                { title: 'General', ids: ['cuenta', 'permisos'] },
                { title: 'Inteligencia', ids: ['ia', 'rag', 'corpus'] },
              ].map((group) => {
                const items = group.ids
                  .map((id) => CONFIG_SECTIONS.find((s) => s.id === id))
                  .filter(Boolean);
                return (
                  <div key={group.title} className="space-y-1">
                    <div className="px-2.5 text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
                      {group.title}
                    </div>
                    <div className="flex md:flex-col gap-0.5 overflow-x-auto no-scrollbar">
                      {items.map((sec) => {
                        const isActive = currentSection === sec.id;
                        return (
                          <button
                            key={sec.id}
                            type="button"
                            onClick={() => scrollToSection(sec.id)}
                            className={`w-full rounded-md px-2.5 py-1.5 text-[13px] text-left shrink-0 transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-white/[0.06] text-[#EDEDEF] font-medium'
                                : 'text-[#7E8691] hover:text-zinc-200 hover:bg-white/[0.03]'
                            }`}
                          >
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

          {/* Columna de contenido abierta sobre #09090B (sin macro-tarjeta exterior) */}
          <div className="min-w-0">
            {(govError || (Boolean(authSession) && loadingGov) || actionBanner) && (
              <div className="space-y-3 mb-5">
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
                    lines={2}
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
            )}

            {/* 1. Mi perfil y sesión */}
            {currentSection === 'cuenta' && (
              <section ref={cuentaRef}>
                <header className="pb-5">
                  <h2 className="text-[15px] font-medium tracking-[-0.015em] text-[#EDEDEF]">
                    Mi perfil y sesión
                  </h2>
                  <p className="mt-0.5 text-[13px] text-[#7E8691]">
                    Identidad del espacio, aislamiento de sesión y verificación en dos pasos.
                  </p>
                </header>

                {authSession ? (
                  <dl className="border-t border-white/[0.06]">
                    <div className="border-b border-white/[0.05] py-3 px-2 -mx-2 rounded-md transition-colors duration-150 hover:bg-white/[0.02] flex items-center justify-between gap-4 text-[13px]">
                      <dt className="text-[#7E8691] shrink-0">Workspace ID</dt>
                      <dd className="flex items-center gap-2 min-w-0">
                        <code className="font-mono text-[12.5px] text-zinc-300 truncate">
                          {displayWorkspaceId}
                        </code>
                        <button
                          type="button"
                          onClick={handleCopyWorkspaceId}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:text-[#EDEDEF] hover:bg-white/[0.05] transition-all duration-150 active:scale-[0.96] cursor-pointer shrink-0"
                        >
                          {copiedId ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-400 transition-transform duration-150 scale-110" strokeWidth={1.75} />
                              <span className="text-emerald-400">Copiado</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" strokeWidth={1.75} />
                              <span>Copiar</span>
                            </>
                          )}
                        </button>
                      </dd>
                    </div>

                    <div className="border-b border-white/[0.05] py-3 px-2 -mx-2 rounded-md transition-colors duration-150 hover:bg-white/[0.02] flex items-center justify-between gap-4 text-[13px]">
                      <dt className="text-[#7E8691] shrink-0">Rol y espacio</dt>
                      <dd className="font-mono text-[12.5px] text-zinc-300 truncate">
                        {authSession.role} · @{authSession.tenantSlug || 'personal'}
                      </dd>
                    </div>

                    <div className="border-b border-white/[0.05] py-3 px-2 -mx-2 rounded-md transition-colors duration-150 hover:bg-white/[0.02] flex items-center justify-between gap-4 text-[13px]">
                      <dt className="text-[#7E8691] shrink-0">Recursos privados</dt>
                      <dd className="font-mono text-[12.5px] text-zinc-300 tabular-nums">
                        {expedientesCount} {expedientesCount === 1 ? 'espacio' : 'espacios'} · {documentsCount} PDFs
                      </dd>
                    </div>

                    <div className="border-b border-white/[0.05] py-3 px-2 -mx-2 rounded-md transition-colors duration-150 hover:bg-white/[0.02] flex flex-wrap items-center justify-between gap-3 text-[13px]">
                      <div className="flex items-center gap-2.5">
                        <dt className="text-[#7E8691]">Sesión</dt>
                        <span className="text-zinc-300 text-[12.5px]">
                          Aislada · Zero-Retention
                        </span>
                      </div>
                      <dd className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onLogout?.()}
                          className="h-7 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] hover:border-white/[0.16] px-2.5 text-xs text-zinc-400 hover:text-[#EDEDEF] transition-all duration-150 active:scale-[0.98] cursor-pointer"
                        >
                          <LogOut className="h-3 w-3" strokeWidth={1.75} />
                          <span>Cerrar sesión</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void onPanicPurge?.()}
                          className="h-7 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] px-2.5 text-xs text-zinc-400 hover:text-[#E5484D] hover:border-[#E5484D]/30 transition-all duration-150 active:scale-[0.98] cursor-pointer"
                        >
                          <Lock className="h-3 w-3" strokeWidth={1.75} />
                          <span>Purga rápida</span>
                        </button>
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <div className="border-t border-white/[0.06] py-5 flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-[13px] font-medium text-[#EDEDEF]">Sin cuenta conectada</div>
                      <div className="flex items-center gap-2 text-xs text-[#7E8691]">
                        <span>ID local:</span>
                        <code className="font-mono text-zinc-300">{displayWorkspaceId}</code>
                        <button
                          type="button"
                          onClick={handleCopyWorkspaceId}
                          className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:text-[#EDEDEF] hover:bg-white/[0.05] cursor-pointer"
                        >
                          {copiedId ? 'Copiado' : 'Copiar'}
                        </button>
                        <button
                          type="button"
                          onClick={handleRotateId}
                          className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:text-[#EDEDEF] hover:bg-white/[0.05] cursor-pointer"
                        >
                          {rotated ? 'Rotado' : 'Rotar'}
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenAuth?.('Inicia sesión o crea una cuenta para sincronizar tu biblioteca privada y OSINT.')
                      }
                      className="h-8 inline-flex items-center gap-1.5 rounded-md bg-[#EDEDEF] hover:bg-white px-3 text-xs font-medium text-[#09090B] transition-colors cursor-pointer"
                    >
                      <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} />
                      <span>Iniciar sesión</span>
                    </button>
                  </div>
                )}

                {authSession && (
                  <>
                    {/* Verificación en dos pasos (2FA) */}
                    <div className="py-6 space-y-4">
                      <div className="space-y-0.5">
                        <h3 className="text-[14px] font-medium tracking-[-0.015em] text-[#EDEDEF]">
                          Verificación en dos pasos (2FA)
                        </h3>
                        <p className="text-[12.5px] text-[#7E8691]">
                          Solicita un segundo código al iniciar sesión.
                        </p>
                      </div>
                      <TwoFactorSettingsCard authSession={authSession} embedded />
                    </div>

                    {/* Opciones avanzadas plegables */}
                    <div className="border-t border-white/[0.06] py-5">
                      <details className="group">
                        <summary className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer list-none select-none">
                          <span>
                            {authSession.role === 'ADMIN'
                              ? 'Opciones avanzadas: clave de recuperación, auditoría SHA-256 y equipo'
                              : 'Opciones avanzadas: clave de recuperación sin correo'}
                          </span>
                          <span className="font-mono text-[11px] text-zinc-500 group-open:rotate-180 transition-transform duration-150">
                            ▾
                          </span>
                        </summary>

                        <div className="mt-4 space-y-5 border-l border-white/[0.08] pl-4">
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-zinc-200">
                              Recuperación sin correo
                            </div>
                            <RecoveryKeyCard embedded />
                          </div>

                          {authSession.role === 'ADMIN' && (
                            <div className="space-y-3 pt-3 border-t border-white/[0.06]">
                              <div className="text-xs font-medium text-zinc-200">
                                Auditoría SHA-256 y miembros
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  disabled={verifyingAudit}
                                  onClick={handleVerifyAuditChain}
                                  className="h-8 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16] hover:text-[#EDEDEF] px-3 text-xs font-medium text-zinc-300 disabled:opacity-50 cursor-pointer transition-colors"
                                >
                                  <FileCheck2 className={`h-3.5 w-3.5 text-zinc-400 ${verifyingAudit ? 'animate-pulse' : ''}`} />
                                  <span>
                                    {verifyingAudit ? 'Verificando SHA-256...' : 'Verificar cadena de auditoría'}
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setShowInviteForm((v) => !v)}
                                  className="h-8 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16] hover:text-[#EDEDEF] px-3 text-xs font-medium text-zinc-300 cursor-pointer transition-colors"
                                >
                                  <UserPlus className="h-3.5 w-3.5 text-zinc-400" />
                                  <span>Crear analista / cliente</span>
                                </button>
                              </div>

                              {showInviteForm && (
                                <form
                                  noValidate
                                  onSubmit={handleInviteSubmit}
                                  className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 rounded-md border border-white/[0.07] bg-white/[0.015] p-3"
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
                                    className="h-8 rounded-md border border-white/[0.08] bg-[#09090B] px-2.5 text-xs text-[#EDEDEF] placeholder:text-zinc-500 focus:outline-none focus:border-white/30"
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
                                    className="h-8 rounded-md border border-white/[0.08] bg-[#09090B] px-2.5 text-xs text-[#EDEDEF] placeholder:text-zinc-500 focus:outline-none focus:border-white/30"
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
                                    className="h-8 rounded-md border border-white/[0.08] bg-[#09090B] px-2.5 text-xs text-[#EDEDEF] placeholder:text-zinc-500 focus:outline-none focus:border-white/30"
                                  />
                                  <div className="flex items-center gap-2">
                                    <select
                                      aria-label="Rol del nuevo usuario"
                                      value={inviteForm.role}
                                      onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value }))}
                                      className="h-8 flex-1 rounded-md border border-white/[0.08] bg-[#09090B] px-2 text-xs text-[#EDEDEF] focus:outline-none focus:border-white/30"
                                    >
                                      <option value="ANALYST">ANALYST (forense + CTI)</option>
                                      <option value="CLIENT">CLIENT (lectura + IOCs)</option>
                                      <option value="ADMIN">ADMIN (gestión total)</option>
                                    </select>
                                    <button
                                      type="submit"
                                      disabled={invitingUser}
                                      className="h-8 rounded-md bg-[#EDEDEF] hover:bg-white px-3 text-xs font-medium text-[#09090B] disabled:opacity-50 cursor-pointer"
                                    >
                                      {invitingUser ? '...' : 'Añadir'}
                                    </button>
                                  </div>
                                </form>
                              )}

                              {auditVerification && (
                                <div className="space-y-2 rounded-md border border-white/[0.07] bg-white/[0.015] p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                    <span
                                      className={`font-medium ${
                                        auditVerification.valid ? 'text-emerald-400' : 'text-[#E5484D]'
                                      }`}
                                    >
                                      {auditVerification.valid ? 'Integridad SHA-256 verificada' : 'Ruptura de cadena detectada'}
                                    </span>
                                    <span className="font-mono text-[11px] text-[#7E8691]">
                                      {auditVerification.verifiedCount}/{auditVerification.totalEntries} eventos ·{' '}
                                      {auditVerification.detail}
                                    </span>
                                  </div>
                                  {auditLogs.length > 0 && (
                                    <div className="max-h-40 overflow-y-auto divide-y divide-white/[0.05]">
                                      {auditLogs.map((ev) => (
                                        <div
                                          key={ev.id}
                                          className="py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono"
                                        >
                                          <span className="text-zinc-200">
                                            #{ev.chainSeq} · {ev.action} ({ev.resourceType})
                                          </span>
                                          <span className="text-[#7E8691]">
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
                        </div>
                      </details>
                    </div>
                  </>
                )}
              </section>
            )}

            {/* 2. Motor de IA */}
            {currentSection === 'ia' && (
              <section ref={iaRef}>
                <header className="pb-5 flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="text-[15px] font-medium tracking-[-0.015em] text-[#EDEDEF]">
                        Motor de IA
                      </h2>
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-zinc-400">
                        <span
                          className={`h-[6px] w-[6px] rounded-full shrink-0 ${
                            aiConfigured ? 'bg-emerald-400' : 'bg-amber-400'
                          }`}
                        />
                        <span>{aiConfigured ? activeProvider : 'extractivo'}</span>
                        {aiConfigured && (
                          <span className="text-zinc-500 hidden sm:inline">· {activeModel}</span>
                        )}
                      </span>
                    </div>
                    <p className="text-[13px] text-[#7E8691]">
                      Configura tu proveedor LLM (Groq, Ollama local, Gemini, OpenAI o API compatible).
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={testingAiConn}
                    onClick={handleTestAiConnection}
                    className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-[#EDEDEF] border border-white/[0.1] hover:border-white/[0.2] disabled:opacity-50 rounded-md transition-colors cursor-pointer shrink-0"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${testingAiConn ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                    <span>{testingAiConn ? 'Probando...' : 'Probar conexión'}</span>
                  </button>
                </header>

                {gov?.airGappedMode === true && (
                  <div role="status" className="mb-4 rounded-md border border-emerald-400/25 bg-emerald-400/[0.06] px-3.5 py-2.5 text-xs text-emerald-300">
                    <strong className="font-medium">Modo Soberano Local</strong> · Consultas externas deshabilitadas en OMEGA.
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
                        <SplitRow
                          title="Proveedor LLM"
                          description="Groq ofrece plan gratuito rápido; Ollama y LM Studio corren 100% en tu equipo."
                        >
                          <div
                            className="grid grid-cols-2 sm:grid-cols-4 gap-2"
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
                                  className={`p-2.5 rounded-md border text-left transition-all duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] cursor-pointer ${
                                    selected
                                      ? 'bg-white/[0.05] border-white/30 text-[#EDEDEF]'
                                      : 'border-white/[0.07] bg-white/[0.015] text-zinc-300 hover:border-white/[0.16] hover:text-[#EDEDEF]'
                                  }`}
                                >
                                  <div className="text-[13px] font-medium truncate">
                                    {preset.label.replace(' (Por defecto)', '').replace(' (Local)', '')}
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-zinc-500 truncate">
                                    {preset.badge}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </SplitRow>

                        <SplitRow
                          title="Credenciales y Modelo"
                          description="Ingresa tu API Key y elige el modelo de conversación."
                        >
                          <div className="space-y-4">
                            {(currentPreset.baseUrlEditable || aiProviderDraft !== 'groq') && (
                              <div>
                                <label htmlFor="omega-ai-base-url" className="block text-xs font-medium text-zinc-300 mb-1.5">
                                  Endpoint Base URL (<code className="font-mono text-zinc-400">/v1</code>)
                                </label>
                                <input
                                  id="omega-ai-base-url"
                                  type="text"
                                  value={aiBaseUrlDraft}
                                  readOnly={!currentPreset.baseUrlEditable}
                                  onChange={(e) => setAiBaseUrlDraft(e.target.value)}
                                  placeholder="https://tu-servidor.com/v1 o http://host.docker.internal:11434/v1"
                                  className={`w-full h-9 px-3 rounded-md border border-white/[0.08] text-xs font-mono text-[#EDEDEF] placeholder:text-zinc-500 focus:outline-none focus:border-white/30 ${
                                    currentPreset.baseUrlEditable ? 'bg-white/[0.02]' : 'bg-white/[0.01] text-zinc-500'
                                  }`}
                                />
                              </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                              <div>
                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                  <label htmlFor="omega-ai-key" className="text-xs font-medium text-zinc-300">
                                    API Key {!currentPreset.keyRequired ? '(opcional)' : ''}
                                  </label>
                                  <div className="flex items-center gap-2">
                                    {savedHint && (
                                      <span className="font-mono text-[10.5px] text-emerald-400">
                                        Guardada ({savedHint})
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => setShowAiGuide((v) => !v)}
                                      aria-expanded={showAiGuide}
                                      className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                                    >
                                      ¿Cómo obtener tu API Key?
                                    </button>
                                  </div>
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
                                    className="w-full h-9 pl-3 pr-9 rounded-md bg-white/[0.02] border border-white/[0.08] text-xs font-mono text-[#EDEDEF] placeholder:text-zinc-500 focus:outline-none focus:border-white/30"
                                  />
                                  <button
                                    type="button"
                                    aria-label={showAiKey ? 'Ocultar clave' : 'Mostrar clave'}
                                    onClick={() => setShowAiKey((v) => !v)}
                                    className="absolute right-2.5 text-zinc-500 hover:text-zinc-200 cursor-pointer"
                                  >
                                    {showAiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                  </button>
                                </div>
                              </div>

                              <div>
                                <label htmlFor="omega-ai-model" className="block text-xs font-medium text-zinc-300 mb-1.5">
                                  Model ID
                                </label>
                                <input
                                  id="omega-ai-model"
                                  type="text"
                                  value={aiModelDraft}
                                  onChange={(e) => setAiModelDraft(e.target.value)}
                                  placeholder={currentPreset.defaultModel || 'ej. llama3.2'}
                                  className="w-full h-9 px-3 rounded-md bg-white/[0.02] border border-white/[0.08] text-xs font-mono text-[#EDEDEF] placeholder:text-zinc-500 focus:outline-none focus:border-white/30"
                                />
                              </div>
                            </div>

                            {showAiGuide && (
                              <div className="border-l border-white/[0.12] pl-3.5 py-1 space-y-2 text-xs text-[#7E8691]">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-zinc-300">{currentPreset.summary}</span>
                                  {docsTargetUrl && (
                                    <button
                                      type="button"
                                      onClick={() => openExternalLink(docsTargetUrl)}
                                      className="inline-flex items-center gap-1 text-xs text-zinc-300 hover:text-[#EDEDEF] underline decoration-white/20 underline-offset-4 cursor-pointer shrink-0"
                                    >
                                      <span>{currentPreset.docsLabel}</span>
                                      <ExternalLink className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                                <ol className="space-y-1 list-decimal list-inside leading-relaxed">
                                  {currentPreset.steps.map((step, i) => (
                                    <li key={i}>{step}</li>
                                  ))}
                                </ol>
                              </div>
                            )}

                            {(currentPreset.suggestedModels.length > 0 || detectedModels.length > 0) && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[11px] text-zinc-500 mr-1">
                                  {detectedModels.length > 0 ? 'Detectados:' : 'Sugeridos:'}
                                </span>
                                {(detectedModels.length > 0 ? detectedModels : currentPreset.suggestedModels)
                                  .slice(0, 8)
                                  .map((m) => (
                                    <button
                                      key={m}
                                      type="button"
                                      onClick={() => setAiModelDraft(m)}
                                      className={`font-mono text-[11px] rounded px-2 py-1 transition-colors cursor-pointer ${
                                        aiModelDraft === m
                                          ? 'bg-white/[0.1] text-[#EDEDEF]'
                                          : 'bg-white/[0.03] hover:bg-white/[0.07] text-zinc-400 hover:text-zinc-200'
                                      }`}
                                    >
                                      {m}
                                    </button>
                                  ))}
                              </div>
                            )}

                            {aiProbeResult && (
                              <div
                                className={`rounded-md border px-3 py-2 text-xs ${
                                  aiProbeResult.ok
                                    ? 'border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-300'
                                    : 'border-[#E5484D]/35 bg-[#E5484D]/[0.08] text-[#FFB4AE]'
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
                                  className="h-8 inline-flex items-center gap-1.5 rounded-md bg-[#EDEDEF] hover:bg-white disabled:opacity-50 px-3.5 text-xs font-medium text-[#09090B] transition-colors cursor-pointer"
                                >
                                  <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
                                  <span>{savingAiConfig ? 'Aplicando...' : 'Guardar y activar IA'}</span>
                                </button>
                              </div>
                            ) : (
                              <details className="group rounded-lg border border-white/[0.08] bg-[#0C0C0F] overflow-hidden">
                                <summary className="h-9 px-3 flex items-center justify-between gap-2 bg-white/[0.02] text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer list-none select-none">
                                  <span className="font-mono text-[11.5px]">
                                    Variables para <span className="text-zinc-200">omega/.env</span> (modo web)
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      handleCopyEnvSnippet();
                                    }}
                                    className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-[#EDEDEF] transition-colors cursor-pointer"
                                  >
                                    {copiedEnvSnippet ? (
                                      <>
                                        <Check className="h-3 w-3 text-emerald-400" strokeWidth={1.75} />
                                        <span className="text-emerald-400">Copiado</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="h-3 w-3" strokeWidth={1.75} />
                                        <span>Copiar .env</span>
                                      </>
                                    )}
                                  </button>
                                </summary>
                                <pre className="border-t border-white/[0.06] p-3.5 font-mono text-[11.5px] leading-relaxed text-zinc-300 overflow-x-auto whitespace-pre-wrap select-all">
                                  {buildEnvSnippetText()}
                                </pre>
                              </details>
                            )}
                          </div>
                        </SplitRow>
                      </form>

                      {isDesktopApp && authSession?.role === 'ADMIN' && (
                        <SplitRow
                          title="Opciones avanzadas"
                          description="Correo SMTP local opcional para códigos de recuperación y 2FA."
                        >
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => setShowSmtpAdvanced((prev) => !prev)}
                                aria-expanded={showSmtpAdvanced}
                                className="h-8 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] px-3 text-xs font-medium text-zinc-300 hover:border-white/[0.16] hover:text-[#EDEDEF] transition-colors cursor-pointer"
                              >
                                <span>Configurar SMTP local {showSmtpAdvanced ? '▴' : '▾'}</span>
                              </button>
                              {desktopAiConfig?.smtpConfigured && (
                                <span className="font-mono text-[11px] text-emerald-400">
                                  • SMTP activo
                                </span>
                              )}
                            </div>

                            {showSmtpAdvanced && (
                              <form onSubmit={handleSaveDesktopSmtp} className="rounded-md bg-white/[0.015] border border-white/[0.07] p-3.5 space-y-3">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                  <input
                                    type="text"
                                    value={smtpHostDraft}
                                    onChange={(e) => setSmtpHostDraft(e.target.value)}
                                    placeholder="Servidor (ej. smtp.gmail.com)"
                                    className="h-9 rounded-md border border-white/[0.08] bg-[#09090B] px-3 text-xs text-[#EDEDEF] placeholder:text-zinc-500 focus:outline-none focus:border-white/30"
                                  />
                                  <input
                                    type="number"
                                    min={1}
                                    max={65535}
                                    value={smtpPortDraft}
                                    onChange={(e) => setSmtpPortDraft(e.target.value)}
                                    placeholder="Puerto (ej. 587)"
                                    className="h-9 rounded-md border border-white/[0.08] bg-[#09090B] px-3 text-xs text-[#EDEDEF] placeholder:text-zinc-500 focus:outline-none focus:border-white/30"
                                  />
                                  <input
                                    type="email"
                                    value={smtpUserDraft}
                                    onChange={(e) => setSmtpUserDraft(e.target.value)}
                                    placeholder="Usuario / Correo SMTP"
                                    className="h-9 rounded-md border border-white/[0.08] bg-[#09090B] px-3 text-xs text-[#EDEDEF] placeholder:text-zinc-500 focus:outline-none focus:border-white/30"
                                  />
                                  <input
                                    type="password"
                                    value={smtpPassDraft}
                                    onChange={(e) => setSmtpPassDraft(e.target.value)}
                                    placeholder={desktopAiConfig?.smtpConfigured ? 'Nueva App Password (opcional)' : 'App Password'}
                                    className="h-9 rounded-md border border-white/[0.08] bg-[#09090B] px-3 text-xs text-[#EDEDEF] placeholder:text-zinc-500 focus:outline-none focus:border-white/30"
                                  />
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2.5">
                                  <input
                                    type="email"
                                    value={smtpFromDraft}
                                    onChange={(e) => setSmtpFromDraft(e.target.value)}
                                    placeholder="Remitente (opcional)"
                                    className="h-9 flex-1 min-w-[200px] rounded-md border border-white/[0.08] bg-[#09090B] px-3 text-xs text-[#EDEDEF] placeholder:text-zinc-500 focus:outline-none focus:border-white/30"
                                  />
                                  <button
                                    type="submit"
                                    disabled={savingSmtpConfig}
                                    className="h-9 inline-flex items-center gap-1.5 rounded-md bg-[#EDEDEF] hover:bg-white disabled:opacity-50 px-3.5 text-xs font-medium text-[#09090B] transition-colors cursor-pointer"
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

            {/* 3. Motor RAG */}
            {currentSection === 'rag' && (
              <section ref={ragRef}>
                <header className="pb-5">
                  <h2 className="text-[15px] font-medium tracking-[-0.015em] text-[#EDEDEF]">
                    Motor RAG
                  </h2>
                  <p className="mt-0.5 text-[13px] text-[#7E8691]">
                    Recuperación híbrida RRF
                  </p>
                </header>

                <SplitRow
                  title="Alcance de evidencia (Top-K)"
                  description="Define cuántos fragmentos evalúa el motor híbrido antes de redactar cada respuesta."
                >
                  <div
                    role="radiogroup"
                    aria-label="Alcance de evidencia Top-K"
                    className="inline-grid grid-cols-4 w-full sm:w-auto bg-white/[0.02] p-1 rounded-lg border border-white/[0.08]"
                  >
                    {TOPK_OPTIONS.map((opt) => {
                      const selected = topK === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => onChangeTopK?.(opt.value)}
                          className={`px-4 py-2 rounded-md text-center transition-all duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] cursor-pointer ${
                            selected
                              ? 'bg-white/[0.08] text-[#EDEDEF]'
                              : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          <div className="font-mono text-[13px] font-medium tabular-nums">
                            {opt.value}
                          </div>
                          <div className={`text-[11px] mt-0.5 ${selected ? 'text-zinc-300' : 'text-zinc-500'}`}>
                            {opt.label}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </SplitRow>

                <SplitRow
                  title="Fuentes prioritarias"
                  description="Prioriza qué reportes de investigación pesan más en tus consultas."
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {SOURCE_OPTIONS.map((opt) => {
                      const selected = sourceScope === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => onChangeSourceScope?.(opt.value)}
                          className={`rounded-lg border p-3.5 text-left transition-all duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] cursor-pointer ${
                            selected
                              ? 'border-white/30 bg-white/[0.04] text-[#EDEDEF]'
                              : 'border-white/[0.07] bg-white/[0.015] text-zinc-300 hover:border-white/[0.16]'
                          }`}
                        >
                          <div className="text-[13px] font-medium text-[#EDEDEF]">
                            {opt.title}
                          </div>
                          <p className="mt-1 text-xs text-[#7E8691] leading-relaxed">
                            {opt.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </SplitRow>
              </section>
            )}

            {/* 4. Permisos y ética */}
            {currentSection === 'permisos' && (
              <section ref={permisosRef}>
                <header className="pb-5">
                  <h2 className="text-[15px] font-medium tracking-[-0.015em] text-[#EDEDEF]">
                    Permisos y ética
                  </h2>
                  <p className="mt-0.5 text-[13px] text-[#7E8691]">
                    Garantías defensivas, enlaces pasivos y consentimiento explícito.
                  </p>
                </header>

                <div className="border-t border-white/[0.06] divide-y divide-white/[0.06]">
                  <div className="py-4 flex items-center justify-between gap-4">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-medium text-[#EDEDEF]">
                          Procesamiento en memoria (RAM)
                        </span>
                        <span className="font-mono text-[10.5px] text-zinc-500">
                          Obligatorio
                        </span>
                      </div>
                      <p className="text-xs text-[#7E8691]">
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
                      <div className="text-[13.5px] font-medium text-[#EDEDEF]">
                        Inspección pasiva de enlaces
                      </div>
                      <p className="text-xs text-[#7E8691]">
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
                      <div className="text-[13.5px] font-medium text-[#EDEDEF]">
                        Confirmación previa en auditorías de dominio
                      </div>
                      <p className="text-xs text-[#7E8691]">
                        Solicita autorización explícita antes de consultar un dominio o correo.
                      </p>
                    </div>
                    <TogglePill
                      checked={explicitConsent}
                      onChange={setExplicitConsent}
                      label="Consentimiento explícito OSINT"
                    />
                  </div>

                  <div className="py-4 flex items-center justify-between gap-4">
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-[13.5px] font-medium text-[#EDEDEF]">
                        Sin caché de credenciales en navegador
                      </div>
                      <p className="text-xs text-[#7E8691]">
                        OMEGA nunca persiste contraseñas ni conversaciones en localStorage.
                      </p>
                    </div>
                    <span className="shrink-0 inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-400">
                      <span className="h-[5px] w-[5px] rounded-full bg-emerald-400" />
                      <span>Activo</span>
                    </span>
                  </div>
                </div>
              </section>
            )}

            {/* 5. Corpus indexado */}
            {currentSection === 'corpus' && (
              <section ref={corpusRef}>
                <header className="pb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-medium tracking-[-0.015em] text-[#EDEDEF]">
                      Corpus indexado
                    </h2>
                    <p className="mt-0.5 font-mono text-[12px] text-[#7E8691]">
                      {stats
                        ? `${stats.reports} Reportes · ${stats.chunks} Fragmentos · ${Number(stats.iocs || 0).toLocaleString('en-US')} IOCs`
                        : 'Documentos e informes CTI verificados e ingesta web en memoria.'}
                    </p>
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
                        } catch {
                          // ignore
                        } finally {
                          setDiscoveryBusy(false);
                        }
                      }}
                      className="h-8 inline-flex items-center gap-1.5 rounded-md border border-white/[0.1] hover:border-white/[0.2] bg-white/[0.02] hover:bg-white/[0.05] disabled:opacity-50 px-3 text-xs font-medium text-zinc-300 hover:text-[#EDEDEF] transition-colors cursor-pointer shrink-0"
                    >
                      <Globe className="h-3.5 w-3.5 text-zinc-400" strokeWidth={1.75} />
                      <span>Buscar en RSS</span>
                    </button>
                  )}
                </header>

                <SplitRow
                  title="Ingesta web CTI en RAM"
                  description="Extrae indicadores técnicos de una URL de investigación directamente en memoria."
                >
                  <OmegaWebIntelCard
                    compact
                    title="Ingesta web CTI (RAM)"
                    subtitle="Extrae IPs, dominios y CVEs de una URL técnica en memoria."
                  />
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
                            } catch {
                              // ignore
                            } finally {
                              setDiscoveryBusy(false);
                            }
                          }}
                          className="h-8 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16] px-3 text-xs text-zinc-300 hover:text-[#EDEDEF] cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${discoveryBusy ? 'animate-spin' : ''}`} />
                          <span>Cargar cola</span>
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-[#7E8691]">Inicia sesión para gestionar la cola RSS.</p>
                    )}

                    {discoveryQueue.length > 0 ? (
                      <div className="divide-y divide-white/[0.06] border-t border-white/[0.06] max-h-60 overflow-y-auto">
                        {discoveryQueue.map((item) => (
                          <div key={item.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-[#EDEDEF] truncate">{item.title}</div>
                              <div className="text-[11px] text-[#7E8691] truncate">
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
                                  } catch {
                                    // ignore
                                  } finally {
                                    setDiscoveryBusy(false);
                                  }
                                }}
                                className="rounded-md bg-[#EDEDEF] hover:bg-white px-2.5 py-1 text-[11px] font-medium text-[#09090B] cursor-pointer"
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
                                  } catch {
                                    // ignore
                                  } finally {
                                    setDiscoveryBusy(false);
                                  }
                                }}
                                className="rounded-md border border-white/[0.08] px-2.5 py-1 text-[11px] text-zinc-400 hover:text-[#E5484D] hover:border-[#E5484D]/30 cursor-pointer"
                              >
                                Rechazar
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : authSession ? (
                      <div className="rounded-md border border-dashed border-white/[0.08] px-4 py-3 text-xs text-[#7E8691]">
                        Sin reportes pendientes en la cola. Usa «Buscar en RSS» para comprobar nuevas publicaciones.
                      </div>
                    ) : null}
                  </div>
                </SplitRow>

                <SplitRow
                  title="Documentos e informes indexados"
                  description="Catálogo verificado disponible para consultas con citas."
                >
                  <div className="divide-y divide-white/[0.06] max-h-64 overflow-y-auto border-t border-white/[0.06]">
                    {sources.length > 0 ? (
                      sources.map((rep, idx) => (
                        <div
                          key={`${rep.title}-${idx}`}
                          className="py-3 hover:bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition-colors"
                        >
                          <span className="text-[13px] text-[#EDEDEF] break-words sm:truncate">
                            {rep.title}
                          </span>

                          <div className="flex items-center gap-2.5 shrink-0 font-mono text-[11px] text-[#7E8691]">
                            <span>{rep.organization}</span>
                            <span className="text-zinc-600">·</span>
                            <span>{formatDateTag(rep.ingested_at || rep.publication_date)}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="py-4 flex items-center justify-between gap-3 text-xs text-[#7E8691]">
                        <span>
                          {authSession
                            ? 'Sin fuentes indexadas en PostgreSQL.'
                            : 'Inicia sesión para consultar las fuentes indexadas.'}
                        </span>
                        {!authSession && (
                          <button
                            type="button"
                            onClick={() => onOpenAuth?.('Inicia sesión para consultar el corpus CTI.')}
                            className="h-7 inline-flex items-center gap-1 rounded-md border border-white/[0.1] hover:border-white/[0.2] px-2.5 text-xs text-zinc-300 hover:text-[#EDEDEF] cursor-pointer"
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
