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
  const activeSectionMeta =
    CONFIG_SECTIONS.find((sec) => sec.id === activeSection) || CONFIG_SECTIONS[0];

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Cabecera estilo referencia: Breadcrumb Ajustes > Sección + acciones */}
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

      {/* Área Scrollable dividida en 2 columnas (Sidebar agrupado + Panel activo) */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
        <div className="animate-fade-up mx-auto max-w-[1060px] grid grid-cols-1 md:grid-cols-[215px_1fr] gap-6 lg:gap-10 pb-24">
          {/* Columna izquierda: Navegación categorizada estilo referencia */}
          <aside className="md:sticky md:top-0 md:self-start space-y-5">
            {['CUENTA', 'ESPACIO DE TRABAJO'].map((groupName) => {
              const items = CONFIG_SECTIONS.filter((sec) => sec.group === groupName);
              return (
                <div key={groupName} className="space-y-1">
                  <div className="px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[#7C7D87]">
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
                          className={`w-full flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] text-left shrink-0 transition-all duration-150 cursor-pointer ${
                            isActive
                              ? 'bg-[#2F6FED]/15 text-[#F2F2F4] border border-[#2F6FED]/40 font-medium shadow-[0_0_18px_rgba(47,111,237,0.14)]'
                              : 'border border-transparent text-[#9A9AA2] hover:text-[#F2F2F4] hover:bg-white/[0.04]'
                          }`}
                        >
                          <Icon
                            className={`h-4 w-4 shrink-0 ${
                              isActive ? 'text-[#8BB2FF]' : 'text-[#7C7D87]'
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

          {/* Columna derecha: Contenido limpio de la sección seleccionada */}
          <div className="min-w-0 space-y-6">
            <div className="border-b border-white/[0.07] pb-4">
              <h1 className="text-[19px] sm:text-[21px] font-semibold tracking-[-0.02em] text-[#F2F2F4]">
                {activeSectionMeta.label}
              </h1>
              <p className="mt-1 text-[12.5px] text-[#9A9AA2]">
                {activeSectionMeta.subtitle}
              </p>
            </div>

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
            {activeSection === 'cuenta' && (
            <section ref={cuentaRef} className="space-y-4">
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

                    <TwoFactorSettingsCard authSession={authSession} />
                    <RecoveryKeyCard />

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
            )}

            {/* Bloque 2 — Motor de IA universal (Groq por defecto u Ollama / Gemini / OpenAI / API propia) */}
            {activeSection === 'ia' && (
            <section ref={iaRef} className="space-y-4">
              {gov?.airGappedMode === true && <div role="status" className="rounded-xl border border-[#30D158]/30 bg-[#30D158]/10 p-3 text-sm text-[#8AEBA1]">
                <strong>Modo Soberano Local · Ningún dato sale de tu equipo</strong>
                <p className="mt-1 text-xs">IA local y consultas externas deshabilitadas en OMEGA. Requiere servicios locales sin reenvío; el aislamiento físico de red depende de la configuración del equipo.</p>
              </div>}
              {(() => {
                const govAi = gov?.ai_engine || null;
                const aiConfigured = Boolean(desktopAiConfig ? desktopAiConfig.configured : govAi?.configured);
                const activeProvider = desktopAiConfig?.activeProvider || govAi?.active_provider || 'extractive';
                const activeModel = desktopAiConfig?.activeModel || govAi?.active_model || 'omega-extractive-fallback';
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
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[#F2F2F4]">
                          Motor de IA (Groq por defecto o tu propia API)
                        </h2>
                        <p className="mt-0.5 text-[12px] text-[#9A9AA2]">
                          Usa Groq gratis por defecto o conecta Ollama local, Gemini, OpenAI, OpenRouter o cualquier endpoint `/v1`.
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                          aiConfigured
                            ? 'border-[#30D158]/35 bg-[#30D158]/10 text-[#30D158]'
                            : 'border-[#FF9F0A]/40 bg-[#FF9F0A]/12 text-[#FFD60A]'
                        }`}
                      >
                        {aiConfigured ? `Activo · ${activeProvider} (${activeModel})` : 'Sin motor · Modo extractivo'}
                      </span>
                    </div>

                    <form onSubmit={handleSaveAiEngine} className="apple-group rounded-[13px] p-4 sm:p-5 space-y-4">
                      {/* Selector visual de proveedor */}
                      <div className="space-y-2">
                        <div className="text-[11.5px] font-medium text-[#D2D6E2]">
                          Elige el proveedor de IA
                        </div>
                        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Selector de proveedor de IA">
                          {AI_PROVIDER_PRESETS.map((preset) => {
                            const selected = aiProviderDraft === preset.id;
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() => handleSelectAiPreset(preset.id)}
                                className={`inline-flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-[12px] font-medium transition-all cursor-pointer ${
                                  selected
                                    ? 'border-[#2F6FED]/65 bg-[rgba(28,36,56,0.78)] text-white shadow-[0_0_18px_rgba(47,111,237,0.22)]'
                                    : 'border-white/[0.08] bg-white/[0.03] text-[#9A9AA2] hover:border-white/[0.18] hover:text-[#F2F2F4]'
                                }`}
                              >
                                <span>{preset.label}</span>
                                <span className={`font-tech text-[10px] ${selected ? 'text-[#9EC0FF]' : 'text-[#7F879B]'}`}>
                                  {preset.badge}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Guía dinámica del proveedor elegido */}
                      <div className="rounded-[11px] border border-white/[0.08] bg-black/25 p-3.5 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[12.5px] font-semibold text-[#F2F2F4]">
                            {currentPreset.summary}
                          </span>
                          {docsTargetUrl && (
                            <button
                              type="button"
                              onClick={() => openExternalLink(docsTargetUrl)}
                              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#2F6FED]/50 bg-[#2F6FED]/15 hover:bg-[#2F6FED]/25 px-2.5 py-1 text-[11.5px] font-medium text-[#F2F2F4] transition-colors cursor-pointer shrink-0"
                            >
                              <span>{currentPreset.docsLabel}</span>
                              <ExternalLink className="h-3 w-3 text-[#6EA0FF]" />
                            </button>
                          )}
                        </div>
                        <ol className="space-y-1 text-[11.5px] text-[#B8C0D0] list-decimal list-inside leading-relaxed">
                          {currentPreset.steps.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      </div>

                      {/* Campos de conexión */}
                      <div className="space-y-3">
                        {(currentPreset.baseUrlEditable || aiProviderDraft !== 'groq') && (
                          <div>
                            <label htmlFor="omega-ai-base-url" className="block text-[12px] font-medium text-[#D2D6E2] mb-1">
                              Endpoint Base URL (compatible con OpenAI `/v1`)
                            </label>
                            <input
                              id="omega-ai-base-url"
                              type="text"
                              value={aiBaseUrlDraft}
                              readOnly={!currentPreset.baseUrlEditable}
                              onChange={(e) => setAiBaseUrlDraft(e.target.value)}
                              placeholder="https://tu-servidor.com/v1 o http://host.docker.internal:11434/v1"
                              className={`w-full h-9.5 px-3 rounded-[9px] border border-white/[0.1] text-[12.5px] font-tech text-[#F2F2F4] placeholder:text-[#8E96AB] focus:outline-none focus:border-[#2F6FED] ${
                                currentPreset.baseUrlEditable ? 'bg-[#0A0A0C]/75' : 'bg-[#0A0A0C]/45 text-[#B8C0D0]'
                              }`}
                            />
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-[1.25fr_1fr] gap-3">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label htmlFor="omega-ai-key" className="text-[12px] font-medium text-[#D2D6E2]">
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
                                    ? 'Deja vacío para conservar la clave guardada o pega otra'
                                    : currentPreset.keyPlaceholder
                                }
                                className="w-full h-9.5 pl-3 pr-10 rounded-[9px] bg-[#0A0A0C]/75 border border-white/[0.1] text-[12.5px] font-tech text-[#F2F2F4] placeholder:text-[#8E96AB] focus:outline-none focus:border-[#2F6FED]"
                              />
                              <button
                                type="button"
                                aria-label={showAiKey ? 'Ocultar clave' : 'Mostrar clave'}
                                onClick={() => setShowAiKey((v) => !v)}
                                className="absolute right-2.5 text-[#9A9AA2] hover:text-[#F2F2F4] cursor-pointer"
                              >
                                {showAiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          </div>

                          <div>
                            <label htmlFor="omega-ai-model" className="block text-[12px] font-medium text-[#D2D6E2] mb-1">
                              Modelo (Model ID)
                            </label>
                            <input
                              id="omega-ai-model"
                              type="text"
                              value={aiModelDraft}
                              onChange={(e) => setAiModelDraft(e.target.value)}
                              placeholder={currentPreset.defaultModel || 'ej. llama3.2'}
                              className="w-full h-9.5 px-3 rounded-[9px] bg-[#0A0A0C]/75 border border-white/[0.1] text-[12.5px] font-tech text-[#F2F2F4] placeholder:text-[#8E96AB] focus:outline-none focus:border-[#2F6FED]"
                            />
                          </div>
                        </div>

                        {(currentPreset.suggestedModels.length > 0 || detectedModels.length > 0) && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            <span className="text-[11px] text-[#9A9AA2] mr-1">
                              {detectedModels.length > 0 ? 'Detectados:' : 'Sugeridos:'}
                            </span>
                            {(detectedModels.length > 0 ? detectedModels : currentPreset.suggestedModels).slice(0, 8).map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => setAiModelDraft(m)}
                                className={`font-tech rounded-full border px-2 py-0.5 text-[10.5px] transition-colors cursor-pointer ${
                                  aiModelDraft === m
                                    ? 'border-[#2F6FED]/65 bg-[#2F6FED]/20 text-white'
                                    : 'border-white/[0.08] bg-white/[0.03] text-[#B8C0D0] hover:text-white'
                                }`}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                        )}

                        {aiProbeResult && (
                          <div
                            className={`rounded-[9px] border px-3 py-2 text-[12px] ${
                              aiProbeResult.ok
                                ? 'border-[#30D158]/35 bg-[#30D158]/10 text-[#B8F2C7]'
                                : 'border-[#FF453A]/35 bg-[#FF453A]/10 text-[#FFDAD6]'
                            }`}
                          >
                            {aiProbeResult.message}
                          </div>
                        )}
                      </div>

                      {isDesktopApp ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-white/[0.06]">
                          <span className="text-[11.5px] text-[#9A9AA2]">
                            Se guarda en el almacenamiento local seguro de OMEGA Desktop y recarga el backend automáticamente.
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={testingAiConn}
                              onClick={handleTestAiConnection}
                              className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.12] bg-white/[0.05] hover:bg-white/[0.09] disabled:opacity-55 px-3.5 py-2 text-[12px] font-medium text-[#F2F2F4] transition-all cursor-pointer"
                            >
                              <RefreshCw className={`h-3.5 w-3.5 ${testingAiConn ? 'animate-spin' : ''}`} />
                              <span>{testingAiConn ? 'Probando...' : 'Probar conexión'}</span>
                            </button>
                            <button
                              type="submit"
                              disabled={savingAiConfig}
                              className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#2F6FED] hover:brightness-110 disabled:opacity-55 px-4 py-2 text-[12.5px] font-medium text-white transition-all cursor-pointer"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              <span>{savingAiConfig ? 'Aplicando...' : 'Guardar y activar IA'}</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-[10px] border border-white/[0.08] bg-black/30 p-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[#B8C0D0]">
                            <span>En modo web puedes probar la conexión aquí y copiar las variables para tu <code className="font-tech text-[#F2F2F4]">omega/.env</code>:</span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={testingAiConn}
                                onClick={handleTestAiConnection}
                                className="inline-flex items-center gap-1 rounded-[7px] border border-white/[0.1] bg-white/[0.05] hover:bg-white/[0.1] px-2.5 py-1 text-[11px] text-[#F2F2F4] cursor-pointer"
                              >
                                <RefreshCw className={`h-3 w-3 ${testingAiConn ? 'animate-spin' : ''}`} />
                                <span>{testingAiConn ? 'Probando...' : 'Probar'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={handleCopyEnvSnippet}
                                className="inline-flex items-center gap-1 rounded-[7px] border border-white/[0.1] bg-white/[0.05] hover:bg-white/[0.1] px-2.5 py-1 text-[11px] text-[#F2F2F4] cursor-pointer"
                              >
                                {copiedEnvSnippet ? <Check className="h-3 w-3 text-[#30D158]" /> : <Copy className="h-3 w-3" />}
                                <span>{copiedEnvSnippet ? 'Copiado' : 'Copiar .env'}</span>
                              </button>
                            </div>
                          </div>
                          <pre className="font-tech text-[11px] text-[#9A9AA2] overflow-x-auto whitespace-pre-wrap">
                            {buildEnvSnippetText()}
                          </pre>
                        </div>
                      )}
                    </form>

                    {isDesktopApp && authSession?.role === 'ADMIN' && (
                      <form
                        onSubmit={handleSaveDesktopSmtp}
                        className="apple-group rounded-[13px] p-4 space-y-3 border border-white/[0.08]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-[13px] font-semibold text-[#F2F2F4]">
                              Correo SMTP local (opcional)
                            </div>
                            <p className="text-[11.5px] text-[#9A9AA2]">
                              Permite enviar códigos de recuperación y 2FA por correo usando tu propio servidor (p. ej. Gmail con App Password).
                            </p>
                          </div>
                          {desktopAiConfig?.smtpConfigured && (
                            <span className="font-tech rounded-full border border-[#30D158]/40 bg-[#30D158]/10 px-2.5 py-0.5 text-[10.5px] text-[#30D158]">
                              SMTP activo
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <input
                            type="text"
                            value={smtpHostDraft}
                            onChange={(e) => setSmtpHostDraft(e.target.value)}
                            placeholder="smtp.gmail.com"
                            className="sm:col-span-2 rounded-[8px] border border-white/[0.1] bg-black/35 px-3 py-1.5 text-[12px] text-[#F2F2F4] focus:outline-none focus:border-[#2F6FED]"
                          />
                          <input
                            type="number"
                            min={1}
                            max={65535}
                            value={smtpPortDraft}
                            onChange={(e) => setSmtpPortDraft(e.target.value)}
                            placeholder="587"
                            className="rounded-[8px] border border-white/[0.1] bg-black/35 px-3 py-1.5 text-[12px] text-[#F2F2F4] focus:outline-none focus:border-[#2F6FED]"
                          />
                          <input
                            type="email"
                            value={smtpUserDraft}
                            onChange={(e) => setSmtpUserDraft(e.target.value)}
                            placeholder="Usuario / Correo SMTP"
                            className="rounded-[8px] border border-white/[0.1] bg-black/35 px-3 py-1.5 text-[12px] text-[#F2F2F4] focus:outline-none focus:border-[#2F6FED]"
                          />
                          <input
                            type="password"
                            value={smtpPassDraft}
                            onChange={(e) => setSmtpPassDraft(e.target.value)}
                            placeholder={desktopAiConfig?.smtpConfigured ? 'Nueva App Password (opcional)' : 'App Password'}
                            className="rounded-[8px] border border-white/[0.1] bg-black/35 px-3 py-1.5 text-[12px] text-[#F2F2F4] focus:outline-none focus:border-[#2F6FED]"
                          />
                          <input
                            type="email"
                            value={smtpFromDraft}
                            onChange={(e) => setSmtpFromDraft(e.target.value)}
                            placeholder="Remitente (opcional)"
                            className="rounded-[8px] border border-white/[0.1] bg-black/35 px-3 py-1.5 text-[12px] text-[#F2F2F4] focus:outline-none focus:border-[#2F6FED]"
                          />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="submit"
                            disabled={savingSmtpConfig}
                            className="inline-flex items-center gap-1.5 rounded-[8px] border border-white/[0.12] bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-50 px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] cursor-pointer"
                          >
                            <span>{savingSmtpConfig ? 'Aplicando SMTP...' : 'Guardar SMTP local'}</span>
                          </button>
                        </div>
                      </form>
                    )}
                  </>
                );
              })()}
            </section>
            )}

            {/* Bloque 3 — Profundidad de Recuperación RAG */}
            {activeSection === 'rag' && (
            <div className="space-y-6">
            <section ref={ragRef} className="space-y-3">
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
            </div>
            )}

            {/* Bloque 4 — Permisos y Garantías Éticas */}
            {activeSection === 'permisos' && (
            <section ref={permisosRef} className="space-y-4">
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
            )}

            {/* Bloque 5 — Trazabilidad del Corpus Indexado */}
            {activeSection === 'corpus' && (
            <section ref={corpusRef} className="space-y-4">
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

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[13px] font-semibold text-[#F2F2F4]">
                      Cola de descubrimiento CTI (RSS/Atom · Aprobación humana)
                    </h3>
                    <p className="text-[11.5px] text-[#9A9AA2]">
                      Reportes nuevos detectados en Citizen Lab, Amnesty Security Lab y Google TAG pendientes de aprobación.
                    </p>
                  </div>
                  {authSession && (
                    <div className="flex items-center gap-2">
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
                        className="inline-flex items-center gap-1.5 rounded-[8px] border border-white/[0.1] bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] text-[#F2F2F4] hover:bg-white/[0.08] cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3 w-3 ${discoveryBusy ? 'animate-spin' : ''}`} />
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
                        className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#2F6FED]/45 bg-[#2F6FED]/15 px-2.5 py-1.5 text-[11.5px] text-[#F2F2F4] hover:bg-[#2F6FED]/25 cursor-pointer disabled:opacity-50"
                      >
                        <Globe className="h-3 w-3 text-[#6EA0FF]" />
                        <span>Buscar en RSS</span>
                      </button>
                    </div>
                  )}
                </div>

                {discoveryQueue.length > 0 && (
                  <div className="apple-group rounded-[13px] divide-y divide-white/[0.06] max-h-60 overflow-y-auto">
                    {discoveryQueue.map((item) => (
                      <div key={item.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-medium text-[#F2F2F4] truncate">{item.title}</div>
                          <div className="text-[11px] text-[#9A9AA2] truncate">
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
                            className="rounded-[7px] border border-[#30D158]/40 bg-[#30D158]/12 px-2.5 py-1 text-[11px] font-medium text-[#30D158] hover:bg-[#30D158]/22 cursor-pointer"
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
                            className="rounded-[7px] border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-[11px] text-[#9A9AA2] hover:text-[#FFB4AE] cursor-pointer"
                          >
                            Rechazar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <OmegaWebIntelCard
                compact
                title="Ingesta web CTI (RAM)"
                subtitle="Extrae IPs, dominios y CVEs de una URL técnica en memoria."
              />
            </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
