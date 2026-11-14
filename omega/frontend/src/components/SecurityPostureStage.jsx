import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Laptop,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { verifySuspiciousLink } from '../lib/api';
import { OmegaLogo } from './OmegaLogo';
import { SpatialNavPill } from './SpatialNavPill';
import { SecurityCenterpiece3D } from './SecurityCenterpiece3D';

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
  technicalMode = false,
  onToggleTechnicalMode,
  apiOnline = true,
  isLoadingChat = false,
  scanningPc = false,
  syncingStix = false,
  onRunPcScan,
  onSyncStix,
  onOpenCommandPalette,
  onOpenCopilot,
  onNavigate,
  onLinkVerified,
  onLogActivity,
}) {
  const [surfaceMenuOpen, setSurfaceMenuOpen] = useState(false);
  const [spinNonce, setSpinNonce] = useState(0);
  const [quickUrl, setQuickUrl] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [inlineLink, setInlineLink] = useState(null);
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
      windows: {
        id: 'windows',
        kicker: technicalMode ? 'HOST LOCAL · WMI / SOCKETS RAM' : 'HOST LOCAL · OPERACIÓN EN RAM',
        lead: 'Esta PC',
        accent: 'Windows',
        statusLabel: pcWarn
          ? `Revisar (${pcInfo.findingsCount})`
          : pcHealthy
            ? 'Verificado · 100%'
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
        kicker: technicalMode ? 'PUERTO USB · ADB / LOCKDOWN IOS' : 'INSPECCIÓN MÓVIL POR CABLE',
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
        kicker: 'SANDBOX WEB · CERO CONEXIÓN HTTP',
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
      technicalMode,
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

  const activeSurface = surfaces[selectedNodeId] || surfaces.windows;

  function stepSurface(delta) {
    const idx = SURFACE_ORDER.indexOf(activeSurface.id);
    const nextIdx = (idx + delta + SURFACE_ORDER.length) % SURFACE_ORDER.length;
    onSelectNode?.(SURFACE_ORDER[nextIdx]);
  }

  async function handleQuickLinkSubmit(e) {
    e.preventDefault();
    const cleaned = quickUrl.trim();
    if (!cleaned || linkLoading) return;
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
  }

  const badgeClass =
    activeSurface.tone === 'alert'
      ? 'bg-[#EF4444]/15 text-[#FCA5A5] border-[#EF4444]/35'
      : activeSurface.tone === 'clean'
        ? 'bg-[#22C55E]/15 text-[#86EFAC] border-[#22C55E]/35'
        : 'bg-[#1D4ED8]/20 text-[#93C5FD] border-[#3B82F6]/35';

  return (
    <section
      aria-label="Cabina de postura OMEGA"
      className="omega-studio-bg relative min-h-full md:h-full w-full overflow-x-hidden overflow-y-auto md:overflow-hidden flex flex-col justify-between select-none text-[#F8FAFC]"
    >
      {/* Escenario WebGL de estudio a pantalla completa (cuadrícula en perspectiva + logo OMEGA futurista) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[100dvh] md:inset-0 md:h-full z-0">
        <SecurityCenterpiece3D
          surfaceId={activeSurface.id}
          healthy={
            activeSurface.id === 'windows'
              ? pcHealthy
              : activeSurface.id === 'usb'
                ? usbConnected
                : activeSurface.id === 'link'
                  ? Boolean(lastLinkResult) && linkRisk !== 'HIGH'
                  : apiOnline
          }
          alert={
            activeSurface.id === 'windows'
              ? pcWarn
              : activeSurface.id === 'link'
                ? linkRisk === 'HIGH'
                : false
          }
          spinNonce={spinNonce}
        />
      </div>

      {/* Marco arquitectónico con rieles finos y marcadores de calibración lateral */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[56px] bottom-0 z-0 mx-auto max-w-[1320px] border-x border-white/[0.045]"
      >
        <span className="absolute -left-px top-6 h-3 w-px bg-[#3B82F6]/45" />
        <span className="absolute -right-px top-6 h-3 w-px bg-[#3B82F6]/45" />
        <span className="absolute -left-px bottom-6 h-3 w-px bg-[#3B82F6]/45" />
        <span className="absolute -right-px bottom-6 h-3 w-px bg-[#3B82F6]/45" />
        <div className="hidden lg:flex items-center justify-between px-7 pt-6">
          <div className="font-tech text-[10px] tracking-[0.14em] text-[#64748B]/85 uppercase space-y-1">
            <div>{pcScannedAt ? `HOST · ${pcScannedAt}` : 'HOST WINDOWS'}</div>
            <div className="text-[#475569]">MODO · {technicalMode ? 'TÉCNICO' : 'SIMPLE'}</div>
          </div>
          <div className="font-tech text-right text-[10px] tracking-[0.14em] text-[#64748B]/85 uppercase space-y-1">
            <div>MEMORIA VOLÁTIL</div>
            <div className="text-[#475569]">0 BYTES EN DISCO</div>
          </div>
        </div>
      </div>

      {/* Cabecera Superior Unificada — Navegación centrada en todo ancho */}
      <header
        aria-label="Barra principal OMEGA"
        className={`relative z-30 shrink-0 h-[56px] px-5 sm:px-7 flex items-center justify-between gap-2 ${
          isDesktop
            ? 'titlebar-drag [&_button]:[-webkit-app-region:no-drag] [&_div[role=group]]:[-webkit-app-region:no-drag]'
            : ''
        }`}
      >
        {/* Marca OMEGA izquierda */}
        <button
          type="button"
          onClick={() => onSelectNav?.('inicio')}
          className="relative z-10 inline-flex items-center gap-2.5 text-left cursor-pointer group shrink-0"
        >
          <OmegaLogo size={23} isThinking={isLoadingChat} />
          <span className="font-display text-[15px] font-semibold tracking-[0.06em] text-white group-hover:text-[#DBEAFE] transition-colors">
            OMEGA
          </span>
        </button>

        {/* Barra de navegación segmentada matemáticamente centrada al viewport */}
        <div className="hidden md:flex justify-center md:absolute md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 z-20">
          <SpatialNavPill
            activeNav={activeNav}
            onSelectNav={onSelectNav}
            pcVerdict={pcVerdict}
            usbConnected={usbConnected}
            apiOnline={apiOnline}
            isLoadingChat={isLoadingChat}
          />
        </div>

        {/* Utilidades derechas con reserva limpia para botones - □ ✕ */}
        <div className={`relative z-10 flex flex-col items-end gap-1 shrink-0 ${isDesktop ? 'sm:mr-36' : ''}`}>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onOpenCopilot?.({})}
              aria-label="Abrir copiloto lateral"
              title="Abrir copiloto lateral (Ctrl+J)"
              className="omega-glass-chip relative h-8 xl:h-9 px-2 xl:px-3.5 rounded-[11px] inline-flex items-center gap-1.5 xl:gap-2 text-[12px] font-medium text-[#E2E8F0] hover:text-white cursor-pointer transition-all"
            >
              <Bell className="h-3.5 w-3.5 text-[#93C5FD]" />
              <span className="hidden xl:inline">Copiloto</span>
              <span className="font-tech h-4 min-w-[16px] px-1 rounded-full bg-[#1D4ED8] text-white text-[10px] font-bold inline-flex items-center justify-center">
                {pcWarn ? pcInfo.findingsCount : reportsCount}
              </span>
            </button>

            <button
              type="button"
              onClick={onOpenCommandPalette}
              aria-label="Abrir búsqueda rápida (⌘K)"
              title="Buscar módulo o CVE (⌘K)"
              className="omega-glass-chip h-8 xl:h-9 px-2 xl:px-2.5 rounded-[11px] inline-flex items-center gap-1.5 text-[11.5px] text-[#CBD5E1] hover:text-white cursor-pointer transition-all"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="font-tech hidden xl:inline">⌘K</span>
            </button>

            <div
              role="group"
              aria-label="Nivel de detalle"
              className="omega-glass-chip hidden sm:inline-flex items-center rounded-[11px] p-0.5 h-8 xl:h-9"
            >
              <button
                type="button"
                onClick={() => onToggleTechnicalMode?.(false)}
                className={`px-2 xl:px-2.5 py-1 rounded-[8px] text-[11px] xl:text-[11.5px] font-medium transition-all cursor-pointer ${
                  !technicalMode ? 'bg-white text-[#070B14] shadow-xs' : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                Simple
              </button>
              <button
                type="button"
                onClick={() => onToggleTechnicalMode?.(true)}
                className={`px-2 xl:px-2.5 py-1 rounded-[8px] text-[11px] xl:text-[11.5px] font-medium transition-all cursor-pointer ${
                  technicalMode ? 'bg-white text-[#070B14] shadow-xs' : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                Técnico
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Nav compacto en anchos estrechos */}
      <div className="relative z-20 md:hidden flex justify-center px-3 pt-1">
        <SpatialNavPill
          compact
          activeNav={activeNav}
          onSelectNav={onSelectNav}
          pcVerdict={pcVerdict}
          usbConnected={usbConnected}
          apiOnline={apiOnline}
          isLoadingChat={isLoadingChat}
        />
      </div>

      {/* Escenario Central del Logo OMEGA Futurista */}
      <div className="pointer-events-none relative z-10 flex-1 min-h-[415px] md:min-h-0 flex flex-col items-center justify-between px-4 sm:px-8 pt-4 pb-2">
        {/* Selector de superficie centrado sin eyebrow decorativo */}
        <div ref={menuRef} className="pointer-events-auto relative z-20 flex flex-col items-center text-center">
          <div className="flex items-center justify-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={() => setSurfaceMenuOpen((v) => !v)}
              aria-expanded={surfaceMenuOpen}
              aria-haspopup="listbox"
              className="group inline-flex items-baseline gap-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#3B82F6] rounded-lg px-2 py-0.5"
            >
              <h1 className="font-display text-[clamp(1.65rem,2.6vw,2.3rem)] font-semibold tracking-[-0.03em] text-white leading-tight">
                {activeSurface.lead}{' '}
                <span className="font-light text-[#94A3B8] group-hover:text-[#CBD5E1] transition-colors">
                  {activeSurface.accent}
                </span>
              </h1>
              <ChevronDown
                className={`h-4 w-4 text-[#94A3B8] transition-transform self-center ${
                  surfaceMenuOpen ? 'rotate-180 text-white' : ''
                }`}
              />
            </button>

            <span
              className={`font-tech inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badgeClass}`}
            >
              {activeSurface.statusLabel}
            </span>
          </div>

          {/* Selector desplegable discreto entre las 4 superficies de protección */}
          {surfaceMenuOpen && (
            <div
              role="listbox"
              aria-label="Cambiar superficie mostrada"
              className="animate-scale-in origin-top mt-2 w-[260px] rounded-[14px] border border-white/[0.12] bg-[#070B14]/95 backdrop-blur-xl p-1.5 shadow-[0_20px_48px_rgba(0,0,0,0.65)] text-left"
            >
              {SURFACE_ORDER.map((id) => {
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
                    className={`w-full rounded-[10px] px-3 py-2 flex items-center justify-between gap-2 text-[12.5px] transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#1D4ED8]/25 text-white'
                        : 'text-[#CBD5E1] hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <SIcon className="h-3.5 w-3.5 text-[#60A5FA]" />
                      <span className="font-medium">
                        {s.lead} {s.accent}
                      </span>
                    </span>
                    <span className="font-tech text-[10.5px] text-[#94A3B8]">{s.statusLabel}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Ventana abierta de inspección 3D + arco orbital < 360° > */}
        <div className="relative z-20 mt-auto flex flex-col items-center w-full max-w-[640px]">
          <svg
            viewBox="0 0 600 32"
            aria-hidden="true"
            className="w-full h-6 pointer-events-none opacity-65"
          >
            <defs>
              <linearGradient id="omegaArcFade" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(148,163,184,0)" />
                <stop offset="28%" stopColor="rgba(148,163,184,0.45)" />
                <stop offset="50%" stopColor="rgba(59,130,246,0.85)" />
                <stop offset="72%" stopColor="rgba(148,163,184,0.45)" />
                <stop offset="100%" stopColor="rgba(148,163,184,0)" />
              </linearGradient>
            </defs>
            <path
              d="M 30 6 Q 300 30 570 6"
              fill="none"
              stroke="url(#omegaArcFade)"
              strokeWidth="2.5"
              strokeDasharray="2 7"
            />
          </svg>

          <div className="animate-fade-up pointer-events-auto -mt-4 inline-flex items-center gap-2.5 rounded-full bg-[#070B14]/90 border border-white/[0.1] backdrop-blur-md px-2.5 py-1 shadow-lg">
            <button
              type="button"
              onClick={() => stepSurface(-1)}
              aria-label="Superficie anterior"
              title="Superficie anterior"
              className="h-7 w-7 rounded-full border border-white/[0.14] bg-white/[0.05] hover:bg-[#1D4ED8]/40 text-white inline-flex items-center justify-center cursor-pointer transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setSpinNonce((n) => n + 1)}
              aria-label="Rotar objeto 360 grados"
              title="Girar vista 360°"
              className="font-tech px-2 py-0.5 text-[11.5px] font-medium text-[#CBD5E1] hover:text-white cursor-pointer transition-colors"
            >
              360°
            </button>

            <button
              type="button"
              onClick={() => stepSurface(1)}
              aria-label="Siguiente superficie"
              title="Siguiente superficie"
              className="h-7 w-7 rounded-full border border-white/[0.14] bg-white/[0.05] hover:bg-[#1D4ED8]/40 text-white inline-flex items-center justify-center cursor-pointer transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Barra lateral flotante derecha minimal (acciones rápidas de estudio) */}
        <div
          aria-label="Controles rápidos de cabina"
          className="pointer-events-auto hidden lg:flex flex-col gap-1.5 absolute right-6 top-1/2 -translate-y-1/2 z-20"
        >
          <button
            type="button"
            onClick={activeSurface.onPrimary}
            disabled={scanningPc}
            title={activeSurface.primaryLabel}
            aria-label={activeSurface.primaryLabel}
            className="omega-glass-chip h-9 w-9 rounded-[11px] inline-flex items-center justify-center text-[#93C5FD] hover:text-white hover:border-[#3B82F6]/50 cursor-pointer transition-all disabled:opacity-55"
          >
            {scanningPc ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={onSyncStix}
            disabled={syncingStix}
            title="Sincronizar firmas STIX 2.1"
            aria-label="Sincronizar firmas STIX 2.1"
            className="omega-glass-chip h-9 w-9 rounded-[11px] inline-flex items-center justify-center text-[#CBD5E1] hover:text-white cursor-pointer transition-all disabled:opacity-55"
          >
            <RefreshCw className={`h-4 w-4 ${syncingStix ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={activeSurface.onDetail}
            title="Abrir vista técnica completa"
            aria-label="Abrir vista técnica completa"
            className="omega-glass-chip h-9 w-9 rounded-[11px] inline-flex items-center justify-center text-[#CBD5E1] hover:text-white cursor-pointer transition-all"
          >
            <ArrowUpRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Trío Inferior de Tarjetas de Vidrio Oscuro (Bento Sereno Negro · Blanco · Azul Rey) */}
      <footer className="relative z-20 shrink-0 px-3.5 sm:px-7 pb-4 pt-2">
        <div className="mx-auto max-w-[1280px] grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Tarjeta 1: Detalles del Equipo Local & Acción Primaria en Azul Rey */}
          <div
            style={{ animationDelay: '60ms' }}
            className="animate-fade-up omega-glass-card rounded-[20px] p-4 flex flex-col justify-between gap-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.16]"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-[14px] font-semibold text-white leading-tight">
                  Equipo Local
                </h2>
                <p className="text-[11.5px] text-[#94A3B8]">
                  {technicalMode ? 'WMI / Sockets RAM · Tiempo real' : 'Procesos RAM · Persistencia WMI'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate?.('equipo', { tab: 'pc' })}
                aria-label="Abrir detalles del equipo"
                className="h-7 w-7 rounded-full border border-white/[0.12] bg-white/[0.05] hover:bg-white/[0.14] text-[#CBD5E1] hover:text-white inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-end justify-between gap-3">
              <div className="space-y-2 min-w-0">
                <div className="text-[22px] font-semibold tracking-[-0.025em] text-white leading-none">
                  {pcWarn
                    ? `${pcInfo.findingsCount} alertas`
                    : pcHealthy
                      ? 'Limpio 100%'
                      : 'Listo RAM'}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => (isDesktop ? onRunPcScan?.() : onNavigate?.('equipo', { tab: 'pc' }))}
                    disabled={scanningPc}
                    className="h-8 rounded-full bg-[#1D4ED8] hover:bg-[#1E40AF] text-white px-3.5 text-[12px] font-medium inline-flex items-center gap-1.5 shadow-[0_6px_18px_rgba(29,78,216,0.34)] cursor-pointer transition-colors disabled:opacity-60"
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
                      className="h-8 rounded-full border border-white/[0.14] bg-white/[0.06] hover:bg-white/[0.12] text-white px-3 text-[11.5px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <span>Ver informe</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="text-right font-tech shrink-0 space-y-1">
                <div>
                  <div className="text-[12.5px] font-semibold text-white">
                    {pcAudit ? `${pcInfo.sockets}` : 'WMI'}
                  </div>
                  <div className="text-[10px] text-[#94A3B8]">Sockets activos</div>
                </div>
                <div>
                  <div className="text-[12.5px] font-semibold text-[#93C5FD]">
                    {pcAudit ? `${pcInfo.yaraHits} YARA` : '0 B'}
                  </div>
                  <div className="text-[10px] text-[#94A3B8]">{pcAudit ? 'Hits YARA' : 'En disco'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Tarjeta 2: Dispositivos USB (Android ADB & iPhone iOS) */}
          <div
            style={{ animationDelay: '120ms' }}
            className="animate-fade-up omega-glass-card rounded-[20px] p-4 flex flex-col justify-between gap-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.16]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-2">
                <span className="h-7 w-7 rounded-lg bg-[#1D4ED8]/20 border border-[#3B82F6]/30 text-[#60A5FA] inline-flex items-center justify-center">
                  <Smartphone className="h-3.5 w-3.5" />
                </span>
                <div>
                  <h2 className="text-[14px] font-semibold text-white leading-tight">
                    Celulares USB
                  </h2>
                  <p className="text-[11.5px] text-[#94A3B8]">
                    {technicalMode ? 'ADB local · Lockdown iOS' : 'Android e iPhone por cable'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate?.('equipo', { tab: iosOk ? 'ios' : 'android' })}
                aria-label="Abrir inspección móvil por USB"
                className="h-7 w-7 rounded-full border border-white/[0.12] bg-white/[0.05] hover:bg-white/[0.14] text-[#CBD5E1] hover:text-white inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[22px] font-semibold tracking-[-0.025em] text-white leading-tight truncate">
                  {usbConnected ? (androidOk ? 'Android' : 'iPhone') : 'En espera'}
                </div>
                <div className="mt-1 text-[11.5px] text-[#94A3B8] truncate">
                  {usbModel || 'Conecta cable USB para revisar'}
                </div>
              </div>

              {/* Anillo concéntrico minimal de estado físico */}
              <div className="relative h-14 w-14 shrink-0 flex items-center justify-center">
                <svg viewBox="0 0 56 56" className="h-full w-full -rotate-90" aria-hidden="true">
                  <circle
                    cx="28"
                    cy="28"
                    r="23"
                    fill="none"
                    stroke="rgba(255,255,255,0.1)"
                    strokeWidth="4.5"
                  />
                  <circle
                    cx="28"
                    cy="28"
                    r="23"
                    fill="none"
                    stroke={usbConnected ? '#22C55E' : '#2563EB'}
                    strokeWidth="4.5"
                    strokeDasharray="144.5"
                    strokeDashoffset={usbConnected ? '20' : '92'}
                    strokeLinecap="round"
                  />
                </svg>
                <Smartphone
                  className={`absolute h-4 w-4 ${usbConnected ? 'text-[#4ADE80]' : 'text-[#93C5FD]'}`}
                />
              </div>
            </div>
          </div>

          {/* Tarjeta 3: Escudo Web Pasivo & Corpus STIX 2.1 */}
          <div
            style={{ animationDelay: '180ms' }}
            className="animate-fade-up omega-glass-card rounded-[20px] p-4 flex flex-col justify-between gap-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.16]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-2">
                <span className="h-7 w-7 rounded-lg bg-[#1D4ED8]/20 border border-[#3B82F6]/30 text-[#60A5FA] inline-flex items-center justify-center">
                  <Link2 className="h-3.5 w-3.5" />
                </span>
                <div>
                  <h2 className="text-[14px] font-semibold text-white leading-tight">
                    Escudo Web y STIX2
                  </h2>
                  <p className="text-[11.5px] text-[#94A3B8]">
                    {iocsCount.toLocaleString('en-US')} firmas · {reportsCount} reportes
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate?.('enlace')}
                aria-label="Abrir verificador completo de enlaces"
                className="h-7 w-7 rounded-full border border-white/[0.12] bg-white/[0.05] hover:bg-white/[0.14] text-[#CBD5E1] hover:text-white inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <form onSubmit={handleQuickLinkSubmit} className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="url"
                  value={quickUrl}
                  onChange={(e) => setQuickUrl(e.target.value)}
                  placeholder="Pega enlace sospechoso sin abrirlo..."
                  aria-label="Enlace sospechoso para verificar"
                  className="flex-1 min-w-0 h-8 rounded-full bg-[#050912]/75 border border-white/[0.12] px-3 text-[12px] text-white placeholder:text-[#64748B] focus:outline-none focus:border-[#3B82F6]"
                />
                <button
                  type="submit"
                  disabled={linkLoading || !quickUrl.trim()}
                  className="h-8 rounded-full bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:bg-white/[0.08] disabled:text-[#64748B] px-3 text-[11.5px] font-semibold text-white cursor-pointer transition-colors shrink-0"
                >
                  {linkLoading ? '...' : 'Verificar'}
                </button>
              </div>

              {inlineLink ? (
                <div className="rounded-[10px] bg-[#050912]/90 border border-white/[0.1] px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1.5 truncate text-[#E2E8F0]">
                    {inlineLink.risk_level === 'HIGH' && (
                      <ShieldAlert className="h-3.5 w-3.5 text-[#EF4444] shrink-0" />
                    )}
                    <span className="truncate">
                      {inlineLink.error || `${inlineLink.verdict || 'Revisado'}`}
                    </span>
                  </span>
                  {!inlineLink.error && (
                    <button
                      type="button"
                      onClick={() => onNavigate?.('enlace', { url: inlineLink.url })}
                      className="text-[#60A5FA] hover:text-[#93C5FD] font-medium shrink-0 cursor-pointer"
                    >
                      Detalle →
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between text-[11px] text-[#94A3B8] pt-0.5">
                  <span className="font-tech">Memoria volátil · Cero HTTP</span>
                  <button
                    type="button"
                    onClick={() => onNavigate?.('amenazas')}
                    className="text-[#93C5FD] hover:text-white cursor-pointer transition-colors"
                  >
                    Ver amenazas →
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      </footer>
    </section>
  );
}
