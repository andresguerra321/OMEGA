import DossierExportButtons from './DossierExportButtons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { messageVariants, staggerContainer, fadeUpItem, hoverLift, tapPress } from '../lib/motion';
import {
  ArrowRight,
  Fingerprint,
  ClipboardPaste,
  X,
  Plus,
  FileUp,
  FileText,
  ImagePlus,
  CheckCircle2,
  Database,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  Globe,
  Cpu,
  Zap,
  Compass,
  Sparkles,
  Layers,
} from 'lucide-react';
import { OmegaShaderOrb } from './OmegaShaderOrb';
import { OmegaCoreOrb } from './OmegaCoreOrb';
import { StructuredResponse } from './StructuredResponse';
import { SourcesPanel } from './SourcesPanel';
import { stripUnsafeChars, validateChatMessage, validateIocInput, validateUploadFile } from '../lib/validators';

const DEPTH_PRESETS = [
  { id: 'fast', label: 'Rápido', topK: 4, icon: Zap, hint: '4 citas precisas' },
  { id: 'standard', label: 'Estándar', topK: 6, icon: Compass, hint: '6 citas balanceadas' },
  { id: 'deep', label: 'En profundidad', topK: 10, icon: Sparkles, hint: '10 citas cruzadas' },
  { id: 'holistic', label: 'Integral', topK: 14, icon: Layers, hint: '14 citas multi-fuente' },
];

const QUICK_BRIEFS = [
  {
    tag: 'iOS · Pegasus',
    icon: ShieldAlert,
    title: 'CVEs Zero-Click',
    summary: 'FORCEDENTRY y BLASTPASS',
    prompt:
      '¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus y qué versiones de iOS afectaron?',
  },
  {
    tag: 'Predator · Candiru',
    icon: Globe,
    title: 'Campañas Predator',
    summary: 'Sectores objetivo y nodos C2',
    prompt:
      '¿Qué sectores y regiones fueron objetivo en las campañas de Predator e Intellexa?',
  },
  {
    tag: 'Forense · MVT',
    icon: Cpu,
    title: 'Forense iOS / MVT',
    summary: 'Indicadores en backups locales',
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
  privateOnly = false,
  disclaimer = '',
  messages,
  loading,
  topK = 6,
  onChangeTopK,
  sourceScope,
  onChangeSourceScope,
  generalChatMode = false,
  onToggleGeneralChatMode,
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
  usePrivateDocs = false,
  onTogglePrivateDocs,
  privateDocs = [],
  activeExpedienteId = null,
  loadingDocs = false,
  uploadingPdf = false,
  docNotice = '',
  docError = '',
  onDismissDocBanner,
  onUploadPdf,
  onRefreshDocs,
  aiEngine = null,
  onOpenAiSetup,
}) {
  const [input, setInput] = useState('');
  const [iocPopoverOpen, setIocPopoverOpen] = useState(false);
  const [attachedImage, setAttachedImage] = useState(null);
  const imageInputRef = useRef(null);
  const [iocDraft, setIocDraft] = useState('');
  const [iocFeedback, setIocFeedback] = useState('');
  const [composerError, setComposerError] = useState('');
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

  function clearAttachedImage() {
    if (attachedImage?.previewUrl) {
      URL.revokeObjectURL(attachedImage.previewUrl);
    }
    setAttachedImage(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  function submitQuery(rawPrompt) {
    if (loading) return;
    const effectiveRaw = rawPrompt ?? (input.trim() || (attachedImage ? 'Analiza esta captura en busca de indicadores maliciosos, phishing o spyware.' : ''));
    const check = validateChatMessage(effectiveRaw);
    if (!check.valid) {
      setComposerError(check.error);
      return;
    }
    setComposerError('');
    setIocPopoverOpen(false);
    const imgFile = !rawPrompt && attachedImage?.file ? attachedImage.file : null;
    onSendMessage(check.value, sourceScope, imgFile ? { imageFile: imgFile } : undefined);
    if (!rawPrompt) {
      setInput('');
      clearAttachedImage();
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (e.repeat) return;
      submitQuery();
    }
  }

  function insertIocValue(rawValue) {
    const check = validateIocInput(rawValue);
    if (!check.valid) {
      setIocFeedback(check.error);
      setTimeout(() => setIocFeedback(''), 3200);
      return;
    }
    const cleaned = check.value;

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
            onChange={(e) => setIocDraft(stripUnsafeChars(e.target.value, 512))}
            maxLength={512}
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

  function handleSelectPrivateScope() {
    if (!authSession) {
      onOpenAuth?.('Inicia sesión o regístrate para consultar tus PDFs privados con Zero-Retention en el Asistente.');
      return;
    }
    onTogglePrivateDocs?.(true);
  }

  function handleAttachPdfClick() {
    if (!authSession) {
      onOpenAuth?.('Inicia sesión o regístrate para adjuntar PDFs confidenciales bajo custodia Zero-Retention.');
      return;
    }
    pdfInputRef.current?.click();
  }

  function renderPrivateDocsStatusTray() {
    const showDocsStrip = authSession && usePrivateDocs;
    if (!showDocsStrip && !docNotice && !docError) return null;

    return (
      <div className="mt-2.5 pt-2.5 border-t border-white/[0.06] space-y-2">
        {showDocsStrip && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {privateDocs.length === 0 ? (
              <span className="text-[11.5px] text-[#9A9AA2]">
                Aún no tienes PDFs privados cargados — usa <strong className="text-[#F2F2F4] font-medium">Adjuntar PDF</strong> para indexarlos en RAM.
              </span>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {privateDocs.map((doc) => {
                  const indexed = doc.status === 'INDEXED';
                  const failed = doc.status === 'FAILED';
                  return (
                    <span
                      key={doc.id}
                      title={`SHA-256: ${doc.sha256Hash || 'N/D'} · ${doc.tempDeletedAt ? `PDF original purgado del disco (${doc.tempDeletedAt})` : `Estado: ${doc.status}`}`}
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
                      <span className="max-w-[155px] truncate">{doc.originalFilename}</span>
                      <span className="opacity-80">
                        {indexed ? `${doc.totalPages || 0}p · 0B` : failed ? 'Error' : doc.status}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              disabled={loadingDocs}
              onClick={() => onRefreshDocs?.()}
              title="Actualizar estado de tus PDFs"
              className="inline-flex items-center justify-center h-6 w-6 rounded-[7px] border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] text-[#9A9AA2] hover:text-[#F2F2F4] cursor-pointer shrink-0"
            >
              <RefreshCw className={`h-3 w-3 ${loadingDocs ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}

        {showDocsStrip && <DossierExportButtons expedienteId={activeExpedienteId} />}
        {(docNotice || docError) && (
          <div
            className={`flex items-center justify-between gap-2 rounded-[8px] px-2.5 py-1.5 text-[11.5px] ${
              docError
                ? 'border border-[#FF453A]/35 bg-[#FF453A]/10 text-[#FFDAD6]'
                : 'border border-[#30D158]/30 bg-[#30D158]/10 text-[#8AEBA1]'
            }`}
          >
            <span className="truncate">{docError || docNotice}</span>
            <button
              type="button"
              onClick={() => onDismissDocBanner?.()}
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

  function renderComposerControls(compact = false) {
    return (
      <div
        className={`flex flex-wrap items-center justify-between gap-2 ${
          compact ? 'mt-2.5 pt-2.5 border-t border-white/[0.06]' : 'pt-3 border-t border-white/[0.065]'
        }`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Selector entre Corpus Público CTI y Biblioteca Privada */}
          <div
            role="group"
            aria-label="Ámbito de búsqueda"
            className="apple-segmented inline-flex items-center gap-0.5 rounded-[9px] p-0.5"
          >
            <button
              type="button"
              hidden={privateOnly}
              style={privateOnly ? { display: 'none' } : undefined}
              onClick={() => onTogglePrivateDocs?.(false)}
              className={`inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[11.5px] font-medium transition-colors cursor-pointer ${
                !usePrivateDocs
                  ? 'apple-segmented-active'
                  : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
              }`}
            >
              <Database className="h-3 w-3 text-[#2F6FED]" />
              <span>Corpus CTI</span>
            </button>
            <button
              type="button"
              onClick={handleSelectPrivateScope}
              className={`inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[11.5px] font-medium transition-colors cursor-pointer ${
                usePrivateDocs
                  ? 'apple-segmented-active'
                  : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
              }`}
            >
              <FileText className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.75} />
              <span>
                Mis PDFs
                {authSession && privateDocs.length > 0 ? ` (${privateDocs.length})` : ''}
              </span>
            </button>
          </div>

          {!usePrivateDocs && (
            <SourceScopePills
              value={sourceScope}
              onChange={onChangeSourceScope}
              compact={compact}
            />
          )}

          {!usePrivateDocs && typeof onToggleGeneralChatMode === 'function' && (
            <button
              type="button"
              onClick={onToggleGeneralChatMode}
              title="Permite responder preguntas conceptuales fuera del corpus indexado, claramente etiquetadas como no verificadas"
              className={`inline-flex items-center gap-1 rounded-[7px] border px-2 py-1 text-[11px] font-medium transition-all duration-150 cursor-pointer ${
                generalChatMode
                  ? 'border-[#FF9F0A]/55 bg-[#FF9F0A]/15 text-[#FFD591]'
                  : 'border-white/[0.08] bg-white/[0.03] text-[#9A9AA2] hover:text-[#F2F2F4]'
              }`}
            >
              <span>{generalChatMode ? 'Modo general: ON' : 'Modo general'}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {compact && detectedIoc && (
            <span className="font-tech text-[11.5px] text-[#F2F2F4]/90">
              {detectedIoc}
            </span>
          )}

          <button
            type="button"
            disabled={uploadingPdf}
            onClick={handleAttachPdfClick}
            title="Subir PDF bajo custodia Zero-Retention en RAM"
            className={`inline-flex items-center gap-1.5 rounded-[8px] border border-white/[0.08] bg-white/[0.04] hover:border-[#2F6FED]/45 hover:bg-[rgba(28,36,56,0.65)] text-[#F2F2F4] disabled:opacity-50 active:scale-[0.96] transition-all duration-150 cursor-pointer ${
              compact ? 'px-2.5 py-1 text-[11.5px]' : 'px-2.5 py-1.5 text-[11.5px]'
            }`}
          >
            <FileUp className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
            <span>{uploadingPdf ? 'Extrayendo...' : 'Adjuntar PDF'}</span>
          </button>

          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 8 * 1024 * 1024) {
                setComposerError('La imagen supera el máximo de 8 MB.');
                return;
              }
              if (attachedImage?.previewUrl) URL.revokeObjectURL(attachedImage.previewUrl);
              setAttachedImage({
                file,
                name: file.name,
                previewUrl: URL.createObjectURL(file),
              });
            }}
          />
          <button
            type="button"
            hidden={privateOnly}
            style={privateOnly ? { display: 'none' } : undefined}
            onClick={() => imageInputRef.current?.click()}
            title="Analizar captura de pantalla en RAM (Zero-Retention multimodal)"
            className={`inline-flex items-center gap-1.5 rounded-[8px] border border-white/[0.08] bg-white/[0.04] hover:border-[#2F6FED]/45 hover:bg-[rgba(28,36,56,0.65)] text-[#F2F2F4] active:scale-[0.96] transition-all duration-150 cursor-pointer ${
              compact ? 'px-2.5 py-1 text-[11.5px]' : 'px-2.5 py-1.5 text-[11.5px]'
            }`}
          >
            <ImagePlus className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
            <span>Imagen</span>
          </button>

          <button
            type="button"
            onClick={() => setIocPopoverOpen((v) => !v)}
            title="Pegar o insertar un CVE, dominio o hash"
            className={`inline-flex items-center gap-1 rounded-[8px] border px-2.5 font-tech text-[11.5px] active:scale-[0.96] transition-all duration-150 cursor-pointer ${
              compact ? 'py-1' : 'py-1.5'
            } ${
              iocPopoverOpen
                ? 'border-[#2F6FED]/55 bg-[rgba(28,36,56,0.65)] text-[#F2F2F4] shadow-[0_0_20px_rgba(47,111,237,0.22)]'
                : 'border-white/[0.08] bg-white/[0.04] text-[#9A9AA2] hover:bg-white/[0.08] hover:text-[#F2F2F4]'
            }`}
          >
            <Plus className="h-3.5 w-3.5 text-[#2F6FED]" />
            <span>IOC</span>
          </button>

          {!compact && (
            <button
              type="submit"
              disabled={loading || !input.trim()}
              title="Analizar (Enter)"
              aria-label="Analizar"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#2F6FED] text-white shadow-[0_4px_14px_rgba(47,111,237,0.28),inset_0_1px_0_rgba(255,255,255,0.24)] hover:brightness-110 hover:shadow-[0_0_24px_rgba(47,111,237,0.35)] disabled:bg-white/[0.07] disabled:text-[#9A9AA2] disabled:shadow-none active:scale-[0.94] transition-all duration-200 ease-apple cursor-pointer disabled:cursor-not-allowed"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-10 flex-1 flex min-h-0 overflow-hidden">
      <input
        ref={pdfInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const check = validateUploadFile(file, { extensions: ['.pdf'], maxBytes: 25 * 1024 * 1024, label: 'PDF' });
          if (!check.valid) {
            setComposerError(check.error);
            return;
          }
          void onUploadPdf?.(file);
        }}
      />

      {/* Columna Principal del Chat */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        {disclaimer && <p role="note" className="shrink-0 border-b border-white/[0.06] px-4 py-2 text-center text-xs text-white/65">{disclaimer}</p>}
        {messages.length === 0 ? (
          /* ============================================================
             ESTADO INICIAL: Hero Glassmórfico Centrado Sin Superposiciones
             ============================================================ */
          <main className="relative flex-1 overflow-y-auto flex flex-col items-center justify-between px-4 sm:px-8 pt-4 pb-6">
            {/* Aura luminosa central en azul cobalto (#2F6FED) para refracción real del vidrio */}
            <div
              aria-hidden="true"
              style={{
                background:
                  'radial-gradient(ellipse 56% 44% at 50% 30%, rgba(47, 111, 237, 0.22) 0%, rgba(28, 36, 56, 0.13) 44%, rgba(10, 10, 12, 0) 76%)',
              }}
              className="pointer-events-none absolute inset-0"
            />

            <div className="flex-1 min-h-[10px] max-h-[56px]" />

            <div className="relative z-10 w-full max-w-[680px] flex flex-col items-center">
              {/* Emblema Óptico OMEGA Core Orb + Saludo */}
              <div className="animate-kowalski-in flex flex-col items-center text-center mb-5">
                <div className="mb-3.5">
                  <OmegaCoreOrb size={76} state={loading ? 'thinking' : 'idle'} />
                </div>

                <h1 className="text-[25px] sm:text-[31px] font-semibold tracking-[-0.025em] leading-[1.14] text-[#F2F2F4]">
                  OMEGA IA
                </h1>
                <p className="mt-1.5 max-w-md text-[13.5px] sm:text-[14.5px] leading-relaxed text-[#9A9AA2]">
                  ¿Qué amenaza investigamos hoy?
                </p>
              </div>

              {/* Aviso accionable cuando el usuario nuevo aún no conecta su clave gratuita de IA */}
              {authSession && aiEngine && !aiEngine.configured && onOpenAiSetup && (
                <div className="w-full mb-3.5 rounded-[14px] border border-[#FF9F0A]/40 bg-[#FF9F0A]/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <div className="text-[12.5px] font-semibold text-[#FFE2B8]">
                      Modo extractivo activo · Falta conectar un motor de IA
                    </div>
                    <p className="text-[11.5px] text-[#E6CFA8] leading-snug">
                      Conecta tu clave gratuita de Groq (1 min) o usa tu propia API (Ollama local, Gemini, OpenAI, OpenRouter o endpoint `/v1`).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenAiSetup()}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-[9px] bg-[#2F6FED] hover:brightness-110 px-3.5 py-1.5 text-[12px] font-medium text-white transition-all cursor-pointer"
                  >
                    <span>Configurar IA paso a paso</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Composer Central Espacioso de Vidrio Esmerilado */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitQuery();
                }}
                style={{ animationDelay: '60ms' }}
                className="animate-scale-in omega-capsule w-full min-h-[144px] rounded-[22px] p-4 sm:p-5 flex flex-col justify-between"
              >
                <div>
                  <textarea
                    ref={textareaRef}
                    rows={2}
                    value={input}
                    onChange={(e) => {
                      setInput(stripUnsafeChars(e.target.value, 4000));
                      if (composerError) setComposerError('');
                    }}
                    maxLength={4000}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      usePrivateDocs
                        ? 'Pregunta sobre tus PDFs...'
                        : 'Pregunta sobre Pegasus, un CVE o dominio...'
                    }
                    className="w-full resize-none bg-transparent px-1 pt-0.5 pb-2 text-[15px] leading-[1.58] tracking-[-0.008em] text-[#F2F2F4] placeholder-[#9A9AA2]/80 focus:outline-none"
                  />

                  {composerError && (
                    <p role="alert" className="motion-safe:animate-fade-up px-1 pb-2 text-[12px] text-[#FFB4AE]">
                      {composerError}
                    </p>
                  )}

                  {(detectedIoc || iocFeedback) && (
                    <div className="px-1 pb-2 flex flex-wrap items-center gap-2 text-[12px]">
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
                </div>

                <div>
                  {renderComposerControls(false)}
                  {renderPrivateDocsStatusTray()}
                  {renderIocHelperBar()}
                </div>
              </form>

              {/* Fila de 4 Pills de Profundidad RAG */}
              <div
                role="group"
                aria-label="Profundidad de análisis RAG"
                className="animate-fade-up w-full mt-3.5 flex flex-wrap items-center justify-center gap-2"
              >
                {DEPTH_PRESETS.map((preset) => {
                  const Icon = preset.icon;
                  const active = Number(topK) === preset.topK;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.hint}
                      aria-pressed={active}
                      onClick={() => onChangeTopK?.(preset.topK)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-all duration-150 active:scale-[0.96] cursor-pointer ${
                        active
                          ? 'border-[#2F6FED]/55 bg-[rgba(28,36,56,0.72)] text-[#F2F2F4] shadow-[0_0_20px_rgba(47,111,237,0.22)]'
                          : 'border-white/[0.09] bg-[rgba(20,20,24,0.62)] text-[#9A9AA2] hover:border-white/[0.16] hover:bg-[rgba(28,36,56,0.45)] hover:text-[#F2F2F4]'
                      }`}
                    >
                      <Icon className={`h-3.5 w-3.5 ${active ? 'text-[#2F6FED]' : 'text-[#9A9AA2]'}`} strokeWidth={1.75} />
                      <span>{preset.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Tarjetas de Inicio Rápido en flujo (sin flotantes ni truncamiento) */}
              <motion.div
                aria-label="Consultas guiadas sugeridas"
                variants={staggerContainer}
                initial="initial"
                animate="animate"
                className="w-full mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2.5"
              >
                {QUICK_BRIEFS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <motion.button
                      key={item.tag}
                      type="button"
                      variants={fadeUpItem}
                      whileHover={hoverLift}
                      whileTap={tapPress}
                      onClick={() => submitQuery(item.prompt)}
                      className="omega-glass-card group rounded-[14px] px-3.5 py-3 text-left flex flex-col justify-between gap-1.5 hover:border-[#2F6FED]/45 hover:bg-[rgba(28,36,56,0.62)] cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-[12.5px] font-semibold text-[#F2F2F4] leading-snug">
                          {item.title}
                        </div>
                        <Icon className="h-3.5 w-3.5 text-[#2F6FED] shrink-0 mt-0.5" />
                      </div>
                      <div className="text-[11.5px] text-[#9A9AA2] leading-snug">
                        {item.summary}
                      </div>
                    </motion.button>
                  );
                })}
              </motion.div>
            </div>

            <div className="flex-1 min-h-[10px] max-h-[56px]" />

            {(hasHistory || usePrivateDocs) && (
              <footer className="relative z-10 w-full max-w-[680px] pt-3 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[#9A9AA2]">
                <span className="text-[#8A8E99]">
                    {usePrivateDocs ? (privateOnly ? 'Consulta confidencial del expediente' : 'Procesamiento privado solo en memoria') : ''}
                </span>
                {hasHistory && (
                  <button
                    type="button"
                    onClick={onResumeLastSession}
                    className="font-medium text-[#F2F2F4]/85 hover:text-[#F2F2F4] transition-colors cursor-pointer"
                  >
                    Retomar última investigación →
                  </button>
                )}
              </footer>
            )}
          </main>
        ) : (
          /* ============================================================
             ESTADO ACTIVO: Hilo de conversación + evidencia
             ============================================================ */
          <>
            {usePrivateDocs && authSession && (
              <div className="shrink-0 px-3.5 sm:px-6 pt-2.5">
                <div className="mx-auto max-w-[780px] flex flex-wrap items-center justify-between gap-2 rounded-[11px] border border-[#2F6FED]/35 bg-[rgba(28,36,56,0.45)] px-3.5 py-2 text-[11.5px]">
                  <span className="flex items-center gap-2 text-[#F2F2F4]">
                    <FileText className="h-3.5 w-3.5 text-[#30D158]" />
                    <span>
                      Ámbito privado activo ({privateDocs.length} PDF{privateDocs.length === 1 ? '' : 's'} en tu cuenta)
                    </span>
                  </span>
                  <button
                    type="button"
                    hidden={privateOnly}
                    style={privateOnly ? { display: 'none' } : undefined}
                    onClick={() => onTogglePrivateDocs?.(false)}
                    className="text-[#9A9AA2] hover:text-[#F2F2F4] transition-colors cursor-pointer"
                  >
                    Volver a fuentes públicas
                  </button>
                </div>
              </div>
            )}
            <main ref={threadScrollRef} className="flex-1 overflow-y-auto px-3.5 sm:px-6 py-4 sm:py-6">
              <div className="mx-auto max-w-[780px] space-y-6 sm:space-y-7">
                {messages.map((msg, idx) =>
                  msg.role === 'user' ? (
                    <motion.div key={idx} variants={messageVariants} initial="initial" animate="animate" className="flex justify-end">
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
                    </motion.div>
                  ) : msg.isError ? (
                    <motion.div
                      key={idx}
                      variants={messageVariants}
                      initial="initial"
                      animate="animate"
                      className="rounded-[12px] border border-[#FF453A]/30 bg-[#FF453A]/10 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 sm:gap-4"
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
                    </motion.div>
                  ) : (
                    <motion.div key={idx} variants={messageVariants} initial="initial" animate="animate" className="space-y-2">
                      {msg.generalMode && (
                        <div className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#FF9F0A]/40 bg-[#FF9F0A]/12 px-2.5 py-1 text-[11px] font-medium text-[#FFD591]">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>Respuesta general — no verificada contra fuentes indexadas</span>
                        </div>
                      )}
                      {Array.isArray(msg.warnings) && msg.warnings.filter((w) => w !== 'GENERAL_KNOWLEDGE_UNVERIFIED').length > 0 && (
                        <div className="inline-flex flex-wrap items-center gap-1.5 rounded-[9px] border border-[#FF9F0A]/35 bg-[#FF9F0A]/10 px-2.5 py-1 text-[11px] text-[#FFD591]">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>{msg.warnings.filter((w) => w !== 'GENERAL_KNOWLEDGE_UNVERIFIED').join(' · ')}</span>
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
                    </motion.div>
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
                    onChange={(e) => {
                      setInput(stripUnsafeChars(e.target.value, 4000));
                      if (composerError) setComposerError('');
                    }}
                    maxLength={4000}
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

                {composerError && (
                  <p role="alert" className="motion-safe:animate-fade-up px-1.5 pt-1.5 text-[12px] text-[#FFB4AE]">
                    {composerError}
                  </p>
                )}

                {attachedImage && (
                  <div className="mt-2 flex items-center gap-2.5 rounded-[10px] border border-[#2F6FED]/35 bg-[#2F6FED]/10 px-2.5 py-1.5">
                    <img
                      src={attachedImage.previewUrl}
                      alt="Vista previa en memoria"
                      className="h-10 w-10 rounded-[6px] object-cover border border-white/15"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-[#F2F2F4] truncate">{attachedImage.name}</div>
                      <div className="text-[10.5px] text-[#9FA6B8]">Análisis multimodal en RAM (Zero-Retention)</div>
                    </div>
                    <button
                      type="button"
                      onClick={clearAttachedImage}
                      aria-label="Quitar imagen"
                      className="p-1 text-[#9FA6B8] hover:text-white cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {renderComposerControls(true)}
                {renderPrivateDocsStatusTray()}
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
