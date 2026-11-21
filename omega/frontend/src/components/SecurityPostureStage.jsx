import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  KeyRound,
  Laptop,
  Link2,
  Loader2,
  PackageSearch,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Terminal,
  Trash2,
} from 'lucide-react';
import { verifySuspiciousLink } from '../lib/api';
import { stripUnsafeChars, validateUrlInput } from '../lib/validators';
import { useSingleFlight } from '../lib/useSingleFlight';
import { OmegaBrandMark } from './OmegaBrandMark';
import { OmegaAmbientBackdrop } from './OmegaAmbientBackdrop';
import { SpatialNavPill } from './SpatialNavPill';
import { SecurityCenterpieceFallback } from './SecurityCenterpieceFallback';
import { ActionConfirmationBanner, PanelErrorBanner } from './PanelStatePrimitives';

const SecurityCenterpiece3D = lazy(() =>
  import('./SecurityCenterpiece3D').then((mod) => ({
    default: mod.SecurityCenterpiece3D,
  })),
);

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

export function SecurityPostureStage({
  isDesktop = false,
  activeNav,
  onSelectNav,
  selectedNodeId = 'windows',
  onSelectNode,
  pcAudit,
  pcScannedAt,
  usbStatus,
  lastLinkResult,
  govStats,
  apiOnline = true,
  isLoadingChat = false,
  scanningPc = false,
  syncingStix = false,
  onRunPcScan,
  onSyncStix,
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
  const [spinNonce, setSpinNonce] = useState(0);
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
  const iocsCount = Number(govStats?.corpus_stats?.iocs ?? 4896);
  const campaignsCount = Number(govStats?.corpus_stats?.campaigns ?? 19);
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
        kicker: 'APPSEC · INSPECCIÓN ESTÁTICA ZERO-RETENTION',
        lead: 'Proyectos',
        accent: 'GitHub',
        statusLabel: 'Listo en RAM',
        tone: 'royal',
        icon: PackageSearch,
        primaryLabel: 'Analizar repositorio',
        onPrimary: () => onNavigate?.('repo_scanner'),
        onDetail: () => onNavigate?.('repo_scanner'),
      },
      cli: {
        id: 'cli',
        kicker: 'OMEGA SCAN · TOKENS REPO_SCAN · SARIF 2.1.0',
        lead: 'CLI y',
        accent: 'GitHub App',
        statusLabel: 'CI/CD',
        tone: 'royal',
        icon: Terminal,
        primaryLabel: 'Abrir CLI y GitHub',
        onPrimary: () => onNavigate?.('repo_scanner'),
        onDetail: () => onNavigate?.('repo_scanner'),
      },
      windows: {
        id: 'windows',
        kicker: 'HOST LOCAL · WMI / SOCKETS RAM',
        lead: 'Esta PC',
        accent: 'Windows',
        statusLabel: pcWarn
          ? `Revisar (${pcInfo.findingsCount})`
          : pcHealthy
            ? '0 coincidencias (RAM)'
            : 'Listo en RAM',
        tone: pcWarn ? 'alert' : pcHealthy ? 'clean' : 'royal',
        icon: Laptop,
        primaryLabel: scanningPc
          ? 'Analizando procesos...'
          : pcAudit
            ? 'Reanalizar PC'
            : 'Analizar esta PC ahora',
        onPrimary: () => (isDesktop ? onRunPcScan?.() : onNavigate?.('equipo', { tab: 'pc' })),
        onDetail: () => onNavigate?.('equipo', { tab: 'pc' }),
      },
      usb: {
        id: 'usb',
        kicker: 'PUERTO USB · ADB / LOCKDOWN IOS',
        lead: usbModel || 'Celulares',
        accent: usbConnected ? 'Conectado' : 'Android & iOS',
        statusLabel: usbConnected ? 'Cable activo' : 'USB en espera',
        tone: usbConnected ? 'clean' : 'royal',
        icon: Smartphone,
        primaryLabel: 'Abrir guía USB',
        onPrimary: () => onNavigate?.('equipo', { tab: iosOk ? 'ios' : 'android' }),
        onDetail: () => onNavigate?.('equipo', { tab: iosOk ? 'ios' : 'android' }),
      },
      link: {
        id: 'link',
        kicker: 'AISLAMIENTO WEB · CERO CONEXIÓN HTTP',
        lead: 'Escudo de',
        accent: 'Enlaces',
        statusLabel: linkRisk === 'HIGH' ? 'Riesgo Alto' : lastLinkResult ? 'Revisado' : 'Pasivo',
        tone: linkRisk === 'HIGH' ? 'alert' : lastLinkResult ? 'clean' : 'royal',
        icon: Link2,
        primaryLabel: 'Verificar en detalle',
        onPrimary: () => onNavigate?.('enlace'),
        onDetail: () => onNavigate?.('enlace'),
      },
      corpus: {
        id: 'corpus',
        kicker: `${campaignsCount} CAMPAÑAS CTI · ${iocsCount.toLocaleString('en-US')} INDICADORES`,
        lead: 'Base Forense',
        accent: 'STIX 2.1',
        statusLabel: apiOnline ? `${reportsCount} reportes` : 'Offline',
        tone: apiOnline ? 'clean' : 'royal',
        icon: Database,
        primaryLabel: syncingStix ? 'Sincronizando STIX2...' : 'Sincronizar firmas',
        onPrimary: () => onSyncStix?.(),
        onDetail: () => onNavigate?.('amenazas'),
      },
    }),
    [
      pcWarn,
      pcInfo.findingsCount,
      pcHealthy,
      scanningPc,
      pcAudit,
      isDesktop,
      onRunPcScan,
      onNavigate,
      usbModel,
      usbConnected,
      iosOk,
      linkRisk,
      lastLinkResult,
      campaignsCount,
      iocsCount,
      apiOnline,
      reportsCount,
      syncingStix,
      onSyncStix,
    ],
  );

  const activeSurface =
    (surfaceOrder.includes(selectedNodeId) ? surfaces[selectedNodeId] : null) ||
    (isDeveloper ? surfaces.repo : surfaces.windows);
  const [mount3d, setMount3d] = useState(false);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (prefersReduced) return undefined;

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(() => setMount3d(true), {
        timeout: 600,
      });
      return () => window.cancelIdleCallback(idleId);
    }
    const timer = window.setTimeout(() => setMount3d(true), 120);
    return () => window.clearTimeout(timer);
  }, []);

  function stepSurface(delta) {
    const idx = surfaceOrder.indexOf(activeSurface.id);
    const nextIdx = (idx + delta + surfaceOrder.length) % surfaceOrder.length;
    onSelectNode?.(surfaceOrder[nextIdx]);
  }

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

  const badgeClass =
    activeSurface.tone === 'alert'
      ? 'bg-[#EF4444]/15 text-[#FCA5A5] border-[#EF4444]/35'
      : activeSurface.tone === 'clean'
        ? 'bg-[#22C55E]/15 text-[#86EFAC] border-[#22C55E]/35'
        : 'bg-[#2F6FED]/15 text-[#F2F2F4] border-[#2F6FED]/45';

  const stageHealthy =
    activeSurface.id === 'windows'
      ? pcHealthy
      : activeSurface.id === 'usb'
        ? usbConnected
        : activeSurface.id === 'link'
          ? Boolean(lastLinkResult) && linkRisk !== 'HIGH'
          : apiOnline;
  const stageAlert =
    activeSurface.id === 'windows'
      ? pcWarn
      : activeSurface.id === 'link'
        ? linkRisk === 'HIGH'
        : false;

  const postureLabel = pcWarn
    ? `${pcInfo.findingsCount} ALERTAS`
    : pcHealthy
      ? '0 COINCIDENCIAS (RAM)'
      : 'EN ESPERA';

  return (
    <section
      aria-label="Cabina de postura OMEGA"
      className="relative isolate min-h-full md:h-full w-full overflow-x-hidden overflow-y-auto md:overflow-hidden flex flex-col select-none text-[#F2F2F4]"
    >
      {/* Fondo global en modo dashboard (opacity-15 en márgenes y detrás de tarjetas) */}
      <OmegaAmbientBackdrop intensity="dashboard" />

      {/* Cabecera flotante superior — Nav pill flotante separada de los bordes */}
      <header
        aria-label="Barra principal OMEGA"
        className="relative z-30 min-h-[60px] h-[60px] shrink-0 px-3.5 sm:px-7 border-b border-white/[0.05] flex items-center justify-between gap-2 select-none"
      >
        {/* Marca OMEGA izquierda */}
        <button
          type="button"
          onClick={() => onSelectNav?.('inicio')}
          className="relative z-10 inline-flex items-center gap-2 text-left rounded-[10px] px-1.5 py-1 hover:bg-white/[0.06] transition-colors cursor-pointer group shrink-0"
        >
          <OmegaBrandMark />
        </button>

        {/* Pill flotante separada (vidrio más denso blur(20px) · Blur #1) */}
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

        {/* Utilidades derechas minimalistas (Linear/Raycast) */}
        <div className="relative z-10 flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            aria-label="Abrir búsqueda rápida (⌘K)"
            title="Buscar módulo o CVE (⌘K)"
            className="px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Search className="h-[13px] w-[13px]" strokeWidth={1.75} />
            <kbd className="hidden 2xl:inline text-[11px] text-slate-500 font-sans">⌘K</kbd>
          </button>

          <button
            type="button"
            onClick={() => onOpenCopilot?.({})}
            aria-label="Abrir copiloto lateral"
            title="Copiloto (Ctrl+J)"
            className="relative p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/[0.05] inline-flex items-center justify-center transition-colors cursor-pointer"
          >
            <Bell className="h-[15px] w-[15px]" strokeWidth={1.75} />
            <span className="ml-1 text-[10px] font-medium bg-[#2F6FED] text-white px-1.5 py-0.5 rounded-full leading-none">
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
                className="px-2.5 py-1.5 rounded-lg hover:bg-white/[0.05] inline-flex items-center gap-2 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="hidden lg:inline max-w-[96px] truncate">
                  {authSession.email?.split('@')[0] || authSession.tenantSlug}
                </span>
                <ChevronDown className="h-3 w-3 text-slate-500" strokeWidth={1.75} />
              </button>

              {operatorMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-48 rounded-xl bg-[#0F131B]/95 backdrop-blur-md border border-white/[0.08] p-1.5 shadow-xl z-50 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setOperatorMenuOpen(false);
                      onNavigate?.('cuenta');
                    }}
                    className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/[0.06] cursor-pointer text-left"
                  >
                    <Settings className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.75} />
                    <span>Cuenta y Ajustes</span>
                  </button>
                  {onOpenOnboarding && (
                    <button
                      type="button"
                      onClick={() => {
                        setOperatorMenuOpen(false);
                        onOpenOnboarding();
                      }}
                      className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/[0.06] cursor-pointer text-left"
                    >
                      <BookOpen className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.75} />
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
              className="px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] inline-flex items-center gap-1.5 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
            >
              <KeyRound className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
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
                className="px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
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
        />
      </div>

      {/* Superficie modular de paneles de vidrio flotando sobre la cuadrícula punteada */}
      <div className="relative z-10 mx-auto w-full max-w-[1280px] flex-1 min-h-0 flex flex-col gap-2.5 sm:gap-3 px-4 sm:px-7 pt-1.5 pb-4">
        {/* Panel 1 — Barra compacta superior de telemetría en monospace */}
        <div
          role="region"
          aria-label="Telemetría del sistema en tiempo real"
          className="animate-kowalski-in shrink-0 rounded-[14px] bg-[#0F131B]/75 backdrop-blur-md border border-white/[0.07] shadow-[0_14px_38px_rgba(0,0,0,0.45)] px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 font-tech text-[10.5px] tracking-[0.06em] uppercase text-[#9A9AA2]"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 text-[#F2F2F4]">
              <span className={`h-1.5 w-1.5 rounded-full ${apiOnline ? 'bg-[#2F6FED]' : 'bg-[#EF4444]'}`} />
              {isDeveloper
                ? 'APPSEC · SUPPLY CHAIN'
                : pcScannedAt
                  ? `HOST · ${pcScannedAt}`
                  : 'HOST · WINDOWS LIVE'}
            </span>
            <span aria-hidden="true" className="hidden sm:inline text-white/15">|</span>
            <span>
              POSTURA:{' '}
              <strong className="font-medium text-[#F2F2F4]">
                {isDeveloper ? 'ZERO-RETENTION' : postureLabel}
              </strong>
            </span>
            <span aria-hidden="true" className="hidden sm:inline text-white/15">|</span>
            <span>
              {isDeveloper ? 'REPOS:' : 'USB:'}{' '}
              <strong className="font-medium text-[#F2F2F4]">
                {isDeveloper
                  ? 'GITHUB & CLI'
                  : usbConnected
                    ? androidOk
                      ? 'ANDROID ADB'
                      : 'IPHONE USB'
                    : 'EN ESPERA'}
              </strong>
            </span>
            <span aria-hidden="true" className="hidden lg:inline text-white/15">|</span>
            <span>
              STIX2:{' '}
              <strong className="font-medium text-[#F2F2F4]">
                {iocsCount.toLocaleString('en-US')} · {reportsCount} REPORTES
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-2 text-[#9A9AA2]">
            <span className="hidden md:inline">CORTE CTI: {catalogCutoffDate}</span>
            <span aria-hidden="true" className="hidden md:inline text-white/15">|</span>
            <span className="hidden sm:inline">TÉCNICO</span>
            <span aria-hidden="true" className="hidden sm:inline text-white/15">|</span>
            <span className="text-[#F2F2F4]">0 B EN DISCO</span>
          </div>
        </div>

        {/* Panel 2 — Foco visual central 3D aislado sobre fondo limpio #090B0F */}
        <div className="relative flex-1 min-h-[285px] md:min-h-[255px] rounded-[20px] bg-[#090B0F] border border-white/[0.07] shadow-[0_18px_46px_rgba(0,0,0,0.58)] overflow-hidden flex flex-col justify-between p-3.5 sm:p-5">
          {/* Iluminación sutil detrás de la escultura 3D para dar profundidad al panel */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 56% 52% at 50% 52%, rgba(47, 111, 237, 0.10) 0%, transparent 72%)',
            }}
          />

          {/* Escenario 3D interactivo contenido dentro del panel de vidrio */}
          <div className="pointer-events-none absolute inset-0 z-0">
            {mount3d ? (
              <Suspense
                fallback={
                  <SecurityCenterpieceFallback
                    surfaceId={activeSurface.id}
                    healthy={stageHealthy}
                    alert={stageAlert}
                  />
                }
              >
                <SecurityCenterpiece3D
                  surfaceId={activeSurface.id}
                  healthy={stageHealthy}
                  alert={stageAlert}
                  spinNonce={spinNonce}
                />
              </Suspense>
            ) : (
              <SecurityCenterpieceFallback
                surfaceId={activeSurface.id}
                healthy={stageHealthy}
                alert={stageAlert}
              />
            )}
          </div>

          {/* Selector de superficie centrado dentro del panel focal */}
          <div ref={menuRef} className="pointer-events-auto relative z-20 flex flex-col items-center text-center">
            <div className="flex items-center justify-center gap-2.5 flex-wrap">
              <button
                type="button"
                onClick={() => setSurfaceMenuOpen((v) => !v)}
                aria-expanded={surfaceMenuOpen}
                aria-haspopup="listbox"
                className="kowalski-press group inline-flex items-baseline gap-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#2F6FED] rounded-lg px-2 py-0.5"
              >
                <h1 className="font-display text-[clamp(1.45rem,2.3vw,2.05rem)] font-semibold tracking-[-0.03em] text-[#F2F2F4] leading-tight">
                  {activeSurface.lead}{' '}
                  <span className="font-light text-[#9A9AA2] group-hover:text-[#F2F2F4] transition-colors">
                    {activeSurface.accent}
                  </span>
                </h1>
                <ChevronDown
                  className={`h-4 w-4 text-[#9A9AA2] transition-transform duration-180 ease-kowalski self-center ${surfaceMenuOpen ? 'rotate-180 text-[#F2F2F4]' : ''
                    }`}
                />
              </button>

              <span
                className={`font-tech inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badgeClass}`}
              >
                {activeSurface.statusLabel}
              </span>
            </div>

            {surfaceMenuOpen && (
              <div
                role="listbox"
                aria-label="Cambiar superficie mostrada"
                className="animate-scale-in origin-top mt-2 w-[264px] rounded-[14px] border border-white/[0.1] border-b-black/50 border-r-black/50 bg-[#141418]/96 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_22px_52px_rgba(0,0,0,0.78)] text-left"
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
                      className={`w-full rounded-[10px] px-3 py-2 flex items-center justify-between gap-2 text-[12.5px] transition-colors cursor-pointer ${isSelected
                        ? 'bg-[rgba(28,36,56,0.65)] text-[#F2F2F4] border border-[#2F6FED]/40 shadow-[0_0_16px_rgba(47,111,237,0.2)]'
                        : 'text-[#9A9AA2] hover:bg-white/[0.06] hover:text-[#F2F2F4]'
                        }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <SIcon className="h-3.5 w-3.5 text-[#2F6FED]" />
                        <span className="font-medium">
                          {s.lead} {s.accent}
                        </span>
                      </span>
                      <span className="font-tech text-[10.5px] text-[#9A9AA2]">{s.statusLabel}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Barra lateral derecha minimal dentro del instrumento 3D */}
          <div
            aria-label="Controles rápidos de cabina"
            className="pointer-events-auto hidden lg:flex flex-col gap-1.5 absolute right-4 top-1/2 -translate-y-1/2 z-20"
          >
            <button
              type="button"
              onClick={activeSurface.onPrimary}
              disabled={scanningPc}
              title={activeSurface.primaryLabel}
              aria-label={activeSurface.primaryLabel}
              className="omega-glass-chip h-9 w-9 rounded-[11px] inline-flex items-center justify-center text-[#F2F2F4] hover:border-[#2F6FED]/60 cursor-pointer disabled:opacity-55"
            >
              {scanningPc ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#2F6FED]" />
              ) : (
                <ShieldCheck className="h-4 w-4 text-[#2F6FED]" />
              )}
            </button>

            <button
              type="button"
              onClick={onSyncStix}
              disabled={syncingStix}
              title="Sincronizar firmas STIX 2.1"
              aria-label="Sincronizar firmas STIX 2.1"
              className="omega-glass-chip h-9 w-9 rounded-[11px] inline-flex items-center justify-center text-[#9A9AA2] hover:text-[#F2F2F4] cursor-pointer disabled:opacity-55"
            >
              <RefreshCw className={`h-4 w-4 ${syncingStix ? 'animate-spin text-[#2F6FED]' : ''}`} />
            </button>

            <button
              type="button"
              onClick={activeSurface.onDetail}
              title="Abrir vista técnica completa"
              aria-label="Abrir vista técnica completa"
              className="omega-glass-chip h-9 w-9 rounded-[11px] inline-flex items-center justify-center text-[#9A9AA2] hover:text-[#F2F2F4] cursor-pointer"
            >
              <ArrowUpRight className="h-4 w-4" />
            </button>
          </div>

          {/* Arco orbital inferior + selector < 360° > */}
          <div className="relative z-20 mt-auto flex flex-col items-center w-full max-w-[540px] mx-auto pointer-events-none">
            <svg
              viewBox="0 0 600 28"
              aria-hidden="true"
              className="w-full h-5 pointer-events-none opacity-65"
            >
              <defs>
                <linearGradient id="omegaArcFade" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="rgba(154,154,162,0)" />
                  <stop offset="28%" stopColor="rgba(154,154,162,0.35)" />
                  <stop offset="50%" stopColor="rgba(47,111,237,0.88)" />
                  <stop offset="72%" stopColor="rgba(154,154,162,0.35)" />
                  <stop offset="100%" stopColor="rgba(154,154,162,0)" />
                </linearGradient>
              </defs>
              <path
                d="M 30 5 Q 300 26 570 5"
                fill="none"
                stroke="url(#omegaArcFade)"
                strokeWidth="2"
                strokeDasharray="2 7"
              />
            </svg>

            <div className="animate-kowalski-in pointer-events-auto -mt-3.5 inline-flex items-center gap-2 rounded-full bg-[#0A0A0C]/85 border border-white/[0.08] border-b-black/50 border-r-black/50 px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_24px_rgba(0,0,0,0.6)]">
              <button
                type="button"
                onClick={() => stepSurface(-1)}
                aria-label="Superficie anterior"
                title="Superficie anterior"
                className="kowalski-press h-7 w-7 rounded-full border border-white/[0.1] bg-white/[0.04] hover:bg-[rgba(28,36,56,0.65)] hover:border-[#2F6FED]/50 text-[#F2F2F4] inline-flex items-center justify-center cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setSpinNonce((n) => n + 1)}
                aria-label="Rotar objeto 360 grados"
                title="Girar vista 360°"
                className="kowalski-press font-tech px-2 py-0.5 text-[11.5px] font-medium text-[#9A9AA2] hover:text-[#F2F2F4] cursor-pointer"
              >
                360°
              </button>

              <button
                type="button"
                onClick={() => stepSurface(1)}
                aria-label="Siguiente superficie"
                title="Siguiente superficie"
                className="kowalski-press h-7 w-7 rounded-full border border-white/[0.1] bg-white/[0.04] hover:bg-[rgba(28,36,56,0.65)] hover:border-[#2F6FED]/50 text-[#F2F2F4] inline-flex items-center justify-center cursor-pointer"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Alertas de estado y guía rápida (sin blur adicional) */}
        {(!apiOnline || stageFeedback) && (
          <div className="space-y-2 shrink-0">
            {!apiOnline && (
              <PanelErrorBanner
                message="Backend OMEGA desconectado. Inicia Docker o el servidor Java."
              />
            )}
            {stageFeedback && (
              stageFeedback.tone === 'alert' ? (
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
              )
            )}
          </div>
        )}

        {/* Panel 3 — Hallazgos recientes y acciones rápidas con cohesión glass */}
        <footer
          aria-label="Hallazgos recientes y acciones rápidas"
          className="animate-kowalski-in shrink-0 rounded-[20px] bg-[#0F131B]/75 backdrop-blur-md border border-white/[0.07] shadow-[0_14px_38px_rgba(0,0,0,0.45)] overflow-hidden grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.07]"
        >
          {isDeveloper ? (
            <>
              {/* Columna 1 (Developer): Proyectos GitHub */}
              <div className="p-4 flex flex-col justify-between gap-2.5 transition-colors hover:bg-[rgba(28,36,56,0.35)]">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-[14px] font-semibold text-[#F2F2F4] leading-tight">
                      {moduleLabels.inicio || 'Proyectos y hallazgos'}
                    </h2>
                    <p className="text-[11.5px] text-[#9A9AA2]">
                      Repositorios · Manifiestos · Dependencias
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate?.('repo_scanner')}
                    aria-label="Abrir análisis de repositorios"
                    className="h-7 w-7 rounded-full border border-white/[0.1] bg-white/[0.04] hover:bg-[rgba(28,36,56,0.65)] hover:border-[#2F6FED]/45 text-[#9A9AA2] hover:text-[#F2F2F4] inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex items-end justify-between gap-3">
                  <div className="space-y-2 min-w-0">
                    <div className="text-[21px] font-semibold tracking-[-0.025em] text-[#F2F2F4] leading-none">
                      Zero-Retention
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate?.('repo_scanner')}
                      className="kowalski-press h-8 rounded-full bg-[#2F6FED] text-white px-3.5 text-[12px] font-medium inline-flex items-center gap-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_0_24px_rgba(47,111,237,0.25)] hover:brightness-110 cursor-pointer"
                    >
                      <PackageSearch className="h-3.5 w-3.5" />
                      <span>Analizar repositorio</span>
                    </button>
                  </div>

                  <div className="text-right font-tech shrink-0 space-y-1">
                    <div>
                      <div className="text-[12.5px] font-semibold text-[#F2F2F4]">URL / ZIP</div>
                      <div className="text-[10px] text-[#9A9AA2]">En memoria</div>
                    </div>
                    <div>
                      <div className="text-[12.5px] font-semibold text-[#F2F2F4]">0 B</div>
                      <div className="text-[10px] text-[#9A9AA2]">En disco</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Columna 2 (Developer): CLI, Tokens API y GitHub App */}
              <div className="p-4 flex flex-col justify-between gap-2.5 transition-colors hover:bg-[rgba(28,36,56,0.35)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="inline-flex items-center gap-2">
                    <span className="h-7 w-7 rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/35 text-[#2F6FED] inline-flex items-center justify-center">
                      <Terminal className="h-3.5 w-3.5" />
                    </span>
                    <div>
                      <h2 className="text-[14px] font-semibold text-[#F2F2F4] leading-tight">
                        CLI y GitHub App
                      </h2>
                      <p className="text-[11.5px] text-[#9A9AA2]">
                        omega scan · SARIF 2.1.0
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate?.('repo_scanner')}
                    aria-label="Abrir CLI y GitHub App"
                    className="h-7 w-7 rounded-full border border-white/[0.1] bg-white/[0.04] hover:bg-[rgba(28,36,56,0.65)] hover:border-[#2F6FED]/45 text-[#9A9AA2] hover:text-[#F2F2F4] inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <div className="text-[21px] font-semibold tracking-[-0.025em] text-[#F2F2F4] leading-tight truncate">
                      CI / Local
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate?.('repo_scanner')}
                      className="kowalski-press h-8 rounded-full border border-white/[0.1] bg-white/[0.04] hover:bg-[rgba(28,36,56,0.65)] text-[#F2F2F4] px-3.5 text-[11.5px] font-medium inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>Tokens y GitHub</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="text-right font-tech shrink-0 space-y-1">
                    <div>
                      <div className="text-[12.5px] font-semibold text-[#F2F2F4]">REPO_SCAN</div>
                      <div className="text-[10px] text-[#9A9AA2]">Alcance API</div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
          {/* Columna 1: Equipo Local & Acción Primaria */}
          <div className="p-4 flex flex-col justify-between gap-2.5 transition-colors hover:bg-[rgba(28,36,56,0.35)]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-[14px] font-semibold text-[#F2F2F4] leading-tight">
                  Equipo Local
                </h2>
                <p className="text-[11.5px] text-[#9A9AA2]">
                  WMI · Sockets RAM
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate?.('equipo', { tab: 'pc' })}
                aria-label="Abrir detalles del equipo"
                className="h-7 w-7 rounded-full border border-white/[0.1] bg-white/[0.04] hover:bg-[rgba(28,36,56,0.65)] hover:border-[#2F6FED]/45 text-[#9A9AA2] hover:text-[#F2F2F4] inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-end justify-between gap-3">
              <div className="space-y-2 min-w-0">
                <div className="text-[21px] font-semibold tracking-[-0.025em] text-[#F2F2F4] leading-none">
                  {pcWarn
                    ? `${pcInfo.findingsCount} alertas`
                    : pcHealthy
                      ? '0 coincidencias'
                      : 'Listo RAM'}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => (isDesktop ? onRunPcScan?.() : onNavigate?.('equipo', { tab: 'pc' }))}
                    disabled={scanningPc}
                    className="kowalski-press h-8 rounded-full bg-[#2F6FED] text-white px-3.5 text-[12px] font-medium inline-flex items-center gap-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_0_24px_rgba(47,111,237,0.25)] hover:brightness-110 cursor-pointer disabled:opacity-60"
                  >
                    {scanningPc && <Loader2 className="h-3 w-3 animate-spin" />}
                    <span>
                      {scanningPc
                        ? 'Analizando...'
                        : pcAudit
                          ? 'Reanalizar PC'
                          : isDesktop
                            ? 'Analizar esta PC ahora'
                            : 'Abrir inspector PC'}
                    </span>
                  </button>

                  {pcAudit && (
                    <button
                      type="button"
                      onClick={() => onNavigate?.('equipo', { tab: 'pc' })}
                      className="kowalski-press h-8 rounded-full border border-white/[0.1] bg-white/[0.04] hover:bg-[rgba(28,36,56,0.65)] text-[#F2F2F4] px-3 text-[11.5px] font-medium inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span>Ver informe</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="text-right font-tech shrink-0 space-y-1">
                <div>
                  <div className="text-[12.5px] font-semibold text-[#F2F2F4]">
                    {pcAudit ? `${pcInfo.sockets}` : 'WMI'}
                  </div>
                  <div className="text-[10px] text-[#9A9AA2]">Sockets activos</div>
                </div>
                <div>
                  <div className="text-[12.5px] font-semibold text-[#F2F2F4]">
                    {pcAudit ? `${pcInfo.yaraHits} YARA` : '0 B'}
                  </div>
                  <div className="text-[10px] text-[#9A9AA2]">{pcAudit ? 'Hits YARA' : 'En disco'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Columna 2: Dispositivos USB (Android ADB & iPhone iOS) */}
          <div className="p-4 flex flex-col justify-between gap-2.5 transition-colors hover:bg-[rgba(28,36,56,0.35)]">
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-2">
                <span className="h-7 w-7 rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/35 text-[#2F6FED] inline-flex items-center justify-center">
                  <Smartphone className="h-3.5 w-3.5" />
                </span>
                <div>
                  <h2 className="text-[14px] font-semibold text-[#F2F2F4] leading-tight">
                    Celulares USB
                  </h2>
                  <p className="text-[11.5px] text-[#9A9AA2]">
                    ADB · Lockdown iOS
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate?.('equipo', { tab: iosOk ? 'ios' : 'android' })}
                aria-label="Abrir inspección móvil por USB"
                className="h-7 w-7 rounded-full border border-white/[0.1] bg-white/[0.04] hover:bg-[rgba(28,36,56,0.65)] hover:border-[#2F6FED]/45 text-[#9A9AA2] hover:text-[#F2F2F4] inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[21px] font-semibold tracking-[-0.025em] text-[#F2F2F4] leading-tight truncate">
                  {usbConnected ? (androidOk ? 'Android' : 'iPhone') : 'En espera'}
                </div>
                <div className="mt-1 text-[11.5px] text-[#9A9AA2] truncate">
                  {usbModel || 'Conecta cable USB para revisar'}
                </div>
              </div>

              <div className="relative h-14 w-14 shrink-0 flex items-center justify-center">
                <svg viewBox="0 0 56 56" className="h-full w-full -rotate-90" aria-hidden="true">
                  <circle
                    cx="28"
                    cy="28"
                    r="23"
                    fill="none"
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth="4.5"
                  />
                  <circle
                    cx="28"
                    cy="28"
                    r="23"
                    fill="none"
                    stroke={usbConnected ? '#22C55E' : '#2F6FED'}
                    strokeWidth="4.5"
                    strokeDasharray="144.5"
                    strokeDashoffset={usbConnected ? '20' : '92'}
                    strokeLinecap="round"
                  />
                </svg>
                <Smartphone
                  className={`absolute h-4 w-4 ${usbConnected ? 'text-[#22C55E]' : 'text-[#2F6FED]'}`}
                />
              </div>
            </div>
          </div>
            </>
          )}

          {/* Columna 3: Escudo Web Pasivo & Corpus STIX 2.1 */}
          <div className="p-4 flex flex-col justify-between gap-2.5 transition-colors hover:bg-[rgba(28,36,56,0.35)]">
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-2">
                <span className="h-7 w-7 rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/35 text-[#2F6FED] inline-flex items-center justify-center">
                  <Link2 className="h-3.5 w-3.5" />
                </span>
                <div>
                  <h2 className="text-[14px] font-semibold text-[#F2F2F4] leading-tight">
                    Escudo Web
                  </h2>
                  <p className="text-[11.5px] text-[#9A9AA2]">
                    Verificación pasiva
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate?.('enlace')}
                aria-label="Abrir verificador completo de enlaces"
                className="kowalski-press h-7 w-7 rounded-full border border-white/[0.1] bg-white/[0.04] hover:bg-[rgba(28,36,56,0.65)] hover:border-[#2F6FED]/45 text-[#9A9AA2] hover:text-[#F2F2F4] inline-flex items-center justify-center cursor-pointer shrink-0"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <form noValidate onSubmit={handleQuickLinkSubmit} className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  maxLength={2048}
                  value={quickUrl}
                  onChange={(e) => {
                    setQuickUrl(stripUnsafeChars(e.target.value, 2048));
                    if (inlineLink?.error) setInlineLink(null);
                  }}
                  aria-invalid={Boolean(inlineLink?.error)}
                  placeholder="Pega enlace sospechoso sin abrirlo..."
                  aria-label="Enlace sospechoso para verificar"
                  className="flex-1 min-w-0 h-8 rounded-full bg-[#0A0A0C]/75 border border-white/[0.08] px-3 text-[12px] text-[#F2F2F4] placeholder:text-[#9A9AA2] focus:outline-none focus:border-[#2F6FED] focus:shadow-[0_0_20px_rgba(47,111,237,0.22)] transition-all"
                />
                <button
                  type="submit"
                  disabled={linkLoading || !quickUrl.trim()}
                  className="kowalski-press h-8 rounded-full bg-[#2F6FED] disabled:bg-white/[0.08] disabled:text-[#9A9AA2] px-3 text-[11.5px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_20px_rgba(47,111,237,0.25)] hover:brightness-110 disabled:shadow-none cursor-pointer shrink-0"
                >
                  {linkLoading ? '...' : 'Verificar'}
                </button>
              </div>

              {inlineLink ? (
                <div
                  className={`rounded-[10px] border px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px] ${inlineLink.error
                    ? 'bg-[#EF4444]/10 border-[#EF4444]/35 text-[#FCA5A5]'
                    : inlineLink.risk_level === 'HIGH'
                      ? 'bg-[#EF4444]/10 border-[#EF4444]/35 text-[#FCA5A5]'
                      : 'bg-[#0A0A0C]/75 border-white/[0.08] text-[#F2F2F4]'
                    }`}
                >
                  <span className="inline-flex items-center gap-1.5 truncate">
                    {(inlineLink.error || inlineLink.risk_level === 'HIGH') && (
                      <ShieldAlert className="h-3.5 w-3.5 text-[#EF4444] shrink-0" />
                    )}
                    <span className="truncate">
                      {inlineLink.error || `Listo · ${inlineLink.verdict || inlineLink.risk_level || 'Revisado'}`}
                    </span>
                  </span>
                  {!inlineLink.error && (
                    <button
                      type="button"
                      onClick={() => onNavigate?.('enlace', { url: inlineLink.url })}
                      className="text-[#F2F2F4] underline decoration-[#2F6FED]/60 hover:text-[#2F6FED] font-medium shrink-0 cursor-pointer"
                    >
                      Detalle →
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between text-[11px] text-[#9A9AA2] pt-0.5">
                  <span className="font-tech">Cero HTTP saliente</span>
                  <button
                    type="button"
                    onClick={() => onNavigate?.('amenazas')}
                    className="text-[#F2F2F4] hover:text-[#2F6FED] underline decoration-[#2F6FED]/55 cursor-pointer transition-colors"
                  >
                    {moduleLabels.amenazas || 'Amenazas'} →
                  </button>
                </div>
              )}
            </form>
          </div>
        </footer>
      </div>
    </section>
  );
}
