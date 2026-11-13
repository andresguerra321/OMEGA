import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Bell,
  Database,
  Laptop,
  Link2,
  Loader2,
  Search,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { verifySuspiciousLink } from '../lib/api';

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

function HardwareHeroGraphic({ subject = 'windows', healthy = false, alert = false }) {
  const ledColor = alert ? '#FF453A' : healthy ? '#22C55E' : '#F5A623';

  if (subject === 'usb') {
    return (
      <svg
        width="168"
        height="128"
        viewBox="0 0 168 128"
        aria-hidden="true"
        className="mx-auto drop-shadow-[0_14px_20px_rgba(20,22,26,0.16)]"
      >
        <rect x="46" y="10" width="76" height="108" rx="16" fill="#1E222A" />
        <rect x="52" y="16" width="64" height="96" rx="11" fill="#101318" />
        <rect x="74" y="21" width="20" height="4" rx="2" fill="#2A303B" />
        <circle cx="84" cy="54" r="16" fill="rgba(245,166,35,0.14)" stroke={ledColor} strokeWidth="2.5" />
        <circle cx="84" cy="54" r="5" fill={ledColor} />
        <line x1="66" y1="84" x2="102" y2="84" stroke="#363D4A" strokeWidth="3" strokeLinecap="round" />
        <line x1="72" y1="93" x2="96" y2="93" stroke="#282E38" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }

  // Vista cenital minimalista de equipo portátil (en diálogo estético con el manubrio limpio de Roam)
  return (
    <svg
      width="220"
      height="132"
      viewBox="0 0 220 132"
      aria-hidden="true"
      className="mx-auto drop-shadow-[0_16px_22px_rgba(20,22,26,0.15)]"
    >
      {/* Base de chasis aluminio anodizado */}
      <rect x="30" y="16" width="160" height="100" rx="14" fill="#232730" />
      <rect x="34" y="20" width="152" height="92" rx="11" fill="#171A21" />
      {/* Bisagra / acento táctil superior */}
      <rect x="74" y="13" width="72" height="6" rx="3" fill="#F5A623" />
      {/* Matriz teclado minimal */}
      <rect x="48" y="30" width="124" height="40" rx="6" fill="#222630" />
      {[0, 1, 2].map((row) => (
        <g key={row} fill="#313744">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((col) => (
            <rect
              key={`${row}-${col}`}
              x={54 + col * 12.6}
              y={35 + row * 10}
              width="9.5"
              height="7"
              rx="1.8"
            />
          ))}
        </g>
      ))}
      {/* Trackpad */}
      <rect x="82" y="77" width="56" height="26" rx="5" fill="#1F232C" stroke="#2D323E" strokeWidth="1" />
      {/* LED de integridad */}
      <circle cx="110" cy="24" r="3" fill={ledColor} />
    </svg>
  );
}

export function OverviewWarmInspector({
  isDesktop = false,
  selectedNodeId = 'windows',
  technicalMode = false,
  onToggleTechnicalMode,
  apiOnline = true,
  govStats,
  usbStatus,
  pcAudit,
  pcScannedAt,
  lastLinkResult,
  scanningPc = false,
  syncingStix = false,
  onRunPcScan,
  onSyncStix,
  onNavigate,
  onOpenCopilot,
  onOpenCommandPalette,
  onLinkVerified,
  onLogActivity,
}) {
  const [quickUrl, setQuickUrl] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [inlineLink, setInlineLink] = useState(null);
  const [showLinkInput, setShowLinkInput] = useState(false);

  const pcInfo = useMemo(() => extractPcVerdictInfo(pcAudit), [pcAudit]);
  const pcHealthy =
    Boolean(pcAudit) &&
    (pcInfo.verdict === 'clean' || pcInfo.verdict === 'low' || pcInfo.findingsCount === 0);
  const pcAlert = Boolean(pcAudit) && !pcHealthy;

  const reportsCount = Number(govStats?.corpus_stats?.reports ?? 16);
  const iocsCount = Number(govStats?.corpus_stats?.iocs ?? 4896);
  const androidConnected = Boolean(usbStatus?.android?.connected);
  const iosConnected = Boolean(usbStatus?.ios?.connected);

  // Sujeto principal dinámico según el nodo seleccionado en el mapa izquierdo
  const heroSubject = useMemo(() => {
    if (selectedNodeId === 'usb') {
      const usbName = androidConnected
        ? usbStatus?.android?.model || 'Android USB'
        : iosConnected
          ? usbStatus?.ios?.device?.name || 'iPhone / iPad'
          : 'Celulares por USB';
      return {
        kind: 'usb',
        title: usbName,
        badge: androidConnected || iosConnected ? 'USB Conectado' : 'USB #En espera',
        badgeTone: androidConnected || iosConnected ? 'bg-[#30D158] text-[#0B1710]' : 'bg-[#F5A623] text-[#17191E]',
        checkTitle: 'Inspección USB',
        checkTime: androidConnected || iosConnected ? 'Cable activo' : 'Sin cable',
        origin: androidConnected ? 'ADB local' : iosConnected ? 'Respaldo iOS' : 'Puerto USB',
        dest: androidConnected || iosConnected ? 'Listo para auditar' : 'Conectar cable',
        ctaLabel: 'Abrir guía USB',
        onPrimaryAction: () => onNavigate?.('equipo', { tab: iosConnected ? 'ios' : 'android' }),
      };
    }

    if (selectedNodeId === 'link') {
      return {
        kind: 'windows',
        title: 'Escudo de Enlaces',
        badge: lastLinkResult?.risk_level === 'HIGH' ? 'Riesgo Alto' : 'Pasivo #Cero HTTP',
        badgeTone:
          lastLinkResult?.risk_level === 'HIGH'
            ? 'bg-[#FF453A] text-white'
            : 'bg-[#F5A623] text-[#17191E]',
        checkTitle: 'Último enlace',
        checkTime: lastLinkResult ? 'Analizado' : 'En espera',
        origin: 'URL entrada',
        dest: lastLinkResult ? lastLinkResult.risk_level || 'Revisado' : 'Cruce STIX2',
        ctaLabel: showLinkInput ? 'Ocultar verificador' : 'Pegar y verificar enlace',
        onPrimaryAction: () => setShowLinkInput((v) => !v),
      };
    }

    return {
      kind: 'windows',
      title: 'Esta PC — Windows',
      badge: pcAlert
        ? `Alerta (${pcInfo.findingsCount})`
        : pcHealthy
          ? 'Verificado · 100%'
          : 'Host #Local',
      badgeTone: pcAlert
        ? 'bg-[#FF453A] text-white'
        : pcHealthy
          ? 'bg-[#22C55E] text-white'
          : 'bg-[#F5A623] text-[#17191E]',
      checkTitle: 'Último chequeo PC',
      checkTime: pcScannedAt ? `Hoy · ${pcScannedAt}` : 'Listo en RAM',
      origin: 'RAM + WMI',
      dest: pcAlert ? 'Revisar hallazgos' : pcHealthy ? 'Sin alertas' : 'Listo para escanear',
      ctaLabel: scanningPc
        ? 'Analizando procesos...'
        : isDesktop
          ? 'Analizar esta PC ahora'
          : 'Abrir inspector PC',
      onPrimaryAction: () => {
        if (isDesktop) {
          onRunPcScan?.();
        } else {
          onNavigate?.('equipo', { tab: 'pc' });
        }
      },
    };
  }, [
    selectedNodeId,
    androidConnected,
    iosConnected,
    usbStatus,
    lastLinkResult,
    showLinkInput,
    pcAlert,
    pcHealthy,
    pcInfo.findingsCount,
    pcScannedAt,
    scanningPc,
    isDesktop,
    onRunPcScan,
    onNavigate,
  ]);

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
      setInlineLink({ url: cleaned, verdict: 'error', error: err?.message || 'Error verificando enlace' });
    } finally {
      setLinkLoading(false);
    }
  }

  return (
    <aside
      aria-label="Panel inspector de protección"
      className={`roam-stone-sheet h-full flex flex-col min-h-0 overflow-y-auto px-5 sm:px-6 pb-6 ${
        isDesktop ? 'pt-11' : 'pt-5'
      }`}
    >
      {/* Cabecera superior blanca: Buscador + Campana Copiloto + Simple/Técnico */}
      <div className="flex items-center gap-2 shrink-0 min-w-0">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="flex-1 min-w-0 h-10 rounded-full bg-white border border-black/[0.06] px-3.5 flex items-center justify-between gap-2 text-left text-[13px] text-[#555B66] hover:text-[#17191E] shadow-[0_2px_8px_rgba(20,22,26,0.04)] cursor-pointer transition-colors"
        >
          <span className="inline-flex items-center gap-2 min-w-0 flex-1">
            <Search className="h-4 w-4 text-[#191C22] shrink-0" />
            <span className="truncate">Buscar CVE, dominio o módulo...</span>
          </span>
          <span className="font-tech hidden xl:inline rounded-full bg-[#EFEFE9] px-2 py-0.5 text-[10.5px] text-[#454A54] shrink-0">
            ⌘K
          </span>
        </button>

        {/* Botón circular Copiloto con insignia */}
        <button
          type="button"
          onClick={() => onOpenCopilot?.({})}
          aria-label="Abrir copiloto lateral"
          title="Abrir copiloto lateral (Ctrl+J)"
          className="relative h-10 w-10 rounded-full bg-white border border-black/[0.06] flex items-center justify-center text-[#191C22] hover:bg-[#F7F7F3] shadow-[0_2px_8px_rgba(20,22,26,0.04)] shrink-0 cursor-pointer"
        >
          <Bell className="h-4 w-4" />
          <span className="font-tech absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 rounded-full bg-[#191C22] text-white text-[9.5px] font-bold flex items-center justify-center">
            {pcAlert ? pcInfo.findingsCount : reportsCount}
          </span>
        </button>

        {/* Selector Simple / Técnico integrado en piedra cálida */}
        <div
          role="group"
          aria-label="Nivel de detalle"
          className="hidden sm:inline-flex items-center rounded-full bg-black/[0.07] p-0.5 h-9 shrink-0"
        >
          <button
            type="button"
            onClick={() => onToggleTechnicalMode?.(false)}
            className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-all cursor-pointer ${
              !technicalMode
                ? 'bg-white text-[#17191E] shadow-xs'
                : 'text-[#4B515C] hover:text-[#17191E]'
            }`}
          >
            Simple
          </button>
          <button
            type="button"
            onClick={() => onToggleTechnicalMode?.(true)}
            className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-all cursor-pointer ${
              technicalMode
                ? 'bg-white text-[#17191E] shadow-xs'
                : 'text-[#4B515C] hover:text-[#17191E]'
            }`}
          >
            Técnico
          </button>
        </div>
      </div>

      {/* Sección Foco del Sujeto Activo (Título + Etiqueta Ámbar + Hardware + Tarjeta Blanca Solapada) */}
      <section aria-label="Estado de protección en vivo" className="mt-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-[#17191E] leading-tight">
              {heroSubject.title}
            </h1>
            <span
              className={`mt-1.5 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${heroSubject.badgeTone}`}
            >
              {heroSubject.badge}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onNavigate?.('equipo', { tab: selectedNodeId === 'usb' ? 'android' : 'pc' })}
            aria-label="Abrir vista detallada de equipos"
            className="h-8 w-8 rounded-full bg-white/80 hover:bg-white border border-black/[0.06] inline-flex items-center justify-center text-[#191C22] cursor-pointer"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {/* Objeto limpio flotando directamente sobre #EAEAE6 */}
        <div className="mt-2 pt-1">
          <HardwareHeroGraphic
            subject={heroSubject.kind}
            healthy={pcHealthy}
            alert={pcAlert}
          />
        </div>

        {/* Tarjeta Blanca Solapada estilo Roam ("Last ride") */}
        <div className="roam-white-card rounded-[20px] p-4 -mt-5 relative z-10 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13.5px] font-semibold text-[#17191E]">
              {heroSubject.checkTitle}
            </span>
            <span className="font-tech rounded-full bg-[#EFEFE9] px-2.5 py-0.5 text-[11px] font-medium text-[#454A54]">
              {heroSubject.checkTime}
            </span>
          </div>

          {/* Línea de trayectoria con icono central */}
          <div className="flex items-center gap-2.5 py-1">
            <span className="text-[12px] font-medium text-[#454A54] shrink-0">
              {heroSubject.origin}
            </span>
            <div className="flex-1 flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${pcAlert ? 'bg-[#FF453A]' : pcHealthy ? 'bg-[#22C55E]' : 'bg-[#F5A623]'}`} />
              <div className={`h-[2px] flex-1 ${pcAlert ? 'bg-[#FF453A]/35' : pcHealthy ? 'bg-[#22C55E]/40' : 'bg-[#F5A623]/45'}`} />
              <span
                className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
                  pcAlert
                    ? 'bg-[#FEECEB] text-[#D92D20]'
                    : pcHealthy
                      ? 'bg-[#DCFCE7] text-[#15803D]'
                      : 'bg-[#FEF3DC] text-[#B56904]'
                }`}
              >
                {pcHealthy ? (
                  <ShieldCheck className="h-3.5 w-3.5" />
                ) : selectedNodeId === 'usb' ? (
                  <Smartphone className="h-3.5 w-3.5" />
                ) : (
                  <Laptop className="h-3.5 w-3.5" />
                )}
              </span>
              <div className={`h-[2px] flex-1 ${pcAlert ? 'bg-[#FF453A]/35' : pcHealthy ? 'bg-[#22C55E]/40' : 'bg-[#F5A623]/45'}`} />
              <span className={`h-2 w-2 rounded-full ${pcAlert ? 'bg-[#FF453A]' : pcHealthy ? 'bg-[#22C55E]' : 'bg-[#F5A623]'}`} />
            </div>
            <span className="text-[12px] font-semibold text-[#17191E] shrink-0">
              {heroSubject.dest}
            </span>
          </div>

          {technicalMode && pcAudit && (
            <div className="font-tech rounded-[10px] bg-[#F4F4F0] px-2.5 py-1.5 text-[11px] text-[#353942]">
              verdict={pcInfo.verdict || 'clean'} · yara={pcInfo.yaraHits} · sockets={pcInfo.sockets}
            </div>
          )}

          {/* Controles primarios dentro de la tarjeta blanca */}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={heroSubject.onPrimaryAction}
              disabled={scanningPc}
              className="flex-1 min-w-[168px] h-10 rounded-full bg-[#191C22] hover:bg-[#262B34] text-white px-4 text-[12.5px] font-medium inline-flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-60"
            >
              {scanningPc && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{heroSubject.ctaLabel}</span>
            </button>

            {pcAudit ? (
              <button
                type="button"
                onClick={() => onNavigate?.('equipo', { tab: 'pc' })}
                className="h-10 rounded-full bg-[#EFEFE9] hover:bg-[#E4E4DD] text-[#17191E] px-3.5 text-[12px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>Ver informe</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowLinkInput((v) => !v)}
                className="h-10 rounded-full bg-[#EFEFE9] hover:bg-[#E4E4DD] text-[#17191E] px-3.5 text-[12px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Link2 className="h-3.5 w-3.5" />
                <span>Enlace</span>
              </button>
            )}
          </div>

          {/* Verificador rápido de enlace desplegable dentro de la tarjeta blanca */}
          {(showLinkInput || inlineLink) && (
            <form onSubmit={handleQuickLinkSubmit} className="pt-2 border-t border-black/[0.06] space-y-2">
              <div className="flex gap-1.5">
                <input
                  type="url"
                  value={quickUrl}
                  onChange={(e) => setQuickUrl(e.target.value)}
                  placeholder="Pega URL sospechosa para revisar..."
                  aria-label="Enlace sospechoso para verificar"
                  className="flex-1 min-w-0 h-8 rounded-full bg-[#F4F4F0] border border-black/[0.08] px-3 text-[12px] text-[#17191E] placeholder:text-[#5C626E] focus:outline-none focus:border-[#191C22]"
                />
                <button
                  type="submit"
                  disabled={linkLoading || !quickUrl.trim()}
                  className="h-8 rounded-full bg-[#F5A623] hover:bg-[#EAA020] disabled:bg-[#E2E2DC] disabled:text-[#656B76] px-3 text-[11.5px] font-semibold text-[#17191E] cursor-pointer"
                >
                  {linkLoading ? '...' : 'Verificar'}
                </button>
              </div>
              {inlineLink && (
                <div className="rounded-[10px] bg-[#191C22] text-white px-3 py-2 flex items-center justify-between gap-2 text-[11.5px]">
                  <span className="truncate">
                    {inlineLink.error || `${inlineLink.verdict || 'Revisado'}`}
                  </span>
                  {!inlineLink.error && (
                    <button
                      type="button"
                      onClick={() => onNavigate?.('enlace', { url: inlineLink.url })}
                      className="text-[#F5A623] font-medium shrink-0 cursor-pointer"
                    >
                      Detalle →
                    </button>
                  )}
                </div>
              )}
            </form>
          )}
        </div>
      </section>

      {/* Tiras Oscuras Invertidas inferiores ("Últimos análisis", estilo Latest journeys) */}
      <section aria-label="Últimos análisis locales" className="mt-6 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[16px] font-semibold tracking-[-0.015em] text-[#17191E]">
              Últimos análisis
            </h2>
            <span className="font-tech text-[12px] text-[#555B66]">
              {apiOnline ? 'RAM' : 'Offline'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onNavigate?.('equipo', { tab: pcAudit ? 'pc' : 'android' })}
            className="rounded-full bg-white border border-black/[0.06] hover:bg-[#F7F7F3] px-3 py-1 text-[11.5px] font-medium text-[#17191E] shadow-xs cursor-pointer"
          >
            Ver todo
          </button>
        </div>

        {/* Tira Oscura 1: PC Windows */}
        <button
          type="button"
          onClick={() => onNavigate?.('equipo', { tab: 'pc' })}
          className="roam-dark-strip w-full rounded-[16px] p-3.5 text-left relative overflow-hidden cursor-pointer hover:brightness-110 transition-all"
        >
          <div className="flex items-center justify-between text-[11px] text-[#A2AAB7]">
            <span className="font-tech">{pcScannedAt ? `Hoy · ${pcScannedAt}` : 'Pendiente'}</span>
            <span className="font-tech">
              {technicalMode ? `${pcInfo.sockets} sockets · ${pcInfo.yaraHits} YARA` : 'PC Windows'}
            </span>
            <span className={pcAlert ? 'text-[#FF7A73]' : 'text-[#5EE07E]'}>
              {pcAudit ? (pcAlert ? 'Revisar' : 'Limpio') : 'Listo'}
            </span>
          </div>

          <div className="mt-2 flex items-center gap-2 text-[12px]">
            <span className="font-medium text-[#F4F6FA] shrink-0">RAM + WMI</span>
            <div className="flex-1 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#F5A623]" />
              <div className="h-px flex-1 border-t border-dashed border-[#F5A623]/60" />
              <Laptop className="h-3.5 w-3.5 text-[#F5A623] shrink-0" />
              <div className="h-px flex-1 border-t border-dashed border-[#F5A623]/60" />
              <span className="h-1.5 w-1.5 rounded-full bg-[#30D158]" />
            </div>
            <span className="font-tech font-medium text-[#F4F6FA] shrink-0">
              {pcAudit ? `${pcInfo.findingsCount} hallazgos` : 'Auditar'}
            </span>
          </div>
        </button>

        {/* Tira Oscura 2: Celulares USB / Corpus STIX */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onNavigate?.('equipo', { tab: iosConnected ? 'ios' : 'android' })}
            className="roam-dark-strip rounded-[15px] p-3 text-left cursor-pointer hover:brightness-110 transition-all"
          >
            <div className="flex items-center justify-between text-[11px] text-[#A2AAB7]">
              <span className="font-tech">USB Móvil</span>
              <Smartphone className="h-3.5 w-3.5 text-[#F5A623]" />
            </div>
            <div className="mt-1.5 text-[12.5px] font-medium text-[#F4F6FA] truncate">
              {androidConnected
                ? usbStatus?.android?.model || 'Android conectado'
                : iosConnected
                  ? 'iPhone / iPad USB'
                  : 'Conectar Android o iPhone'}
            </div>
          </button>

          <button
            type="button"
            onClick={onSyncStix}
            disabled={syncingStix}
            className="roam-dark-strip rounded-[15px] p-3 text-left cursor-pointer hover:brightness-110 transition-all disabled:opacity-65"
          >
            <div className="flex items-center justify-between text-[11px] text-[#A2AAB7]">
              <span className="font-tech">Firmas STIX2</span>
              <Database className="h-3.5 w-3.5 text-[#5E9BFF]" />
            </div>
            <div className="mt-1.5 text-[12.5px] font-medium text-[#F4F6FA] truncate">
              {syncingStix ? 'Sincronizando...' : `${iocsCount.toLocaleString('en-US')} IOCs activos`}
            </div>
          </button>
        </div>
      </section>
    </aside>
  );
}
