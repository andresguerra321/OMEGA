import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Fingerprint,
  ClipboardPaste,
  X,
  Plus,
  FolderLock,
  FileUp,
  CheckCircle2,
  Database,
  RefreshCw,
  AlertTriangle,
  Lock,
} from 'lucide-react';
import { OmegaShaderOrb } from './OmegaShaderOrb';
import { StructuredResponse } from './StructuredResponse';
import { SourcesPanel } from './SourcesPanel';

const QUICK_BRIEFS = [
  {
    tag: 'iOS · Pegasus',
    title: 'CVEs zero-click FORCEDENTRY y BLASTPASS',
    prompt:
      '¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus y qué versiones de iOS afectaron?',
  },
  {
    tag: 'Predator · Candiru',
    title: 'Campañas, sectores objetivo e infraestructura C2',
    prompt:
      '¿Qué sectores y regiones fueron objetivo en las campañas de Predator e Intellexa?',
  },
  {
    tag: 'Forense · MVT',
    title: 'Artefactos de infección en backups iOS',
    prompt:
      'Resume los principales artefactos forenses e indicadores de compromiso descritos en los reportes.',
  },
];

const SOURCE_OPTIONS = [
  { value: 'Todas las fuentes', label: 'Todas' },
  { value: 'Citizen Lab', label: 'Citizen Lab' },
  { value: 'Amnesty Tech', label: 'Amnesty' },
  { value: 'Google TAG', label: 'Google TAG' },
];

const SAMPLE_IOCS = ['CVE-2021-30860', 'CVE-2023-41064', 'shorten.fi'];

const DETECT_IOC_RE =
  /(\bCVE-\d{4}-\d{4,7}\b|\b[a-f0-9]{64}\b|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ca|uk|xyz|top|info|me|co|gov|edu|online|site|fi|page)\b)/i;

function SourceScopePills({ value, onChange, compact = false }) {
  return (
    <div
      role="group"
      aria-label="Filtrar fuentes"
      className="apple-segmented inline-flex flex-wrap items-center gap-0.5 rounded-[9px] p-0.5"
    >
      {SOURCE_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-[7px] font-medium tracking-[-0.01em] transition-[background-color,color,box-shadow] duration-200 ease-apple cursor-pointer ${
              compact ? 'px-2.5 py-1 text-[11.5px]' : 'px-3 py-1 text-[12px]'
            } ${
              active
                ? 'apple-segmented-active'
                : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const QUICK_FAMILIES = [
  'Pegasus (NSO Group)',
  'Predator (Intellexa)',
  'Candiru (Saito Tech)',
  'QuaDream (Reign)',
  'NoviSpy',
];

function ContextBox({ context, onUpdateContext, onClearContext, lastRewrittenQuery }) {
  const safeCtx = context || { family: null, os: null, cve: null };
  const hasContext = Boolean(safeCtx.family || safeCtx.os || safeCtx.cve);

  return (
    <div
      data-testid="omega-context-box"
      className="mx-auto max-w-[780px] mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[11px] border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11.5px]"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[#9A9AA2]">Contexto activo:</span>

        {hasContext ? (
          <>
            {safeCtx.family && (
              <span className="font-tech inline-flex items-center gap-1 rounded-full border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-2.5 py-0.5 text-[11px] text-[#F2F2F4]">
                {safeCtx.family}
                <button
                  type="button"
                  aria-label="Quitar familia activa"
                  onClick={() => onUpdateContext?.({ ...safeCtx, family: null })}
                  className="hover:text-white ml-0.5 cursor-pointer"
                >
                  ×
                </button>
              </span>
            )}
            {safeCtx.os && (
              <span className="font-tech inline-flex items-center gap-1 rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-0.5 text-[11px] text-[#F2F2F4]">
                SO: {safeCtx.os}
                <button
                  type="button"
                  aria-label="Quitar SO activo"
                  onClick={() => onUpdateContext?.({ ...safeCtx, os: null })}
                  className="hover:text-white ml-0.5 cursor-pointer"
                >
                  ×
                </button>
              </span>
            )}
            {safeCtx.cve && (
              <span className="font-tech inline-flex items-center gap-1 rounded-full border border-[#30D158]/35 bg-[#30D158]/10 px-2.5 py-0.5 text-[11px] text-[#30D158]">
                {safeCtx.cve}
                <button
                  type="button"
                  aria-label="Quitar CVE activo"
                  onClick={() => onUpdateContext?.({ ...safeCtx, cve: null })}
                  className="hover:text-white ml-0.5 cursor-pointer"
                >
                  ×
                </button>
              </span>
            )}
          </>
        ) : (
          <select
            aria-label="Fijar familia de spyware en contexto"
            value=""
            onChange={(e) => {
              if (e.target.value) {
                onUpdateContext?.({ ...safeCtx, family: e.target.value });
              }
            }}
            className="font-tech rounded-[7px] border border-white/[0.09] bg-[#141418] px-2.5 py-0.5 text-[11px] text-[#9A9AA2] focus:border-[#2F6FED]/70 focus:text-[#F2F2F4] focus:outline-none cursor-pointer"
          >
            <option value="">Auto-detectar entidad...</option>
            {QUICK_FAMILIES.map((fam) => (
              <option key={fam} value={fam}>
                Fijar: {fam}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        {lastRewrittenQuery && (
          <span
            title={`Consulta expandida para RRF: ${lastRewrittenQuery}`}
            className="font-tech hidden sm:inline max-w-[260px] truncate text-[10.5px] text-[#9A9AA2]"
          >
            RRF → {lastRewrittenQuery}
          </span>
        )}
        {hasContext && (
          <button
            type="button"
            onClick={() => onClearContext?.()}
            className="text-[11px] text-[#9A9AA2] hover:text-[#F2F2F4] transition-colors cursor-pointer"
          >
            Limpiar
          </button>
        )}
      </div>
    </div>
  );
}

export function ChatWorkspace({
  messages,
  loading,
  sourceScope,
  onChangeSourceScope,
  onSendMessage,
  onRetryFailedTurn,
  chatContext,
  lastRewrittenQuery,
  onUpdateChatContext,
  onClearChatContext,
  activeCitation,
  onSelectCitation,
  isSourcesOpen,
  onToggleSources,
  onCloseSources,
  allConversationCitations,
  hasHistory,
  onResumeLastSession,
  textareaRef,
  authSession = null,
  onOpenAuth,
  expedientes = [],
  activeExpedienteId = '',
  onSelectExpediente,
  expedienteDocs = [],
  loadingExpedientes = false,
  uploadingPdf = false,
  expedienteNotice = '',
  expedienteError = '',
  onDismissExpedienteBanner,
  onCreateExpediente,
  onUploadExpedientePdf,
  onRefreshExpedienteDocs,
}) {
  const [input, setInput] = useState('');
  const [iocPopoverOpen, setIocPopoverOpen] = useState(false);
  const [iocDraft, setIocDraft] = useState('');
  const [iocFeedback, setIocFeedback] = useState('');
  const [creatingExp, setCreatingExp] = useState(false);
  const [newExpTitle, setNewExpTitle] = useState('');
  const [newExpClass, setNewExpClass] = useState('CONFIDENTIAL');
  const bottomRef = useRef(null);
  const threadScrollRef = useRef(null);
  const iocInputRef = useRef(null);
  const pdfInputRef = useRef(null);

  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  function keepBottomAligned() {
    const el = threadScrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }

  useEffect(() => {
    if (iocPopoverOpen) {
      setTimeout(() => iocInputRef.current?.focus(), 40);
    }
  }, [iocPopoverOpen]);

  const detectedIoc = useMemo(() => {
    const match = input.match(DETECT_IOC_RE);
    return match ? match[0] : null;
  }, [input]);

  function submitQuery(rawPrompt) {
    const clean = (rawPrompt ?? input).trim();
    if (!clean || loading) return;
    setIocPopoverOpen(false);
    onSendMessage(clean, sourceScope);
    if (!rawPrompt) setInput('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitQuery();
    }
  }

  function insertIocValue(rawValue) {
    const cleaned = (rawValue || '').trim();
    if (!cleaned) return;

    setInput((prev) => {
      const current = prev.trim();
      if (!current) {
        return `¿Qué reportes y campañas se asocian a ${cleaned}?`;
      }
      if (current.toLowerCase().includes(cleaned.toLowerCase())) {
        return prev;
      }
      return `${current} ${cleaned}`;
    });
    setIocDraft('');
    setIocFeedback(`+ ${cleaned}`);
    setIocPopoverOpen(false);
    setTimeout(() => setIocFeedback(''), 1800);
    setTimeout(() => textareaRef?.current?.focus(), 40);
  }

  async function handlePasteClipboardIoc() {
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (!clip) {
        setIocFeedback('Portapapeles vacío');
        setTimeout(() => setIocFeedback(''), 1800);
        return;
      }
      const firstToken = clip.split(/\s+/)[0].slice(0, 128);
      insertIocValue(firstToken);
    } catch {
      setIocFeedback('Pega el IOC abajo');
      setTimeout(() => setIocFeedback(''), 1800);
      iocInputRef.current?.focus();
    }
  }

  function renderIocHelperBar() {
    if (!iocPopoverOpen) return null;
    return (
      <div className="apple-well mt-2.5 rounded-[11px] p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={iocInputRef}
            type="text"
            value={iocDraft}
            onChange={(e) => setIocDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                insertIocValue(iocDraft);
              }
            }}
            placeholder="CVE-2023-41064, dominio o hash..."
            className="font-tech flex-1 min-w-[180px] rounded-[8px] border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-[12.5px] text-[#F2F2F4] placeholder-[#9A9AA2] focus:border-[#2F6FED]/70 focus:outline-none transition-colors"
          />
          <button
            type="button"
            onClick={() => insertIocValue(iocDraft)}
            disabled={!iocDraft.trim()}
            className="rounded-[8px] bg-[#2F6FED] px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-[#2F6FED]/90 hover:shadow-[0_0_20px_rgba(47,111,237,0.3)] disabled:bg-white/[0.06] disabled:text-[#9A9AA2] active:scale-[0.96] transition-all cursor-pointer"
          >
            Usar
          </button>
          <button
            type="button"
            onClick={handlePasteClipboardIoc}
            title="Pegar desde el portapapeles"
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-white/[0.08] bg-white/[0.045] px-2.5 py-1.5 text-[12px] text-[#F2F2F4] hover:bg-white/[0.08] active:scale-[0.96] transition-all cursor-pointer"
          >
            <ClipboardPaste className="h-3.5 w-3.5 text-[#2F6FED]" />
            <span>Pegar</span>
          </button>
          <button
            type="button"
            onClick={() => setIocPopoverOpen(false)}
            aria-label="Cerrar"
            className="p-1.5 rounded-full text-[#9A9AA2] hover:bg-white/[0.07] hover:text-[#F2F2F4] transition-colors cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
          {SAMPLE_IOCS.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => insertIocValue(sample)}
              className="font-tech rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-0.5 text-[#F2F2F4]/90 hover:border-[#2F6FED]/55 hover:bg-[rgba(28,36,56,0.65)] transition-colors cursor-pointer"
            >
              + {sample}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const activeExpediente = useMemo(
    () => expedientes.find((ex) => ex.id === activeExpedienteId) || null,
    [expedientes, activeExpedienteId],
  );

  async function handleCreateExpSubmit(e) {
    e.preventDefault();
    if (!newExpTitle.trim() || !onCreateExpediente) return;
    const created = await onCreateExpediente({
      title: newExpTitle.trim(),
      classification: newExpClass,
    });
    if (created) {
      setNewExpTitle('');
      setCreatingExp(false);
    }
  }

  function renderKnowledgeBaseBar(compact = false) {
    return (
      <div
        className={`omega-glass-panel rounded-[13px] ${
          compact ? 'px-3 py-2.5' : 'px-3.5 py-3 mb-3.5'
        } space-y-2.5`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <div
              role="group"
              aria-label="Base de conocimiento RAG"
              className="apple-segmented inline-flex items-center rounded-[8px] p-0.5"
            >
              <button
                type="button"
                onClick={() => {
                  setCreatingExp(false);
                  onSelectExpediente?.('');
                }}
                className={`inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[11.5px] font-medium transition-colors cursor-pointer ${
                  !activeExpedienteId
                    ? 'apple-segmented-active'
                    : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                }`}
              >
                <Database className="h-3 w-3 text-[#2F6FED]" />
                <span>Corpus CTI</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!authSession) {
                    onOpenAuth?.('Conecta un tenant OMEGA para consultar y subir PDFs Zero-Retention en tus expedientes privados.');
                    return;
                  }
                  if (!activeExpedienteId && expedientes.length > 0) {
                    onSelectExpediente?.(expedientes[0].id);
                  } else if (!activeExpedienteId) {
                    setCreatingExp(true);
                  }
                }}
                className={`inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[11.5px] font-medium transition-colors cursor-pointer ${
                  activeExpedienteId || creatingExp
                    ? 'apple-segmented-active'
                    : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                }`}
              >
                <FolderLock className="h-3 w-3 text-[#30D158]" />
                <span>Expediente</span>
              </button>
            </div>

            {authSession && (
              <>
                {expedientes.length > 0 && (
                  <select
                    aria-label="Seleccionar expediente"
                    value={activeExpedienteId}
                    onChange={(e) => {
                      setCreatingExp(false);
                      onSelectExpediente?.(e.target.value);
                    }}
                    className="h-7 max-w-[230px] rounded-[7px] border border-white/[0.09] bg-[#141418] px-2 text-[11.5px] text-[#F2F2F4] focus:border-[#2F6FED] focus:outline-none cursor-pointer"
                  >
                    <option value="">Corpus público (general)</option>
                    {expedientes.map((exp) => (
                      <option key={exp.id} value={exp.id}>
                        {exp.title} ({exp.classification})
                      </option>
                    ))}
                  </select>
                )}

                <button
                  type="button"
                  onClick={() => setCreatingExp((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-[7px] border border-white/[0.09] bg-white/[0.04] hover:bg-white/[0.08] px-2 py-1 text-[11px] text-[#F2F2F4] cursor-pointer transition-colors"
                >
                  <Plus className="h-3 w-3 text-[#2F6FED]" />
                  <span>Nuevo</span>
                </button>
              </>
            )}

            {!authSession && (
              <button
                type="button"
                onClick={() =>
                  onOpenAuth?.('Conecta un tenant OMEGA para crear expedientes e indexar PDFs bajo custodia Zero-Retention.')
                }
                className="inline-flex items-center gap-1 rounded-[7px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] hover:border-[#2F6FED]/75 hover:shadow-[0_0_24px_rgba(47,111,237,0.25)] px-2.5 py-1 text-[11px] text-[#F2F2F4] cursor-pointer transition-all"
              >
                <Lock className="h-3 w-3" />
                <span>Conectar sesión</span>
              </button>
            )}
          </div>

          {authSession && activeExpediente && (
            <div className="flex items-center gap-1.5">
              <input
                ref={pdfInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void onUploadExpedientePdf?.(file);
                }}
              />
              <button
                type="button"
                disabled={uploadingPdf}
                onClick={() => pdfInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#30D158]/35 bg-[#30D158]/14 hover:bg-[#30D158]/22 px-2.5 py-1 text-[11.5px] font-medium text-[#7FE89A] disabled:opacity-50 cursor-pointer transition-colors"
              >
                <FileUp className="h-3.5 w-3.5" />
                <span>{uploadingPdf ? 'Extrayendo...' : 'Subir PDF (0-Retention)'}</span>
              </button>
              <button
                type="button"
                disabled={loadingExpedientes}
                onClick={() => onRefreshExpedienteDocs?.()}
                title="Actualizar estado de documentos"
                className="inline-flex items-center justify-center h-7 w-7 rounded-[7px] border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] text-[#9A9AA2] hover:text-[#F2F2F4] cursor-pointer"
              >
                <RefreshCw className={`h-3 w-3 ${loadingExpedientes ? 'animate-spin' : ''}`} />
              </button>
            </div>
          )}
        </div>

        {creatingExp && authSession && (
          <form onSubmit={handleCreateExpSubmit} className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/[0.06]">
            <input
              type="text"
              required
              minLength={3}
              maxLength={255}
              value={newExpTitle}
              onChange={(e) => setNewExpTitle(e.target.value)}
              placeholder="Título del expediente (mín. 3 caracteres)..."
              className="flex-1 min-w-[190px] h-7 rounded-[7px] border border-white/[0.12] bg-[#141418] px-2.5 text-[12px] text-[#F2F2F4] placeholder-[#9A9AA2] focus:border-[#2F6FED] focus:outline-none"
            />
            <select
              value={newExpClass}
              onChange={(e) => setNewExpClass(e.target.value)}
              aria-label="Clasificación del expediente"
              className="h-7 rounded-[7px] border border-white/[0.12] bg-[#141418] px-2 text-[11.5px] text-[#F2F2F4]"
            >
              <option value="INTERNAL">INTERNAL</option>
              <option value="CONFIDENTIAL">CONFIDENTIAL</option>
              <option value="RESTRICTED">RESTRICTED</option>
              <option value="PUBLIC">PUBLIC</option>
            </select>
            <button
              type="submit"
              className="h-7 rounded-[7px] bg-[#2F6FED] hover:bg-[#2F6FED]/90 px-2.5 text-[11.5px] font-medium text-white cursor-pointer"
            >
              Crear
            </button>
            <button
              type="button"
              onClick={() => setCreatingExp(false)}
              className="h-7 px-2 text-[11.5px] text-[#9A9AA2] hover:text-[#F2F2F4] cursor-pointer"
            >
              Cancelar
            </button>
          </form>
        )}

        {activeExpediente && expedienteDocs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-white/[0.05]">
            {expedienteDocs.map((doc) => {
              const indexed = doc.status === 'INDEXED';
              const failed = doc.status === 'FAILED';
              return (
                <span
                  key={doc.id}
                  title={`SHA-256: ${doc.sha256Hash || 'N/D'} · ${doc.tempDeletedAt ? `PDF original eliminado del disco (${doc.tempDeletedAt})` : `Estado: ${doc.status}`}`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-tech ${
                    indexed
                      ? 'border-[#30D158]/30 bg-[#30D158]/10 text-[#8AEBA1]'
                      : failed
                      ? 'border-[#FF453A]/35 bg-[#FF453A]/12 text-[#FFDAD6]'
                      : 'border-[#FF9F0A]/35 bg-[#FF9F0A]/12 text-[#FFD591]'
                  }`}
                >
                  {indexed ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                  ) : (
                    <RefreshCw className={`h-3 w-3 shrink-0 ${failed ? '' : 'animate-spin'}`} />
                  )}
                  <span className="max-w-[160px] truncate">{doc.originalFilename}</span>
                  <span className="opacity-80">
                    {indexed
                      ? `${doc.totalPages || 0}p · 0B`
                      : failed
                      ? 'Error'
                      : doc.status}
                  </span>
                </span>
              );
            })}
          </div>
        )}

        {(expedienteNotice || expedienteError) && (
          <div
            className={`flex items-center justify-between gap-2 rounded-[8px] px-2.5 py-1.5 text-[11.5px] ${
              expedienteError
                ? 'border border-[#FF453A]/35 bg-[#FF453A]/10 text-[#FFDAD6]'
                : 'border border-[#30D158]/30 bg-[#30D158]/10 text-[#8AEBA1]'
            }`}
          >
            <span className="truncate">{expedienteError || expedienteNotice}</span>
            <button
              type="button"
              onClick={() => onDismissExpedienteBanner?.()}
              className="text-current/80 hover:text-white cursor-pointer"
              aria-label="Cerrar aviso"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative z-10 flex-1 flex min-h-0 overflow-hidden">
      {/* Columna Principal del Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {messages.length === 0 ? (
          /* ============================================================
             ESTADO INICIAL: Minimalismo Apple — Emblema, pregunta y 3 tiles
             ============================================================ */
          <main className="flex-1 overflow-y-auto flex flex-col items-center justify-between px-3.5 sm:px-6 pt-4 pb-6">
            <div className="flex-1 min-h-[12px] sm:min-h-[16px] max-h-[84px]" />

            <div className="w-full max-w-[700px] flex flex-col items-center">
              {/* Hero volumétrico con orbe WebGL GLSL y tipografía limpia */}
              <div className="animate-kowalski-in flex flex-col items-center text-center mb-8 sm:mb-9">
                <div className="mb-7">
                  <OmegaShaderOrb size={136} isThinking={loading} />
                </div>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-[1.14] text-[#F2F2F4]">
                  ¿Qué amenaza analizamos hoy?
                </h1>
                <p className="mt-3 max-w-md text-sm sm:text-base leading-relaxed text-[#9A9AA2]">
                  Inteligencia forense sobre spyware comercial con citas verificables por página y expediente.
                </p>
              </div>

              {renderKnowledgeBaseBar(false)}

              {/* Composer Spotlight Obsidian */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitQuery();
                }}
                style={{ animationDelay: '60ms' }}
                className="animate-scale-in omega-capsule w-full rounded-[16px] p-3.5 sm:p-4"
              >
                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Pregunta por Pegasus, un CVE, dominio o artefacto forense..."
                  className="w-full resize-none bg-transparent px-1 pt-0.5 pb-2.5 text-[15px] leading-[1.58] tracking-[-0.008em] text-[#F2F2F4] placeholder-[#9A9AA2] focus:outline-none"
                />

                {(detectedIoc || iocFeedback) && (
                  <div className="px-1 pb-2.5 flex flex-wrap items-center gap-2 text-[12px]">
                    {detectedIoc && (
                      <span className="font-tech inline-flex items-center gap-1.5 rounded-full border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-2.5 py-0.5 text-[#F2F2F4]">
                        <Fingerprint className="h-3 w-3 text-[#2F6FED]" />
                        {detectedIoc}
                      </span>
                    )}
                    {iocFeedback && (
                      <span className="font-tech text-[#9A9AA2]">{iocFeedback}</span>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/[0.065]">
                  <SourceScopePills value={sourceScope} onChange={onChangeSourceScope} />

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIocPopoverOpen((v) => !v)}
                      title="Pegar o insertar un CVE, dominio o hash"
                      className={`inline-flex items-center gap-1 rounded-[8px] border px-2.5 py-1.5 font-tech text-[11.5px] active:scale-[0.96] transition-all duration-150 cursor-pointer ${
                        iocPopoverOpen
                          ? 'border-[#2F6FED]/55 bg-[rgba(28,36,56,0.65)] text-[#F2F2F4] shadow-[0_0_20px_rgba(47,111,237,0.22)]'
                          : 'border-white/[0.08] bg-white/[0.04] text-[#9A9AA2] hover:bg-white/[0.08] hover:text-[#F2F2F4]'
                      }`}
                    >
                      <Plus className="h-3.5 w-3.5 text-[#2F6FED]" />
                      <span>IOC</span>
                    </button>

                    <button
                      type="submit"
                      disabled={loading || !input.trim()}
                      title="Analizar (Enter)"
                      aria-label="Analizar"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#2F6FED] text-white shadow-[0_4px_14px_rgba(47,111,237,0.28),inset_0_1px_0_rgba(255,255,255,0.24)] hover:bg-[#2F6FED]/90 hover:shadow-[0_0_24px_rgba(47,111,237,0.35)] disabled:bg-white/[0.07] disabled:text-[#9A9AA2] disabled:shadow-none active:scale-[0.94] transition-all duration-200 ease-apple cursor-pointer disabled:cursor-not-allowed"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {renderIocHelperBar()}
              </form>

              {/* 3 Accesos Directos Aireados */}
              <div className="w-full mt-4 grid gap-3 sm:grid-cols-3">
                {QUICK_BRIEFS.map((item, idx) => (
                  <button
                    key={item.tag}
                    type="button"
                    onClick={() => submitQuery(item.prompt)}
                    style={{ animationDelay: `${110 + idx * 45}ms` }}
                    className="omega-prompt-tile animate-fade-up group flex flex-col justify-between rounded-[13px] px-4 py-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.985] cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px] font-medium tracking-[-0.01em] text-[#9A9AA2] group-hover:text-[#F2F2F4] transition-colors">
                        {item.tag}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-[#9A9AA2] group-hover:text-[#F2F2F4] group-hover:translate-x-0.5 transition-all duration-200 ease-apple" />
                    </div>
                    <p className="mt-1.5 text-[13.5px] font-medium tracking-[-0.01em] leading-[1.42] text-[#F2F2F4]/85 group-hover:text-[#F2F2F4] transition-colors">
                      {item.title}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-[16px] max-h-[84px]" />

            <footer className="h-6 flex items-center justify-center text-[12px] text-[#9A9AA2]">
              {hasHistory && (
                <button
                  type="button"
                  onClick={onResumeLastSession}
                  className="hover:text-[#F2F2F4] transition-colors cursor-pointer"
                >
                  Retomar última investigación →
                </button>
              )}
            </footer>
          </main>
        ) : (
          /* ============================================================
             ESTADO ACTIVO: Hilo de conversación + evidencia
             ============================================================ */
          <>
            <div className="shrink-0 px-3.5 sm:px-6 pt-2.5">
              <div className="mx-auto max-w-[780px]">{renderKnowledgeBaseBar(true)}</div>
            </div>
            <main ref={threadScrollRef} className="flex-1 overflow-y-auto px-3.5 sm:px-6 py-4 sm:py-6">
              <div className="mx-auto max-w-[780px] space-y-6 sm:space-y-7">
                {messages.map((msg, idx) =>
                  msg.role === 'user' ? (
                    <div key={idx} className="animate-fade-up flex justify-end">
                      <div className="max-w-[90%] sm:max-w-[80%] rounded-[16px] rounded-br-[6px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-3.5 sm:px-4 py-3 space-y-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                        {msg.sourceScope && msg.sourceScope !== 'Todas las fuentes' && (
                          <span className="inline-block rounded-full border border-[#2F6FED]/45 bg-[#2F6FED]/20 px-2 py-0.5 text-[11px] font-medium text-[#F2F2F4]">
                            {msg.sourceScope}
                          </span>
                        )}
                        <p className="text-[14.5px] sm:text-[15px] leading-[1.6] tracking-[-0.008em] text-[#F2F2F4] whitespace-pre-wrap break-words">
                          {msg.content}
                        </p>
                      </div>
                    </div>
                  ) : msg.isError ? (
                    <div
                      key={idx}
                      className="animate-fade-up rounded-[12px] border border-[#FF453A]/30 bg-[#FF453A]/10 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 sm:gap-4"
                    >
                      <div className="space-y-0.5 text-[14px] min-w-0">
                        <p className="font-medium text-[#FFDAD6]">Error al consultar el motor</p>
                        <p className="text-[13px] text-[#FFDAD6]/80 break-words">{msg.content}</p>
                      </div>
                      {msg.retryQuery && (
                        <button
                          type="button"
                          onClick={() => onRetryFailedTurn(idx, msg.retryQuery, msg.sourceScope)}
                          className="shrink-0 h-8 px-3 rounded-[8px] border border-[#FF453A]/35 bg-[#FF453A]/15 text-[12px] font-medium text-[#FFDAD6] hover:bg-[#FF453A]/25 active:scale-[0.97] transition-all cursor-pointer"
                        >
                          Reintentar
                        </button>
                      )}
                    </div>
                  ) : (
                    <div key={idx} className="animate-fade-up space-y-2">
                      {Array.isArray(msg.warnings) && msg.warnings.length > 0 && (
                        <div className="inline-flex flex-wrap items-center gap-1.5 rounded-[9px] border border-[#FF9F0A]/35 bg-[#FF9F0A]/10 px-2.5 py-1 text-[11px] text-[#FFD591]">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>{msg.warnings.join(' · ')}</span>
                        </div>
                      )}
                      <StructuredResponse
                        message={msg}
                        activeCitation={activeCitation}
                        onSelectCitation={onSelectCitation}
                        onToggleSources={onToggleSources}
                        isSourcesOpen={isSourcesOpen}
                        onTypingStep={keepBottomAligned}
                      />
                    </div>
                  )
                )}

                {loading && (
                  <div className="animate-fade-up inline-flex items-center gap-2.5 py-1 text-[13.5px] text-[#9A9AA2]">
                    <OmegaShaderOrb size={20} isThinking={true} />
                    <span className="tracking-[-0.01em]">
                      {sourceScope === 'Todas las fuentes'
                        ? 'Buscando en reportes...'
                        : `Buscando en ${sourceScope}...`}
                    </span>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            </main>

            {/* Composer Inferior Flotante + Context Box */}
            <div className="shrink-0 border-t border-white/[0.08] bg-[#0A0A0C]/65 px-3.5 sm:px-6 py-3 sm:py-3.5">
              <ContextBox
                context={chatContext}
                onUpdateContext={onUpdateChatContext}
                onClearContext={onClearChatContext}
                lastRewrittenQuery={lastRewrittenQuery}
              />
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitQuery();
                }}
                className="omega-capsule mx-auto max-w-[780px] rounded-[15px] p-3"
              >
                <div className="flex items-end gap-2.5">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Haz una pregunta de seguimiento..."
                    className="flex-1 resize-none bg-transparent px-1.5 py-1 text-[15px] leading-[1.55] tracking-[-0.008em] text-[#F2F2F4] placeholder-[#9A9AA2] focus:outline-none"
                  />

                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    aria-label="Enviar"
                    className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#2F6FED] text-white shadow-[0_4px_14px_rgba(47,111,237,0.28),inset_0_1px_0_rgba(255,255,255,0.24)] hover:bg-[#2F6FED]/90 hover:shadow-[0_0_24px_rgba(47,111,237,0.35)] disabled:bg-white/[0.07] disabled:text-[#9A9AA2] disabled:shadow-none active:scale-[0.94] transition-all duration-200 ease-apple cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-2.5 pt-2.5 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
                  <SourceScopePills value={sourceScope} onChange={onChangeSourceScope} compact />

                  <div className="flex items-center gap-2">
                    {detectedIoc && (
                      <span className="font-tech text-[11.5px] text-[#F2F2F4]/90">
                        {detectedIoc}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setIocPopoverOpen((v) => !v)}
                      title="Pegar o insertar un CVE, dominio o hash"
                      className={`inline-flex items-center gap-1 rounded-[7px] border px-2.5 py-1 font-tech text-[11.5px] active:scale-[0.96] transition-all cursor-pointer ${
                        iocPopoverOpen
                          ? 'border-[#2F6FED]/55 bg-[rgba(28,36,56,0.65)] text-[#F2F2F4] shadow-[0_0_20px_rgba(47,111,237,0.22)]'
                          : 'border-white/[0.08] bg-white/[0.04] text-[#9A9AA2] hover:bg-white/[0.08] hover:text-[#F2F2F4]'
                      }`}
                    >
                      <Plus className="h-3 w-3 text-[#2F6FED]" />
                      <span>IOC</span>
                    </button>
                  </div>
                </div>

                {renderIocHelperBar()}
              </form>
            </div>
          </>
        )}
      </div>

      {/* Panel Derecho de Evidencia */}
      {isSourcesOpen && (
        <SourcesPanel
          citations={allConversationCitations}
          selectedCitation={activeCitation}
          onSelectCitation={onSelectCitation}
          onClose={onCloseSources}
          isLoading={loading}
          onSuggestPrompt={() =>
            submitQuery(
              '¿Qué infraestructura C2 y vectores 1-click documentan Citizen Lab y Google TAG para Predator y Pegasus?',
            )
          }
        />
      )}
    </div>
  );
}
