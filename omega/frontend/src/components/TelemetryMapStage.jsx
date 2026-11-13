import { useMemo, useState } from 'react';
import {
  Crosshair,
  Database,
  Laptop,
  Layers,
  Link2,
  Minus,
  Navigation,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-react';
import { OmegaLogo } from './OmegaLogo';
import { SpatialNavPill } from './SpatialNavPill';

function buildNodes({
  pcAudit,
  pcScannedAt,
  usbStatus,
  lastLinkResult,
  govStats,
  technicalMode,
}) {
  const reportsCount = Number(govStats?.corpus_stats?.reports ?? 16);
  const iocsCount = Number(govStats?.corpus_stats?.iocs ?? 4896);
  const campaignsCount = Number(govStats?.corpus_stats?.campaigns ?? 19);

  const pcCode = String(
    pcAudit?.triage?.diagnosis?.verdict_code || pcAudit?.verdict || '',
  ).toLowerCase();
  const pcAlerts =
    Number(pcAudit?.triage?.total_matches ?? 0) +
    Number(pcAudit?.yara_hits?.length ?? 0) +
    Number(pcAudit?.behavioral_anomalies?.length ?? 0);
  const pcSockets = Number(pcAudit?.live_sockets_total ?? 0);
  const pcHealthy = pcAudit && (pcCode === 'clean' || pcCode === 'low' || pcAlerts === 0);
  const pcWarn = pcAudit && !pcHealthy;

  const androidOk = Boolean(usbStatus?.android?.connected);
  const iosOk = Boolean(usbStatus?.ios?.connected);
  const usbAny = androidOk || iosOk;
  const usbTitle = androidOk
    ? usbStatus?.android?.model || 'Android USB'
    : iosOk
      ? usbStatus?.ios?.device?.name || 'iPhone USB'
      : 'Celular por USB';

  const linkVerdict = String(
    lastLinkResult?.risk_level || lastLinkResult?.verdict || '',
  ).toLowerCase();

  return [
    {
      id: 'windows',
      tag: '#01 Esta PC · Windows',
      shortBadge: pcAudit ? (pcWarn ? '!' : 'OK') : 'PC',
      x: 36,
      y: 34,
      icon: Laptop,
      tone: pcWarn ? 'alert' : pcHealthy ? 'clean' : 'amber',
      statusText: pcAudit
        ? pcWarn
          ? 'Revisar'
          : 'Verificado'
        : 'Listo RAM',
      metricA: technicalMode ? `${pcSockets} sockets` : pcScannedAt ? `Hora ${pcScannedAt}` : 'Sin lectura previa',
      metricB: technicalMode ? `${pcAlerts} hits YARA` : pcAudit ? `${pcAlerts} alertas` : 'Lectura local',
      sparkPoints: pcAudit ? [16, 12, 10, 6, 4] : [14, 15, 13, 14, 12],
      ctaLabel: pcAudit ? 'Abrir informe' : 'Analizar PC ahora',
      targetNav: pcAudit ? 'equipo' : null,
      targetTab: 'pc',
    },
    {
      id: 'usb',
      tag: `#02 ${usbTitle}`,
      shortBadge: usbAny ? '1' : 'USB',
      x: 74,
      y: 41,
      icon: Smartphone,
      tone: usbAny ? 'cobalt' : 'neutral',
      statusText: usbAny ? 'Conectado' : 'En espera',
      metricA: androidOk ? 'ADB listo' : iosOk ? 'Lockdown iOS' : 'Sin cable',
      metricB: usbAny ? 'Listo auditoría' : 'Android / iPhone',
      sparkPoints: usbAny ? [18, 12, 8, 5, 3] : [14, 14, 14, 14, 14],
      ctaLabel: 'Abrir guía USB',
      targetNav: 'equipo',
      targetTab: iosOk ? 'ios' : 'android',
    },
    {
      id: 'link',
      tag: '#03 Escudo de Enlaces',
      shortBadge: linkVerdict === 'high' ? '!' : lastLinkResult ? 'URL' : 'WEB',
      x: 24,
      y: 63,
      icon: Link2,
      tone: linkVerdict === 'high' ? 'alert' : linkVerdict === 'safe' ? 'clean' : 'amber',
      statusText: lastLinkResult
        ? linkVerdict === 'high'
          ? 'Peligroso'
          : 'Revisado'
        : 'Pasivo',
      metricA: lastLinkResult?.host || 'Sin HTTP remoto',
      metricB: lastLinkResult?.risk_level || 'Cero huella',
      sparkPoints: [16, 14, 10, 9, 6],
      ctaLabel: 'Verificar enlace',
      targetNav: 'enlace',
    },
    {
      id: 'corpus',
      tag: '#04 Base STIX2 + YARA',
      shortBadge: `${reportsCount}`,
      x: 75,
      y: 67,
      icon: Database,
      tone: 'clean',
      statusText: 'Indexado',
      metricA: `${reportsCount} reportes`,
      metricB: `${iocsCount.toLocaleString('en-US')} firmas`,
      sparkPoints: [18, 15, 11, 7, 4],
      ctaLabel: 'Sincronizar feeds',
      targetNav: null,
    },
    {
      id: 'campaigns',
      tag: '#05 Campañas CTI',
      shortBadge: `${campaignsCount}`,
      x: 59,
      y: 25,
      icon: Layers,
      tone: 'neutral',
      statusText: 'Activo',
      metricA: `${campaignsCount} campañas`,
      metricB: 'Citizen Lab · TAG',
      sparkPoints: [15, 11, 13, 8, 5],
      ctaLabel: 'Explorar dossiers',
      targetNav: 'amenazas',
    },
  ];
}

function toneStyles(tone) {
  if (tone === 'clean') {
    return {
      pill: 'bg-[#E7F8EE] text-[#126B37]',
      dot: 'bg-[#30D158]',
      badge: 'bg-[#30D158] text-[#0B1710]',
      line: '#30D158',
    };
  }
  if (tone === 'alert') {
    return {
      pill: 'bg-[#FEECEB] text-[#B42318]',
      dot: 'bg-[#FF453A]',
      badge: 'bg-[#FF453A] text-white',
      line: '#FF453A',
    };
  }
  if (tone === 'cobalt') {
    return {
      pill: 'bg-[#E7F0FE] text-[#1D4ED8]',
      dot: 'bg-[#2F6FED]',
      badge: 'bg-[#5E9BFF] text-[#091221]',
      line: '#5E9BFF',
    };
  }
  if (tone === 'amber') {
    return {
      pill: 'bg-[#FEF3DC] text-[#9A5B04]',
      dot: 'bg-[#F5A623]',
      badge: 'bg-[#F5A623] text-[#17191E]',
      line: '#F5A623',
    };
  }
  return {
    pill: 'bg-[#EFEFE9] text-[#454A54]',
    dot: 'bg-[#8E939E]',
    badge: 'bg-[#F5A623] text-[#17191E]',
    line: '#F5A623',
  };
}

export function TelemetryMapStage({
  activeNav,
  onSelectNav,
  isCompactRail = false,
  selectedNodeId,
  onSelectNode,
  pcAudit,
  pcScannedAt,
  usbStatus,
  lastLinkResult,
  govStats,
  technicalMode = false,
  apiOnline = true,
  isLoadingChat = false,
  scanningPc = false,
  syncingStix = false,
  onRunPcScan,
  onSyncStix,
  onOpenCopilot,
  onOpenCommandPalette,
  onNavigate,
}) {
  const [zoom, setZoom] = useState(1);
  const [popoverOpen, setPopoverOpen] = useState(true);

  const nodes = useMemo(
    () =>
      buildNodes({
        pcAudit,
        pcScannedAt,
        usbStatus,
        lastLinkResult,
        govStats,
        technicalMode,
      }),
    [pcAudit, pcScannedAt, usbStatus, lastLinkResult, govStats, technicalMode],
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || nodes[0],
    [nodes, selectedNodeId],
  );

  const reportsCount = Number(govStats?.corpus_stats?.reports ?? 16);
  const iocsCount = Number(govStats?.corpus_stats?.iocs ?? 4896);
  const usbConnected = Boolean(usbStatus?.android?.connected || usbStatus?.ios?.connected);
  const pcRawVerdict = pcAudit?.triage?.diagnosis?.verdict_code || pcAudit?.verdict;
  const pcVerdict = pcRawVerdict ? String(pcRawVerdict).toLowerCase() : null;

  const coreOrigin = { x: 52, y: 69 };
  const activeStyle = toneStyles(selectedNode.tone);

  const sparkSvgPath = useMemo(() => {
    const pts = selectedNode.sparkPoints || [14, 12, 10, 8, 5];
    return pts
      .map((y, idx) => `${idx === 0 ? 'M' : 'L'} ${idx * 16 + 2} ${y}`)
      .join(' ');
  }, [selectedNode]);

  function handleNodeClick(node) {
    onSelectNode?.(node.id);
    setPopoverOpen(true);
  }

  function handleNodeCta(node) {
    if (node.id === 'windows' && !pcAudit) {
      onRunPcScan?.();
      return;
    }
    if (node.id === 'corpus') {
      onSyncStix?.();
      return;
    }
    if (node.targetNav) {
      onNavigate?.(node.targetNav, node.targetTab ? { tab: node.targetTab } : {});
    }
  }

  // Clamp popover position so it stays cleanly visible on the canvas
  const popLeft = selectedNode.x > 55 ? Math.max(14, selectedNode.x - 36) : Math.min(52, selectedNode.x + 4);
  const popTop = selectedNode.y < 32 ? selectedNode.y + 8 : Math.max(16, selectedNode.y - 16);

  return (
    <section
      aria-label="Mapa topográfico de telemetría"
      className="relative h-full w-full overflow-hidden omega-stage-bg select-none flex flex-col justify-between"
    >
      {/* Mapa Topográfico SVG de fondo + Rutas vectoriales */}
      <div
        aria-hidden="true"
        className="absolute inset-0 transition-transform duration-300 ease-out"
        style={{ transform: `scale(${zoom})`, transformOrigin: '52% 54%' }}
      >
        <svg
          className="h-full w-full"
          viewBox="0 0 800 700"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <radialGradient id="omegaCoreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={pcAudit ? '#30D158' : '#F5A623'} stopOpacity="0.34" />
              <stop offset="100%" stopColor={pcAudit ? '#30D158' : '#F5A623'} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="routeTrail" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#F5A623" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#F5A623" stopOpacity="0.95" />
            </linearGradient>
          </defs>

          {/* Retícula de coordenadas sutil */}
          <g stroke="rgba(255,255,255,0.035)" strokeWidth="1">
            {[140, 280, 420, 560, 700].map((x) => (
              <line key={`vx-${x}`} x1={x} y1="0" x2={x} y2="700" />
            ))}
            {[120, 240, 360, 480, 600].map((y) => (
              <line key={`hy-${y}`} x1="0" y1={y} x2="800" y2={y} />
            ))}
          </g>

          {/* Curvas de nivel topográficas */}
          <g fill="none" stroke="rgba(182, 200, 214, 0.085)" strokeWidth="1.2">
            <path d="M-40 160 C 120 110, 240 260, 410 190 C 560 130, 670 210, 840 150" />
            <path d="M-40 245 C 140 190, 260 340, 435 270 C 590 210, 700 295, 840 240" />
            <path d="M-40 340 C 160 295, 290 420, 450 355 C 610 295, 720 390, 840 350" />
            <path d="M-40 445 C 150 400, 310 510, 465 450 C 625 390, 730 480, 840 440" />
            <path d="M-40 560 C 150 515, 290 615, 480 560 C 640 515, 740 595, 840 565" />
            <ellipse cx="415" cy="390" rx="220" ry="165" strokeDasharray="3 6" stroke="rgba(182,200,214,0.06)" />
            <ellipse cx="415" cy="390" rx="135" ry="96" stroke="rgba(182,200,214,0.07)" />
          </g>

          {/* Trayectoria principal dorada de entrada al núcleo */}
          <path
            d={`M 230 690 Q 330 610 ${coreOrigin.x * 8} ${coreOrigin.y * 7}`}
            fill="none"
            stroke="url(#routeTrail)"
            strokeWidth="3.2"
            strokeLinecap="round"
          />

          {/* Trayectoria punteada viva hacia el nodo seleccionado */}
          <path
            d={`M ${coreOrigin.x * 8} ${coreOrigin.y * 7} Q ${((coreOrigin.x + selectedNode.x) * 4) + 28} ${(coreOrigin.y + selectedNode.y) * 3.5} ${selectedNode.x * 8} ${selectedNode.y * 7}`}
            fill="none"
            stroke="rgba(244, 246, 250, 0.72)"
            strokeWidth="2.4"
            strokeDasharray="6 6"
            strokeLinecap="round"
          />

          {/* Enlaces secundarios discretos */}
          {nodes.map((n) => (
            <line
              key={`edge-${n.id}`}
              x1={coreOrigin.x * 8}
              y1={coreOrigin.y * 7}
              x2={n.x * 8}
              y2={n.y * 7}
              stroke="rgba(255,255,255,0.075)"
              strokeWidth="1"
            />
          ))}

          {/* Halo del núcleo */}
          <circle
            cx={coreOrigin.x * 8}
            cy={coreOrigin.y * 7}
            r="38"
            fill="url(#omegaCoreGlow)"
          />
        </svg>

        {/* Puntero direccional central del equipo protegido */}
        <button
          type="button"
          onClick={() => handleNodeClick(nodes[0])}
          aria-label="Centro del equipo OMEGA"
          style={{ left: `${coreOrigin.x}%`, top: `${coreOrigin.y}%` }}
          className="absolute -translate-x-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/[0.12] border border-white/[0.22] backdrop-blur-md flex items-center justify-center shadow-[0_6px_18px_rgba(0,0,0,0.45)] cursor-pointer hover:scale-105 transition-transform"
        >
          <Navigation
            className={`h-4 w-4 ${pcAudit ? 'text-[#30D158]' : 'text-[#F5A623]'} fill-current`}
          />
        </button>

        {/* Nodos Interactivos del Mapa */}
        {nodes.map((node) => {
          const Icon = node.icon;
          const isSelected = selectedNode.id === node.id;
          const st = toneStyles(node.tone);

          return (
            <button
              key={node.id}
              type="button"
              onClick={() => handleNodeClick(node)}
              aria-label={node.tag}
              style={{ left: `${node.x}%`, top: `${node.y}%` }}
              className={`group absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-transform duration-150 ${
                isSelected ? 'scale-110 z-20' : 'hover:scale-105 z-10'
              }`}
            >
              <div
                className={`relative h-9 w-9 rounded-full flex items-center justify-center border shadow-[0_10px_24px_rgba(0,0,0,0.48)] transition-colors ${
                  isSelected
                    ? 'bg-[#FFFFFF] text-[#14171D] border-white'
                    : 'bg-[#1D242C]/88 text-[#E8ECF2] border-white/[0.18] backdrop-blur-md hover:bg-[#27303A]'
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={1.9} />
                <span
                  className={`font-tech absolute -top-1.5 -right-2 rounded-full px-1.5 py-0.2 text-[9.5px] font-bold leading-[15px] shadow-sm ${st.badge}`}
                >
                  {node.shortBadge}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Popover Blanco Flotante sobre el Nodo Seleccionado (estilo #38 Roam) */}
      {!isCompactRail && popoverOpen && (
        <div
          style={{ left: `${popLeft}%`, top: `${popTop}%` }}
          className="hidden md:block absolute z-30 w-[256px]"
        >
          <div className="roam-node-popover rounded-[18px] p-3.5 relative">
            <div className="flex items-start justify-between gap-2">
              <div className="text-[14px] font-semibold leading-tight text-[#17191E]">
                {selectedNode.tag}
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium shrink-0 ${activeStyle.pill}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${activeStyle.dot}`} />
                {selectedNode.statusText}
              </span>
            </div>

            <div className="mt-2.5 flex items-end justify-between gap-2">
              <div className="space-y-0.5 text-[11.5px] text-[#4B515C]">
                <div className="font-medium text-[#17191E]">{selectedNode.metricA}</div>
                <div className="font-tech text-[11px]">{selectedNode.metricB}</div>
              </div>

              <svg
                width="74"
                height="24"
                viewBox="0 0 74 24"
                aria-hidden="true"
                className="shrink-0"
              >
                <path
                  d={sparkSvgPath}
                  fill="none"
                  stroke={activeStyle.line}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <div className="mt-3 pt-2.5 border-t border-black/[0.06] flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => handleNodeCta(selectedNode)}
                className="rounded-full bg-[#191C22] hover:bg-[#272B34] px-3 py-1 text-[11.5px] font-medium text-white cursor-pointer transition-colors"
              >
                {selectedNode.ctaLabel} →
              </button>
              <button
                type="button"
                onClick={() => onOpenCopilot?.({ pinnedContext: selectedNode.tag })}
                className="text-[11.5px] font-medium text-[#454A54] hover:text-[#17191E] cursor-pointer"
              >
                Consultar
              </button>
            </div>

            <button
              type="button"
              onClick={() => setPopoverOpen(false)}
              aria-label="Cerrar tarjeta de nodo"
              className="absolute -bottom-9 left-1/2 -translate-x-1/2 h-7 w-7 rounded-full bg-[#1B2027]/90 hover:bg-[#262D37] border border-white/[0.18] text-white inline-flex items-center justify-center shadow-lg cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Barra Superior Flotante agrupada arriba (evita flotar al centro en <1280px) */}
      <div className="relative z-20 shrink-0 flex flex-col gap-2">
        <div className="px-4 sm:px-5 pt-3.5 flex items-start justify-between gap-2 titlebar-drag [&_button]:[-webkit-app-region:no-drag]">
          {/* Marca izquierda + Estado breve */}
          <div className="min-w-0 shrink-0">
            <button
              type="button"
              onClick={() => onSelectNav('inicio')}
              className="inline-flex items-center gap-2 text-left cursor-pointer group"
            >
              <OmegaLogo size={22} isThinking={isLoadingChat} />
              <span className="text-[16px] font-semibold tracking-[0.04em] text-[#F4F6FA] group-hover:text-white">
                OMEGA
              </span>
            </button>

            {!isCompactRail && (
              <div className="mt-1.5 leading-tight">
                <div className="text-[13px] font-medium text-[#E4E8F0]">
                  {pcAudit ? 'Equipo auditado' : 'Protegido ahora'}
                </div>
                <div className="text-[11.5px] text-[#9BA5B4]">
                  {reportsCount} fuentes · {iocsCount.toLocaleString('en-US')} firmas
                </div>
              </div>
            )}
          </div>

          {/* Cápsula circular superior centrada estilo Roam */}
          {!isCompactRail && (
            <>
              <div className="hidden xl:block">
                <SpatialNavPill
                  activeNav={activeNav}
                  onSelectNav={onSelectNav}
                  pcVerdict={pcVerdict}
                  usbConnected={usbConnected}
                  apiOnline={apiOnline}
                  isLoadingChat={isLoadingChat}
                />
              </div>
              <div className="hidden md:block xl:hidden">
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
            </>
          )}

          {/* Botones circulares superiores derecha del lienzo */}
          {!isCompactRail && (
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onSyncStix}
                disabled={syncingStix}
                aria-label="Sincronizar firmas STIX2"
                title="Actualizar firmas STIX2 y YARA"
                className="h-9 w-9 rounded-full border border-white/[0.14] bg-[#191F26]/78 hover:bg-[#232B34] text-[#E4E8F0] inline-flex items-center justify-center backdrop-blur-md cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncingStix ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={onOpenCommandPalette}
                aria-label="Abrir paleta de acciones"
                title="Buscar módulo o acción (⌘K)"
                className="h-9 w-9 rounded-full border border-white/[0.14] bg-[#191F26]/78 hover:bg-[#232B34] text-[#E4E8F0] inline-flex items-center justify-center backdrop-blur-md cursor-pointer"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Cápsula compacta bajo cabecera solo en viewports estrechos (<768px) */}
        {!isCompactRail && (
          <div className="md:hidden flex justify-center px-3">
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
        )}
      </div>

      {/* Esquina inferior del lienzo: lectura RAM (izq) + controles circulares zoom/escaneo (der) */}
      <div className="relative z-20 px-4 sm:px-5 pb-4 flex items-end justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-[#151A20]/82 px-3 py-1.5 text-[11.5px] text-[#DCE2EC] backdrop-blur-md">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${apiOnline ? 'bg-[#30D158]' : 'bg-[#F5A623]'}`}
          />
          <span className="font-tech">
            {pcScannedAt ? `Chequeo ${pcScannedAt} · Solo RAM` : 'Memoria volátil · 0 disco'}
          </span>
        </div>

        {!isCompactRail && (
          <div className="flex flex-col gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onRunPcScan}
              disabled={scanningPc}
              aria-label="Escanear PC ahora"
              title="Analizar esta PC ahora"
              className="h-8 w-8 rounded-full border border-white/[0.14] bg-[#171C23]/86 hover:bg-[#232B35] text-[#F4F6FA] inline-flex items-center justify-center backdrop-blur-md cursor-pointer disabled:opacity-55"
            >
              <Sparkles className={`h-3.5 w-3.5 text-[#F5A623] ${scanningPc ? 'animate-pulse' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.35, Number((z + 0.12).toFixed(2))))}
              aria-label="Acercar mapa"
              title="Acercar"
              className="h-8 w-8 rounded-full border border-white/[0.14] bg-[#171C23]/86 hover:bg-[#232B35] text-[#F4F6FA] inline-flex items-center justify-center backdrop-blur-md cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.86, Number((z - 0.12).toFixed(2))))}
              aria-label="Alejar mapa"
              title="Alejar"
              className="h-8 w-8 rounded-full border border-white/[0.14] bg-[#171C23]/86 hover:bg-[#232B35] text-[#F4F6FA] inline-flex items-center justify-center backdrop-blur-md cursor-pointer"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                onSelectNode?.('windows');
                setPopoverOpen(true);
              }}
              aria-label="Recentrar vista"
              title="Recentrar"
              className="h-8 w-8 rounded-full border border-white/[0.14] bg-[#171C23]/86 hover:bg-[#232B35] text-[#F4F6FA] inline-flex items-center justify-center backdrop-blur-md cursor-pointer"
            >
              <Crosshair className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
