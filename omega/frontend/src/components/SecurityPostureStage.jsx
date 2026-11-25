import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bell,
  BookOpen,
  ChevronDown,
  Database,
  KeyRound,
  Laptop,
  Link2,
  Loader2,
  PackageSearch,
  Search,
  Settings,
  ShieldAlert,
  Smartphone,
  Terminal,
  Trash2,
} from 'lucide-react';
import { verifySuspiciousLink } from '../lib/api';
import { formatGreetingName } from '../lib/formatGreetingName';
import { stripUnsafeChars, validateUrlInput } from '../lib/validators';
import { useSingleFlight } from '../lib/useSingleFlight';
import { OmegaBrandMark } from './OmegaBrandMark';
import { OmegaCompactEclipse } from './OmegaCompactEclipse';
import { OmegaHomeBackdrop } from './OmegaHomeBackdrop';
import { SpatialNavPill } from './SpatialNavPill';
import { ActionConfirmationBanner, PanelErrorBanner } from './PanelStatePrimitives';

function extractPcVerdictInfo(pcAudit) {
  if (!pcAudit) return { verdict: '', findingsCount: 0, yaraHits: 0, sockets: 0 };
  const rawCode = String(
    pcAudit?.triage?.diagnosis?.verdict_code || pcAudit?.verdict || '',
  ).toLowerCase();
  const yaraHits = Number(pcAudit?.yara_hits?.length ?? pcAudit?.triage?.yara_hits?.length ?? 0);
  const anomalies = Number(
    pcAudit?.triage?.behavioral_anomalies?.length ?? pcAudit?.behavioral_anomalies?.length ?? 0,
  );
  const matches = Number(pcAudit?.triage?.total_matches ?? pcAudit?.high_findings ?? 0);
  const sockets = Number(pcAudit?.live_sockets_total ?? pcAudit?.network_count ?? 0);
  return {
    verdict: rawCode,
    findingsCount: matches + yaraHits + anomalies,
    yaraHits,
    sockets,
  };
}

const SURFACE_ORDER = ['windows', 'usb', 'link', 'corpus'];
const DEV_SURFACE_ORDER = ['repo', 'cli', 'link', 'corpus'];

const GLASS_CARD_CLASS =
  'bg-[#0E131F]/70 backdrop-blur-2xl rounded-2xl border border-white/[0.10] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] p-5 min-h-[126px] transition-all duration-300 hover:bg-[#121928]/82 hover:border-white/[0.18] focus-within:border-[#2F6FED] flex flex-col justify-between gap-4';

export function SecurityPostureStage({
  isDesktop = false,
  activeNav,
  onSelectNav,
  selectedNodeId = 'windows',
  onSelectNode,
  pcAudit,
  usbStatus,
  lastLinkResult,
  govStats,
  apiOnline = true,
  isLoadingChat = false,
  scanningPc = false,
  syncingStix = false,
  onRunPcScan,
  onSyncStix: _onSyncStix,
  stageFeedback = null,
  onDismissStageFeedback,
  onOpenCommandPalette,
  onOpenOnboarding,
  onOpenCopilot,
  onNavigate,
  onLinkVerified,
  onLogActivity,
  onPanicPurge,
  authSession = null,
  visibleModuleIds = null,
  profileConfig = null,
}) {
  const isDeveloper = Boolean(profileConfig?.visibleModules?.includes('repo_scanner'));
  const moduleLabels = profileConfig?.moduleLabels || {};
  const surfaceOrder = isDeveloper ? DEV_SURFACE_ORDER : SURFACE_ORDER;
  const [surfaceMenuOpen, setSurfaceMenuOpen] = useState(false);
  const [operatorMenuOpen, setOperatorMenuOpen] = useState(false);
  const [hudFocused, setHudFocused] = useState(false);
  const [quickUrl, setQuickUrl] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [inlineLink, setInlineLink] = useState(null);
  const guard = useSingleFlight();
  const menuRef = useRef(null);

  const pcInfo = useMemo(() => extractPcVerdictInfo(pcAudit), [pcAudit]);
  const pcHealthy =
    Boolean(pcAudit) &&
    (pcInfo.verdict === 'clean' || pcInfo.verdict === 'low' || pcInfo.findingsCount === 0);
  const pcWarn = Boolean(pcAudit) && !pcHealthy;
  const pcVerdict = pcInfo.verdict || null;

  const reportsCount = Number(govStats?.corpus_stats?.reports ?? 16);
  const iocsCount = Number(govStats?.corpus_stats?.iocs ?? 6617);
  const catalogCutoffDate = govStats?.catalog_freshness?.catalog_cutoff_date || '2024-12-16';

  const androidOk = Boolean(usbStatus?.android?.connected);
  const iosOk = Boolean(usbStatus?.ios?.connected);
  const usbConnected = androidOk || iosOk;
  const usbModel = androidOk
    ? usbStatus?.android?.model || 'Android USB'
    : iosOk
      ? usbStatus?.ios?.device?.name || 'iPhone / iPad'
      : '';

  const linkRisk = String(lastLinkResult?.risk_level || lastLinkResult?.verdict || '').toUpperCase();

  useEffect(() => {
    if (!surfaceMenuOpen) return undefined;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setSurfaceMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [surfaceMenuOpen]);

  const surfaces = useMemo(
    () => ({
      repo: {
        id: 'repo',
        title: 'Proyectos GitHub',
        statusLabel: 'Originales efímeros',
        icon: PackageSearch,
      },
      cli: {
        id: 'cli',
        title: 'CLI y GitHub App',
        statusLabel: 'CI / Local · Metadatos',
        icon: Terminal,
      },
      windows: {
        id: 'windows',
        title: 'Esta PC Windows',
        statusLabel: pcWarn
          ? `${pcInfo.findingsCount} alertas`
          : pcHealthy
            ? 'RAM · 0 coincidencias'
            : 'Originales efímeros',
        icon: Laptop,
      },
      usb: {
        id: 'usb',
        title: usbModel || 'Celulares USB',
        statusLabel: usbConnected ? 'Cable activo · RAM' : 'USB en espera · RAM',
        icon: Smartphone,
      },
      link: {
        id: 'link',
        title: 'Escudo Web',
        statusLabel: linkRisk === 'HIGH' ? 'Riesgo Alto' : lastLinkResult ? 'Revisado' : 'Pasivo · RAM',
        icon: Link2,
      },
      corpus: {
        id: 'corpus',
        title: 'Base Forense STIX 2.1',
        statusLabel: apiOnline ? `${reportsCount} reportes` : 'Offline',
        icon: Database,
      },
    }),
    [
      pcWarn,
      pcInfo.findingsCount,
      pcHealthy,
      usbModel,
      usbConnected,
      linkRisk,
      lastLinkResult,
      apiOnline,
      reportsCount,
    ],
  );

  const activeSurface =
    (surfaceOrder.includes(selectedNodeId) ? surfaces[selectedNodeId] : null) ||
    (isDeveloper ? surfaces.repo : surfaces.windows);

  const linkInputValid = Boolean(
    quickUrl.trim() && validateUrlInput(quickUrl, { allowBareDomain: true }).valid,
  );

  async function handleQuickLinkSubmit(e) {
    e.preventDefault();
    if (linkLoading) return;
    const validation = validateUrlInput(quickUrl, { allowBareDomain: true });
    if (!validation.valid) {
      setInlineLink({
        url: String(quickUrl || '').trim(),
        verdict: 'error',
        error: validation.error,
      });
      return;
    }
    const cleaned = validation.value;
    await guard(async () => {
      setLinkLoading(true);
      setInlineLink(null);
      try {
        const res = await verifySuspiciousLink(cleaned);
        setInlineLink({ url: cleaned, ...res });
        onLinkVerified?.(res);
        onLogActivity?.(`Enlace analizado: ${res?.verdict || 'revisado'}`);
      } catch (err) {
        setInlineLink({
          url: cleaned,
          verdict: 'error',
          error: err?.message || 'Error verificando enlace',
        });
      } finally {
        setLinkLoading(false);
      }
    });
  }

  const stageAlert =
    activeSurface.id === 'windows'
      ? pcWarn
      : activeSurface.id === 'link'
        ? linkRisk === 'HIGH'
        : false;

  const isScanning = scanningPc || linkLoading || syncingStix;

  const cardInteractionProps = {
    onMouseEnter: () => setHudFocused(true),
    onMouseLeave: () => setHudFocused(false),
    onFocus: () => setHudFocused(true),
    onBlur: () => setHudFocused(false),
  };

  return (
    <section
      aria-label="Cabina de postura OMEGA"
      className="relative isolate min-h-full md:h-full w-full overflow-x-hidden overflow-y-auto md:overflow-hidden flex flex-col justify-between select-none text-[#F8FAFC] bg-[#070A10]"
    >
      {/* Fondo atmosférico unificado con Login (#070A10 + arco azul recortado arriba-derecha) */}
      <OmegaHomeBackdrop alert={stageAlert} />

      {/* Barra global superior flotante transparente */}
      <header
        aria-label="Barra principal OMEGA"
        className="relative z-30 min-h-[58px] h-[58px] shrink-0 px-4 sm:px-8 flex items-center justify-between gap-2 select-none"
      >
        <button
          type="button"
          onClick={() => onSelectNav?.('inicio')}
          className="relative z-10 inline-flex items-center gap-2 text-left rounded-[10px] px-1.5 py-1 hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
        >
          <OmegaBrandMark />
        </button>

        <div className="hidden md:flex justify-center md:absolute md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 z-20">
          <SpatialNavPill
            activeNav={activeNav}
            onSelectNav={onSelectNav}
            pcVerdict={pcVerdict}
            usbConnected={usbConnected}
            apiOnline={apiOnline}
            isLoadingChat={isLoadingChat}
            authConnected={Boolean(authSession)}
            visibleModuleIds={visibleModuleIds}
            moduleLabels={moduleLabels}
          />
        </div>

        <div className="relative z-10 flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            aria-label="Abrir búsqueda rápida (⌘K)"
            title="Buscar módulo o CVE (⌘K)"
            className="px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs text-[#8B95A5] hover:text-[#F8FAFC] inline-flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Search className="h-[13px] w-[13px]" strokeWidth={1.75} />
            <kbd className="hidden 2xl:inline text-[11px] text-[#8B95A5] font-sans">⌘K</kbd>
          </button>

          <button
            type="button"
            onClick={() => onOpenCopilot?.({})}
            aria-label="Abrir copiloto lateral"
            title="Copiloto (Ctrl+J)"
            className="relative p-2 rounded-lg text-[#8B95A5] hover:text-[#F8FAFC] hover:bg-white/[0.05] inline-flex items-center justify-center transition-colors cursor-pointer"
          >
            <Bell className="h-[15px] w-[15px]" strokeWidth={1.75} />
            <span className="ml-1 font-mono text-[10px] font-medium bg-white/[0.1] text-[#F8FAFC] px-1.5 py-0.5 rounded-full leading-none tabular-nums">
              {pcWarn ? pcInfo.findingsCount : reportsCount}
            </span>
          </button>

          {authSession ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setOperatorMenuOpen((v) => !v)}
                aria-expanded={operatorMenuOpen}
                title={`Cuenta: ${authSession.email} (${authSession.role})`}
                className="px-2.5 py-1.5 rounded-lg hover:bg-white/[0.05] inline-flex items-center gap-2 text-xs font-medium text-[#F8FAFC] transition-colors cursor-pointer"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="hidden lg:inline max-w-[96px] truncate">
                  {authSession.email?.split('@')[0] || authSession.tenantSlug}
                </span>
                <ChevronDown className="h-3 w-3 text-[#8B95A5]" strokeWidth={1.75} />
              </button>

              {operatorMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-48 rounded-xl bg-[#0E131F]/95 backdrop-blur-2xl border border-white/[0.1] p-1.5 shadow-xl z-50 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setOperatorMenuOpen(false);
                      onNavigate?.('cuenta');
                    }}
                    className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-[#F8FAFC] hover:bg-white/[0.06] cursor-pointer text-left"
                  >
                    <Settings className="h-3.5 w-3.5 text-[#8B95A5]" strokeWidth={1.75} />
                    <span>Cuenta y Ajustes</span>
                  </button>
                  {onOpenOnboarding && (
                    <button
                      type="button"
                      onClick={() => {
                        setOperatorMenuOpen(false);
                        onOpenOnboarding();
                      }}
                      className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-[#F8FAFC] hover:bg-white/[0.06] cursor-pointer text-left"
                    >
                      <BookOpen className="h-3.5 w-3.5 text-[#8B95A5]" strokeWidth={1.75} />
                      <span>Guía interactiva</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate?.('cuenta')}
              className="px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] inline-flex items-center gap-1.5 text-xs font-medium text-[#F8FAFC] transition-colors cursor-pointer"
            >
              <KeyRound className="h-3.5 w-3.5 text-[#8B95A5]" strokeWidth={1.75} />
              <span className="hidden lg:inline">Entrar</span>
            </button>
          )}

          {authSession && (
            <>
              <span aria-hidden="true" className="h-4 w-px bg-white/[0.08]" />
              <button
                type="button"
                onClick={() => {
                  setOperatorMenuOpen(false);
                  void onPanicPurge?.();
                }}
                title="Purga rápida: destruye tokens, memoria volátil y caché local"
                aria-label="Purga rápida"
                className="px-2.5 py-1.5 rounded-lg text-xs text-[#8B95A5] hover:text-[#E5484D] hover:bg-[#E5484D]/10 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span className="hidden xl:inline">Purga</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Nav compacto en anchos estrechos */}
      <div className="relative z-20 md:hidden flex justify-center px-3 pt-1 pb-1">
        <SpatialNavPill
          compact
          activeNav={activeNav}
          onSelectNav={onSelectNav}
          pcVerdict={pcVerdict}
          usbConnected={usbConnected}
          apiOnline={apiOnline}
          isLoadingChat={isLoadingChat}
          authConnected={Boolean(authSession)}
          visibleModuleIds={visibleModuleIds}
          moduleLabels={moduleLabels}
        />
      </div>

      {/* Sub-header superior limpio (selector de contexto + telemetría STIX2) */}
      <div className="relative z-20 shrink-0 px-4 sm:px-8 pt-3 flex flex-wrap items-center justify-between gap-3">
        <div ref={menuRef} className="relative flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setSurfaceMenuOpen((v) => !v)}
            aria-expanded={surfaceMenuOpen}
            aria-haspopup="listbox"
            className="inline-flex items-center gap-1.5 text-[15px] font-medium text-[#F8FAFC] tracking-[-0.02em] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6FED] rounded-md px-1 -ml-1 transition-colors cursor-pointer"
          >
            <span>{activeSurface.title}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-[#8B95A5] transition-transform duration-150 ${
                surfaceMenuOpen ? 'rotate-180 text-[#F8FAFC]' : ''
              }`}
              strokeWidth={1.75}
            />
          </button>

          <span className="inline-flex items-center gap-1.5 text-xs font-mono text-[#8B95A5]">
            <span
              className={`h-[5px] w-[5px] rounded-full ${
                stageAlert ? 'bg-[#E5484D]' : 'bg-emerald-400'
              }`}
            />
            <span>{activeSurface.statusLabel}</span>
          </span>

          {surfaceMenuOpen && (
            <div
              role="listbox"
              aria-label="Cambiar superficie mostrada"
              className="absolute left-0 top-full mt-2 w-64 rounded-xl border border-white/[0.1] bg-[#0E131F]/95 backdrop-blur-2xl p-1.5 shadow-[0_24px_48px_rgba(0,0,0,0.65)] z-50 space-y-0.5"
            >
              {surfaceOrder.map((id) => {
                const s = surfaces[id];
                const SIcon = s.icon;
                const isSelected = id === activeSurface.id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onSelectNode?.(id);
                      setSurfaceMenuOpen(false);
                    }}
                    className={`w-full rounded-lg px-2.5 py-2 flex items-center justify-between gap-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6FED] cursor-pointer ${
                      isSelected
                        ? 'bg-[#2F6FED]/20 border border-[#2F6FED]/45 text-[#F8FAFC] font-medium'
                        : 'text-[#A8B0BE] hover:bg-white/[0.05] hover:text-[#F8FAFC] border border-transparent'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <SIcon className="h-3.5 w-3.5 text-[#8B95A5]" strokeWidth={1.75} />
                      <span>{s.title}</span>
                    </span>
                    <span className="font-mono text-[10.5px] text-[#6B7280]">{s.statusLabel}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="text-[11px] font-mono tabular-nums text-[#6B7280] tracking-[0.02em]">
          ZERO-RETENTION · STIX2 {iocsCount.toLocaleString('en-US')} · CTI {catalogCutoffDate}
        </div>
      </div>

      {/* Alertas discretas flotantes */}
      {(!apiOnline || stageFeedback) && (
        <div className="relative z-20 mx-auto w-full max-w-xl px-4 pt-3 space-y-2">
          {!apiOnline && (
            <PanelErrorBanner message="Backend OMEGA desconectado. Inicia Docker o el servidor Java." />
          )}
          {stageFeedback &&
            (stageFeedback.tone === 'alert' ? (
              <PanelErrorBanner
                message={stageFeedback.message}
                onDismiss={onDismissStageFeedback}
              />
            ) : (
              <ActionConfirmationBanner
                tone={stageFeedback.tone || 'clean'}
                message={stageFeedback.message}
                actionLabel={stageFeedback.actionLabel}
                onAction={
                  stageFeedback.actionNav
                    ? () => {
                        onDismissStageFeedback?.();
                        onNavigate?.(stageFeedback.actionNav);
                      }
                    : undefined
                }
                onDismiss={onDismissStageFeedback}
              />
            ))}
        </div>
      )}

      {/* Pieza Central: Saludo editorial simétrico flanqueando el eclipse compacto Ω */}
      <div className="relative z-10 flex-1 min-h-[250px] flex items-center justify-center py-4 pointer-events-none">
        <div className="flex flex-col items-center gap-5 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-8 md:gap-12 w-full max-w-4xl mx-auto px-6">
          <span className="omega-greet-left sm:justify-self-end sm:text-right text-[28px] md:text-[34px] font-light tracking-[-0.02em] text-[#F1F5F9]/92 select-none leading-none">
            ¡Hola!
          </span>

          <div className="flex items-center justify-center">
            <OmegaCompactEclipse
              focused={hudFocused}
              scanning={isScanning}
              alert={stageAlert}
            />
          </div>

          <span className="omega-greet-right sm:justify-self-start sm:text-left text-[28px] md:text-[34px] font-light tracking-[-0.02em] text-[#F1F5F9]/92 select-none leading-none max-w-[240px] md:max-w-[280px] truncate">
            {formatGreetingName(authSession)}
          </span>
        </div>
      </div>

      {/* Dock Inferior: 3 Cards Glassmorphism */}
      <footer
        aria-label="Acciones principales OMEGA"
        className="relative z-10 shrink-0 w-full px-4 sm:px-8 pb-6 md:pb-8"
      >
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
          {isDeveloper ? (
            <>
              {/* Card 1 (Developer): Proyectos y hallazgos */}
              <div {...cardInteractionProps} className={GLASS_CARD_CLASS}>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-[14px] font-medium text-[#F8FAFC] tracking-[-0.015em]">
                      {moduleLabels.inicio || 'Proyectos y hallazgos'}
                    </h2>
                    <span className="font-mono text-[11px] tabular-nums text-[#8B95A5]">
                      Zero-Retention
                    </span>
                  </div>
                  <p className="text-[12px] text-[#9AA6B8]">
                    Repositorios · Manifiestos · Dependencias
                  </p>
                </div>

                <div className="h-9 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onNavigate?.('repo_scanner')}
                    className="bg-[#2F6FED] hover:bg-[#3B7BF2] text-white rounded-lg h-8 px-3.5 text-xs font-medium inline-flex items-center gap-1.5 transition-colors duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6FED] cursor-pointer shrink-0"
                  >
                    <span>Analizar repositorio</span>
                  </button>
                  <span className="font-mono text-[11px] tabular-nums text-[#8B95A5] text-right">
                    URL / ZIP · En memoria
                  </span>
                </div>
              </div>

              {/* Card 2 (Developer): CLI y GitHub App */}
              <div {...cardInteractionProps} className={GLASS_CARD_CLASS}>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-[14px] font-medium text-[#F8FAFC] tracking-[-0.015em]">
                      CLI y GitHub App
                    </h2>
                    <span className="font-mono text-[11px] tabular-nums text-[#8B95A5]">
                      CI / Local
                    </span>
                  </div>
                  <p className="text-[12px] text-[#9AA6B8] font-mono">
                    omega scan · SARIF 2.1.0
                  </p>
                </div>

                <div className="h-9 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onNavigate?.('repo_scanner')}
                    className="bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.10] text-[#F8FAFC] rounded-lg h-8 px-3.5 text-xs font-medium inline-flex items-center gap-1.5 transition-colors duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6FED] cursor-pointer shrink-0"
                  >
                    <span>Tokens y GitHub</span>
                    <ArrowRight className="h-3.5 w-3.5 text-[#9AA6B8]" strokeWidth={1.75} />
                  </button>
                  <span className="font-mono text-[11px] tabular-nums text-[#8B95A5]">
                    REPO_SCAN
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Card 1 (General/Legal): Equipo Local */}
              <div {...cardInteractionProps} className={GLASS_CARD_CLASS}>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-[14px] font-medium text-[#F8FAFC] tracking-[-0.015em]">
                      Equipo Local
                    </h2>
                    <span className="font-mono text-[11px] tabular-nums text-[#8B95A5]">
                      {pcWarn
                        ? `${pcInfo.findingsCount} alertas`
                        : pcHealthy
                          ? '0 coincidencias'
                          : 'Zero-Retention'}
                    </span>
                  </div>
                  <p className="text-[12px] text-[#9AA6B8]">
                    WMI · Procesos · Sockets en RAM
                  </p>
                </div>

                <div className="h-9 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={scanningPc}
                    onClick={() =>
                      isDesktop ? onRunPcScan?.() : onNavigate?.('equipo', { tab: 'pc' })
                    }
                    className="bg-[#2F6FED] hover:bg-[#3B7BF2] text-white disabled:opacity-50 rounded-lg h-8 px-3.5 text-xs font-medium inline-flex items-center gap-1.5 transition-colors duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6FED] cursor-pointer shrink-0"
                  >
                    {scanningPc && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>
                      {scanningPc
                        ? 'Analizando...'
                        : pcAudit
                          ? 'Reanalizar PC'
                          : isDesktop
                            ? 'Analizar esta PC'
                            : 'Abrir inspector PC'}
                    </span>
                  </button>
                  <span className="font-mono text-[11px] tabular-nums text-[#8B95A5] text-right">
                    {pcAudit ? `${pcInfo.sockets} sockets` : 'Sin originales'}
                  </span>
                </div>
              </div>

              {/* Card 2 (General/Legal): Celulares USB */}
              <div {...cardInteractionProps} className={GLASS_CARD_CLASS}>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-[14px] font-medium text-[#F8FAFC] tracking-[-0.015em]">
                      Celulares USB
                    </h2>
                    <span className="font-mono text-[11px] tabular-nums text-[#8B95A5]">
                      {usbConnected ? (androidOk ? 'Android' : 'iPhone') : 'En espera'}
                    </span>
                  </div>
                  <p className="text-[12px] text-[#9AA6B8] truncate">
                    {usbModel || 'ADB · Lockdown iOS · Triaje MVT'}
                  </p>
                </div>

                <div className="h-9 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onNavigate?.('equipo', { tab: iosOk ? 'ios' : 'android' })}
                    className="bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.10] text-[#F8FAFC] rounded-lg h-8 px-3.5 text-xs font-medium inline-flex items-center gap-1.5 transition-colors duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6FED] cursor-pointer shrink-0"
                  >
                    <span>Abrir guía USB</span>
                    <ArrowRight className="h-3.5 w-3.5 text-[#9AA6B8]" strokeWidth={1.75} />
                  </button>
                  <span className="font-mono text-[11px] tabular-nums text-[#8B95A5]">
                    MVT · STIX2
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Card 3: Escudo Web (Input original de triaje de enlaces) */}
          <div {...cardInteractionProps} className={GLASS_CARD_CLASS}>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <h2 className="text-[14px] font-medium text-[#F8FAFC] tracking-[-0.015em] shrink-0">
                  Escudo Web
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate?.('amenazas')}
                  className="text-[11px] text-[#8B95A5] hover:text-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6FED] rounded px-1 transition-colors cursor-pointer truncate min-w-0"
                >
                  {moduleLabels.amenazas || 'Cadena de suministro'} →
                </button>
              </div>
              <p className="text-[12px] text-[#9AA6B8]">
                Verificación pasiva · Cero HTTP saliente
              </p>
            </div>

            <form noValidate onSubmit={handleQuickLinkSubmit} className="space-y-2">
              <div className="flex items-center gap-2 bg-[#070A10]/75 border border-white/[0.12] focus-within:border-[#2F6FED]/75 rounded-lg h-9 pl-3 pr-1 transition-all">
                <input
                  type="text"
                  maxLength={2048}
                  value={quickUrl}
                  onChange={(e) => {
                    setQuickUrl(stripUnsafeChars(e.target.value, 2048));
                    if (inlineLink?.error) setInlineLink(null);
                  }}
                  aria-invalid={Boolean(inlineLink?.error)}
                  placeholder="Pega enlace sospechoso..."
                  aria-label="Enlace sospechoso para verificar"
                  className="flex-1 min-w-0 bg-transparent text-xs text-[#F8FAFC] placeholder:text-[#8B95A5]/80 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={linkLoading || !linkInputValid}
                  className={`h-7 px-3 rounded-md text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6FED] shrink-0 ${
                    linkInputValid && !linkLoading
                      ? 'bg-[#2F6FED] hover:bg-[#3B7BF2] text-white cursor-pointer active:scale-[0.98]'
                      : 'bg-white/[0.06] text-[#8B95A5] cursor-not-allowed'
                  }`}
                >
                  {linkLoading ? '...' : 'Verificar'}
                </button>
              </div>

              {inlineLink && (
                <div
                  className={`rounded-lg border px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px] ${
                    inlineLink.error || inlineLink.risk_level === 'HIGH'
                      ? 'bg-[#E5484D]/10 border-[#E5484D]/30 text-[#FECACA]'
                      : 'bg-white/[0.04] border-white/[0.10] text-[#F8FAFC]'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5 truncate">
                    {(inlineLink.error || inlineLink.risk_level === 'HIGH') && (
                      <ShieldAlert className="h-3.5 w-3.5 text-[#E5484D] shrink-0" />
                    )}
                    <span className="truncate">
                      {inlineLink.error ||
                        `Listo · ${inlineLink.verdict || inlineLink.risk_level || 'Revisado'}`}
                    </span>
                  </span>
                  {!inlineLink.error && (
                    <button
                      type="button"
                      onClick={() => onNavigate?.('enlace', { url: inlineLink.url })}
                      className="text-[#F8FAFC] underline decoration-white/25 hover:decoration-white font-medium shrink-0 cursor-pointer"
                    >
                      Detalle →
                    </button>
                  )}
                </div>
              )}
            </form>
          </div>
        </div>
      </footer>
    </section>
  );
}
