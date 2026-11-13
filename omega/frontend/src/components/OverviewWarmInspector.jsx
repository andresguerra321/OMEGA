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
  const ledColor = alert ? '#DC2626' : healthy ? '#16A34A' : '#2563EB';
  const haloFill = alert
    ? 'rgba(220,38,38,0.14)'
    : healthy
      ? 'rgba(22,163,74,0.12)'
      : 'rgba(37,99,235,0.16)';

  if (subject === 'usb') {
    return (
      <svg
        width="164"
        height="118"
        viewBox="0 0 168 124"
        aria-hidden="true"
        className="mx-auto drop-shadow-[0_14px_22px_rgba(9,13,22,0.16)]"
      >
        <rect x="46" y="8" width="76" height="106" rx="16" fill="#0B101B" stroke="#1E293B" strokeWidth="1.2" />
        <rect x="52" y="14" width="64" height="94" rx="11" fill="#070A12" />
        <rect x="74" y="19" width="20" height="3.5" rx="1.75" fill="#2563EB" opacity="0.7" />
        <circle cx="84" cy="52" r="15" fill={haloFill} stroke={ledColor} strokeWidth="2.2" />
        <circle cx="84" cy="52" r="4.5" fill={ledColor} />
        <line x1="66" y1="81" x2="102" y2="81" stroke="#334155" strokeWidth="2.8" strokeLinecap="round" />
        <line x1="72" y1="90" x2="96" y2="90" stroke="#1E293B" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }

  if (subject === 'link') {
    return (
      <svg
        width="188"
        height="118"
        viewBox="0 0 196 124"
        aria-hidden="true"
        className="mx-auto drop-shadow-[0_14px_22px_rgba(9,13,22,0.14)]"
      >
        <rect x="28" y="20" width="140" height="78" rx="16" fill="#0B101B" stroke="#1E293B" strokeWidth="1.2" />
        <rect x="33" y="25" width="130" height="68" rx="12" fill="#070A12" />
        <line x1="64" y1="59" x2="132" y2="59" stroke="#1E3A8A" strokeWidth="2" strokeDasharray="4 4" />
        <rect x="48" y="45" width="32" height="28" rx="8" fill="#111827" stroke="#334155" strokeWidth="1.4" />
        <rect x="116" y="45" width="32" height="28" rx="8" fill="#111827" stroke="#334155" strokeWidth="1.4" />
        <circle cx="98" cy="59" r="13.5" fill="#0B1220" stroke={ledColor} strokeWidth="2.2" />
        <circle cx="98" cy="59" r="4" fill={ledColor} />
      </svg>
    );
  }

  if (subject === 'corpus') {
    return (
      <svg
        width="174"
        height="118"
        viewBox="0 0 180 124"
        aria-hidden="true"
        className="mx-auto drop-shadow-[0_14px_22px_rgba(9,13,22,0.15)]"
      >
        <path
          d="M90 12L142 30V61C142 88 119 106 90 115C61 106 38 88 38 61V30L90 12Z"
          fill="#0B101B"
          stroke="#1E293B"
          strokeWidth="1.2"
        />
        <path
          d="M90 19L135 34.5V60.5C135 83.5 115 99 90 107C65 99 45 83.5 45 60.5V34.5L90 19Z"
          fill="#070A12"
          stroke="#1E3A8A"
          strokeWidth="1.2"
        />
        <circle cx="90" cy="59" r="17" fill={haloFill} stroke={ledColor} strokeWidth="2.2" />
        <circle cx="90" cy="59" r="4.5" fill={ledColor} />
      </svg>
    );
  }

  // Vista cenital minimalista del chasis portátil en negro mate, blanco y azul rey
  return (
    <svg
      width="204"
      height="110"
      viewBox="0 0 220 126"
      aria-hidden="true"
      className="mx-auto drop-shadow-[0_14px_20px_rgba(9,13,22,0.16)]"
    >
      <rect x="30" y="14" width="160" height="98" rx="14" fill="#0B101B" stroke="#1E293B" strokeWidth="1.2" />
      <rect x="34" y="18" width="152" height="90" rx="11" fill="#070A12" />
      {/* Bisagra sutil azul rey integrada al chasis */}
      <rect x="78" y="12.5" width="64" height="3.5" rx="1.75" fill="#2563EB" />
      {/* Matriz teclado limpia */}
      <rect x="48" y="28" width="124" height="39" rx="6" fill="#0F1625" stroke="#1E293B" strokeWidth="0.9" />
      {[0, 1, 2].map((row) => (
        <g key={row} fill="#1E293B">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((col) => (
            <rect
              key={`${row}-${col}`}
              x={54 + col * 12.6}
              y={33 + row * 10}
              width="9.5"
              height="6.8"
              rx="1.6"
            />
          ))}
        </g>
      ))}
      <rect x="82" y="74" width="56" height="25" rx="5" fill="#0E1422" stroke="#1E293B" strokeWidth="1" />
      <circle cx="110" cy="22" r="2.8" fill={ledColor} />
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

  // Sujeto principal dinámico según la superficie seleccionada en el panel izquierdo
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
        badge: androidConnected || iosConnected ? 'USB Conectado' : 'USB en espera',
        badgeTone:
          androidConnected || iosConnected
            ? 'bg-[#DCFCE7] text-[#14532D] border border-[#16A34A]/25'
            : 'bg-[#E8F0FE] text-[#1D4ED8] border border-[#2563EB]/25',
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
        kind: 'link',
        title: 'Escudo de Enlaces',
        badge: lastLinkResult?.risk_level === 'HIGH' ? 'Riesgo Alto' : 'Pasivo · Cero HTTP',
        badgeTone:
          lastLinkResult?.risk_level === 'HIGH'
            ? 'bg-[#B91C1C] text-white'
            : 'bg-[#E8F0FE] text-[#1D4ED8] border border-[#2563EB]/25',
        checkTitle: 'Último enlace',
        checkTime: lastLinkResult ? 'Analizado' : 'En espera',
        origin: 'URL entrada',
        dest: lastLinkResult ? lastLinkResult.risk_level || 'Revisado' : 'Cruce STIX2',
        ctaLabel: showLinkInput ? 'Ocultar verificador' : 'Pegar y verificar enlace',
        onPrimaryAction: () => setShowLinkInput((v) => !v),
      };
    }

    if (selectedNodeId === 'corpus') {
      return {
        kind: 'corpus',
        title: 'Base Forense STIX2',
        badge: apiOnline ? 'Motor Local Activo' : 'Sin conexión API',
        badgeTone: apiOnline
          ? 'bg-[#DCFCE7] text-[#14532D] border border-[#16A34A]/25'
          : 'bg-[#E8F0FE] text-[#1D4ED8] border border-[#2563EB]/25',
        checkTitle: 'Corpus e indicadores',
        checkTime: `${reportsCount} reportes`,
        origin: 'STIX 2.1',
        dest: `${iocsCount.toLocaleString('en-US')} firmas`,
        ctaLabel: syncingStix ? 'Sincronizando STIX2...' : 'Actualizar firmas STIX2',
        onPrimaryAction: () => onSyncStix?.(),
      };
    }

    return {
      kind: 'windows',
      title: 'Esta PC — Windows',
      badge: pcAlert
        ? `Alerta (${pcInfo.findingsCount})`
        : pcHealthy
          ? 'Verificado · 100%'
          : 'Host local · RAM',
      badgeTone: pcAlert
        ? 'bg-[#B91C1C] text-white'
        : pcHealthy
          ? 'bg-[#DCFCE7] text-[#14532D] border border-[#16A34A]/25'
          : 'bg-[#E8F0FE] text-[#1D4ED8] border border-[#2563EB]/25',
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
    apiOnline,
    reportsCount,
    iocsCount,
    syncingStix,
    onSyncStix,
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
      className={`roam-stone-sheet h-full flex flex-col min-h-0 overflow-y-auto px-5 sm:px-6 pb-4 ${
        isDesktop ? 'pt-10' : 'pt-4'
      }`}
    >
      {/* Cabecera superior limpia: Buscador + Campana Copiloto en Azul Rey + Simple/Técnico */}
      <div className="flex items-center gap-2 shrink-0 min-w-0">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="flex-1 min-w-0 h-10 rounded-full bg-white border border-[#0B1220]/10 px-3.5 flex items-center justify-between gap-2 text-left text-[13px] text-[#475569] hover:text-[#090D16] hover:border-[#1D4ED8]/30 shadow-[0_2px_8px_rgba(9,13,22,0.04)] cursor-pointer transition-colors"
        >
          <span className="inline-flex items-center gap-2 min-w-0 flex-1">
            <Search className="h-4 w-4 text-[#090D16] shrink-0" />
            <span className="truncate">Buscar CVE, dominio o módulo...</span>
          </span>
          <span className="font-tech hidden xl:inline rounded-full bg-[#EDF2FA] px-2 py-0.5 text-[10.5px] text-[#1E3A8A] shrink-0">
            ⌘K
          </span>
        </button>

        {/* Botón circular Copiloto con insignia en Azul Rey */}
        <button
          type="button"
          onClick={() => onOpenCopilot?.({})}
          aria-label="Abrir copiloto lateral"
          title="Abrir copiloto lateral (Ctrl+J)"
          className="relative h-10 w-10 rounded-full bg-white border border-[#0B1220]/10 flex items-center justify-center text-[#090D16] hover:border-[#1D4ED8]/35 hover:bg-[#F8FAFF] shadow-[0_2px_8px_rgba(9,13,22,0.04)] shrink-0 cursor-pointer transition-colors"
        >
          <Bell className="h-4 w-4" />
          <span className="font-tech absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 rounded-full bg-[#1D4ED8] text-white text-[9.5px] font-bold flex items-center justify-center">
            {pcAlert ? pcInfo.findingsCount : reportsCount}
          </span>
        </button>

        {/* Selector Simple / Técnico */}
        <div
          role="group"
          aria-label="Nivel de detalle"
          className="hidden sm:inline-flex items-center rounded-full bg-[#E5EAF4] p-0.5 h-9 shrink-0"
        >
          <button
            type="button"
            onClick={() => onToggleTechnicalMode?.(false)}
            className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-all cursor-pointer ${
              !technicalMode
                ? 'bg-white text-[#090D16] shadow-xs'
                : 'text-[#475569] hover:text-[#090D16]'
            }`}
          >
            Simple
          </button>
          <button
            type="button"
            onClick={() => onToggleTechnicalMode?.(true)}
            className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-all cursor-pointer ${
              technicalMode
                ? 'bg-white text-[#090D16] shadow-xs'
                : 'text-[#475569] hover:text-[#090D16]'
            }`}
          >
            Técnico
          </button>
        </div>
      </div>

      {/* Sección Foco del Sujeto Activo */}
      <section aria-label="Estado de protección en vivo" className="mt-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-[#090D16] leading-tight">
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
            onClick={() => {
              if (selectedNodeId === 'link') onNavigate?.('enlace');
              else if (selectedNodeId === 'corpus') onNavigate?.('amenazas');
              else onNavigate?.('equipo', { tab: selectedNodeId === 'usb' ? (iosConnected ? 'ios' : 'android') : 'pc' });
            }}
            aria-label="Abrir vista detallada de la superficie seleccionada"
            className="h-8 w-8 rounded-full bg-white hover:bg-[#EDF2FA] border border-[#0B1220]/10 inline-flex items-center justify-center text-[#090D16] hover:text-[#1D4ED8] cursor-pointer transition-colors"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {/* Objeto limpio flotando directamente sobre la hoja blanca arquitectónica */}
        <div className="mt-2 pt-1">
          <HardwareHeroGraphic
            subject={heroSubject.kind}
            healthy={pcHealthy}
            alert={pcAlert}
          />
        </div>

        {/* Tarjeta Blanca Estructurada (Negro · Blanco · Azul Rey) */}
        <div className="roam-white-card rounded-[20px] p-4 -mt-4 relative z-10 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13.5px] font-semibold text-[#090D16]">
              {heroSubject.checkTitle}
            </span>
            <span className="font-tech rounded-full bg-[#EEF2FA] px-2.5 py-0.5 text-[11px] font-medium text-[#1E3A8A]">
              {heroSubject.checkTime}
            </span>
          </div>

          {/* Celdas claras de lectura y estado (sin líneas heredadas ni relleno ámbar) */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[12px] bg-[#F5F7FC] border border-[#0B1220]/[0.06] px-3 py-2 flex items-center gap-2.5 min-w-0">
              <span
                className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
                  pcAlert
                    ? 'bg-[#FEE2E2] text-[#B91C1C]'
                    : pcHealthy
                      ? 'bg-[#DCFCE7] text-[#15803D]'
                      : 'bg-[#E8F0FE] text-[#1D4ED8]'
                }`}
              >
                {selectedNodeId === 'link' ? (
                  <Link2 className="h-3.5 w-3.5" />
                ) : selectedNodeId === 'corpus' ? (
                  <Database className="h-3.5 w-3.5" />
                ) : pcHealthy ? (
                  <ShieldCheck className="h-3.5 w-3.5" />
                ) : selectedNodeId === 'usb' ? (
                  <Smartphone className="h-3.5 w-3.5" />
                ) : (
                  <Laptop className="h-3.5 w-3.5" />
                )}
              </span>
              <div className="min-w-0">
                <div className="text-[10.5px] uppercase tracking-[0.06em] text-[#64748B] font-medium">
                  Superficie
                </div>
                <div className="text-[12.5px] font-semibold text-[#090D16] truncate">
                  {heroSubject.origin}
                </div>
              </div>
            </div>

            <div className="rounded-[12px] bg-[#F5F7FC] border border-[#0B1220]/[0.06] px-3 py-2 min-w-0">
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-[#64748B] font-medium">
                Estado actual
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full shrink-0 ${
                    pcAlert ? 'bg-[#DC2626]' : pcHealthy ? 'bg-[#16A34A]' : 'bg-[#2563EB]'
                  }`}
                />
                <span className="text-[12.5px] font-semibold text-[#090D16] truncate">
                  {heroSubject.dest}
                </span>
              </div>
            </div>
          </div>

          {technicalMode && pcAudit && (
            <div className="font-tech rounded-[10px] bg-[#F1F5FB] border border-[#1D4ED8]/15 px-2.5 py-1.5 text-[11px] text-[#1E3A8A]">
              verdict={pcInfo.verdict || 'clean'} · yara={pcInfo.yaraHits} · sockets={pcInfo.sockets}
            </div>
          )}

          {/* Controles primarios en Azul Rey + Neutro frío */}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={heroSubject.onPrimaryAction}
              disabled={scanningPc}
              className="flex-1 min-w-[168px] h-10 rounded-full bg-[#1D4ED8] hover:bg-[#1E40AF] text-white px-4 text-[12.5px] font-medium inline-flex items-center justify-center gap-2 shadow-[0_8px_20px_rgba(29,78,216,0.26)] cursor-pointer transition-colors disabled:opacity-60"
            >
              {scanningPc && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{heroSubject.ctaLabel}</span>
            </button>

            {pcAudit ? (
              <button
                type="button"
                onClick={() => onNavigate?.('equipo', { tab: 'pc' })}
                className="h-10 rounded-full bg-[#EDF2FA] hover:bg-[#E0E8F6] border border-[#1D4ED8]/15 text-[#090D16] px-3.5 text-[12px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>Ver informe</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowLinkInput((v) => !v)}
                className="h-10 rounded-full bg-[#EDF2FA] hover:bg-[#E0E8F6] border border-[#1D4ED8]/15 text-[#090D16] px-3.5 text-[12px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Link2 className="h-3.5 w-3.5 text-[#1D4ED8]" />
                <span>Enlace</span>
              </button>
            )}
          </div>

          {/* Verificador rápido de enlace desplegable */}
          {(showLinkInput || inlineLink) && (
            <form onSubmit={handleQuickLinkSubmit} className="pt-2 border-t border-[#0B1220]/[0.07] space-y-2">
              <div className="flex gap-1.5">
                <input
                  type="url"
                  value={quickUrl}
                  onChange={(e) => setQuickUrl(e.target.value)}
                  placeholder="Pega URL sospechosa para revisar..."
                  aria-label="Enlace sospechoso para verificar"
                  className="flex-1 min-w-0 h-8 rounded-full bg-[#F5F7FC] border border-[#0B1220]/12 px-3 text-[12px] text-[#090D16] placeholder:text-[#64748B] focus:outline-none focus:border-[#1D4ED8]"
                />
                <button
                  type="submit"
                  disabled={linkLoading || !quickUrl.trim()}
                  className="h-8 rounded-full bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:bg-[#E2E8F0] disabled:text-[#64748B] px-3 text-[11.5px] font-semibold text-white cursor-pointer transition-colors"
                >
                  {linkLoading ? '...' : 'Verificar'}
                </button>
              </div>
              {inlineLink && (
                <div className="rounded-[10px] bg-[#090D16] text-white px-3 py-2 flex items-center justify-between gap-2 text-[11.5px]">
                  <span className="truncate">
                    {inlineLink.error || `${inlineLink.verdict || 'Revisado'}`}
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
              )}
            </form>
          )}
        </div>
      </section>

      {/* Bloque Inferior de Contraste Oscuro ("Últimos análisis" en Negro · Blanco · Azul Rey) */}
      <section aria-label="Últimos análisis locales" className="mt-4 flex-1 flex flex-col justify-between gap-2.5">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[15.5px] font-semibold tracking-[-0.015em] text-[#090D16]">
                Últimos análisis
              </h2>
              <span className="font-tech text-[11.5px] text-[#475569]">
                {apiOnline ? 'RAM' : 'Offline'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => onNavigate?.('equipo', { tab: pcAudit ? 'pc' : 'android' })}
              className="rounded-full bg-white border border-[#0B1220]/10 hover:border-[#1D4ED8]/30 hover:bg-[#F8FAFF] px-3 py-1 text-[11.5px] font-medium text-[#090D16] shadow-xs cursor-pointer transition-colors"
            >
              Ver todo
            </button>
          </div>

          {/* Tarjeta oscura principal: PC Windows (limpia, sin líneas punteadas heredadas) */}
          <button
            type="button"
            onClick={() => onNavigate?.('equipo', { tab: 'pc' })}
            className="roam-dark-strip w-full rounded-[16px] p-3.5 text-left relative overflow-hidden cursor-pointer hover:brightness-110 transition-all flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="h-9 w-9 rounded-[11px] bg-[#1D4ED8]/20 border border-[#3B82F6]/30 text-[#60A5FA] flex items-center justify-center shrink-0">
                <Laptop className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-white truncate">
                  PC Windows · RAM y WMI
                </div>
                <div className="font-tech text-[11px] text-[#94A3B8] truncate">
                  {technicalMode
                    ? `${pcInfo.sockets} sockets · ${pcInfo.yaraHits} hits YARA`
                    : pcScannedAt
                      ? `Última lectura ${pcScannedAt}`
                      : 'Procesos, persistencia y red local'}
                </div>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                  pcAlert
                    ? 'bg-[#DC2626]/20 text-[#FCA5A5]'
                    : pcHealthy
                      ? 'bg-[#16A34A]/20 text-[#86EFAC]'
                      : 'bg-[#1D4ED8]/25 text-[#93C5FD]'
                }`}
              >
                {pcAudit ? (pcAlert ? 'Revisar' : 'Limpio') : 'Listo'}
              </span>
              <div className="mt-1 font-tech text-[11px] text-[#CBD5E1]">
                {pcAudit ? `${pcInfo.findingsCount} hallazgos` : 'Auditar →'}
              </div>
            </div>
          </button>

          {/* Fila dual simétrica: USB Móvil y Corpus STIX2 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onNavigate?.('equipo', { tab: iosConnected ? 'ios' : 'android' })}
              className="roam-dark-strip rounded-[15px] p-3 text-left cursor-pointer hover:brightness-110 transition-all"
            >
              <div className="flex items-center justify-between text-[11px] text-[#94A3B8]">
                <span className="font-tech">USB Móvil</span>
                <Smartphone className="h-3.5 w-3.5 text-[#60A5FA]" />
              </div>
              <div className="mt-1.5 text-[12.5px] font-medium text-white truncate">
                {androidConnected
                  ? usbStatus?.android?.model || 'Android conectado'
                  : iosConnected
                    ? 'iPhone / iPad USB'
                    : 'Android o iPhone USB'}
              </div>
            </button>

            <button
              type="button"
              onClick={onSyncStix}
              disabled={syncingStix}
              className="roam-dark-strip rounded-[15px] p-3 text-left cursor-pointer hover:brightness-110 transition-all disabled:opacity-65"
            >
              <div className="flex items-center justify-between text-[11px] text-[#94A3B8]">
                <span className="font-tech">Firmas STIX2</span>
                <Database className="h-3.5 w-3.5 text-[#60A5FA]" />
              </div>
              <div className="mt-1.5 text-[12.5px] font-medium text-white truncate">
                {syncingStix ? 'Sincronizando...' : `${iocsCount.toLocaleString('en-US')} IOCs activos`}
              </div>
            </button>
          </div>

          {/* Tira compacta de Escudo Web Pasivo */}
          <button
            type="button"
            onClick={() => onNavigate?.('enlace')}
            className="roam-dark-strip w-full rounded-[14px] px-3.5 py-2.5 text-left cursor-pointer hover:brightness-110 transition-all flex items-center justify-between gap-2"
          >
            <span className="inline-flex items-center gap-2.5 min-w-0">
              <Link2 className="h-3.5 w-3.5 text-[#60A5FA] shrink-0" />
              <span className="text-[12.5px] font-medium text-white truncate">
                Verificador pasivo de enlaces
              </span>
            </span>
            <span className="font-tech text-[11px] text-[#93C5FD] shrink-0">
              {lastLinkResult?.risk_level || 'Cero HTTP →'}
            </span>
          </button>
        </div>

        <div className="pt-1 border-t border-[#0B1220]/[0.07] flex items-center justify-between text-[11px] text-[#475569]">
          <span className="font-tech">Entorno volátil · Sin escritura en disco</span>
          <button
            type="button"
            onClick={() => onOpenCopilot?.({})}
            className="font-medium text-[#1D4ED8] hover:text-[#1E40AF] cursor-pointer transition-colors"
          >
            Consultar Copiloto →
          </button>
        </div>
      </section>
    </aside>
  );
}
