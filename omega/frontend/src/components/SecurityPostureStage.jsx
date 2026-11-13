import { useEffect, useMemo, useRef } from 'react';
import {
  ArrowRight,
  ChevronRight,
  Laptop,
  Layers,
  Link2,
  RefreshCw,
  SlidersHorizontal,
  Smartphone,
} from 'lucide-react';
import { OmegaLogo } from './OmegaLogo';
import { SpatialNavPill } from './SpatialNavPill';

function drawLightCurtains(ctx, width, height, elapsedSec, palette, animate) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#0B0E13';
  ctx.fillRect(0, 0, width, height);

  // Cortinas verticales suaves de luz atmosférica (sin ruido ni partículas geométricas)
  ctx.globalCompositeOperation = 'screen';
  const folds = [
    { xRatio: 0.14, widthRatio: 0.28, amp: 0.035, speed: 0.22, phase: 0.4, color: palette.secondary, alpha: 0.28 },
    { xRatio: 0.34, widthRatio: 0.32, amp: 0.04, speed: 0.17, phase: 1.7, color: palette.primary, alpha: 0.34 },
    { xRatio: 0.56, widthRatio: 0.3, amp: 0.03, speed: 0.2, phase: 2.9, color: palette.secondary, alpha: 0.26 },
    { xRatio: 0.78, widthRatio: 0.36, amp: 0.038, speed: 0.15, phase: 4.1, color: palette.accent, alpha: 0.38 },
    { xRatio: 0.92, widthRatio: 0.28, amp: 0.025, speed: 0.19, phase: 5.3, color: palette.primary, alpha: 0.24 },
  ];

  const t = animate ? elapsedSec : 0;

  for (const fold of folds) {
    const drift = Math.sin(t * fold.speed + fold.phase) * width * fold.amp;
    const centerX = width * fold.xRatio + drift;
    const bandW = width * fold.widthRatio;
    const leftX = centerX - bandW / 2;

    const hGrad = ctx.createLinearGradient(leftX, 0, leftX + bandW, 0);
    hGrad.addColorStop(0, 'rgba(0,0,0,0)');
    hGrad.addColorStop(0.45, `rgba(${fold.color}, ${fold.alpha * 0.55})`);
    hGrad.addColorStop(0.55, `rgba(${fold.color}, ${fold.alpha})`);
    hGrad.addColorStop(1, 'rgba(0,0,0,0)');

    const vMask = ctx.createLinearGradient(0, 0, 0, height);
    vMask.addColorStop(0, 'rgba(0,0,0,0)');
    vMask.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    vMask.addColorStop(0.85, 'rgba(255,255,255,0.9)');
    vMask.addColorStop(1, 'rgba(255,255,255,0.65)');

    ctx.save();
    ctx.fillStyle = hGrad;
    ctx.fillRect(leftX, 0, bandW, height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.restore();

    // Atenuado vertical suave en bordes superior/inferior por banda
    const verticalBloom = ctx.createLinearGradient(centerX, 0, centerX, height);
    verticalBloom.addColorStop(0, 'rgba(11,14,19,0.86)');
    verticalBloom.addColorStop(0.42, 'rgba(11,14,19,0.2)');
    verticalBloom.addColorStop(0.86, 'rgba(11,14,19,0)');
    verticalBloom.addColorStop(1, 'rgba(11,14,19,0.35)');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = verticalBloom;
    ctx.fillRect(leftX, 0, bandW, height);
    ctx.globalCompositeOperation = 'screen';
    void vMask;
  }

  // Concentración luminosa discreta en esquina inferior derecha (borde hacia hoja piedra)
  const cornerGlow = ctx.createRadialGradient(
    width * 0.9,
    height * 0.88,
    0,
    width * 0.9,
    height * 0.88,
    Math.max(width, height) * 0.62,
  );
  cornerGlow.addColorStop(0, `rgba(${palette.corner}, 0.2)`);
  cornerGlow.addColorStop(0.55, `rgba(${palette.secondary}, 0.06)`);
  cornerGlow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = cornerGlow;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
}

export function SecurityPostureStage({
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
  syncingStix = false,
  onSyncStix,
  onOpenCommandPalette,
  onNavigate,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  const reportsCount = Number(govStats?.corpus_stats?.reports ?? 16);
  const iocsCount = Number(govStats?.corpus_stats?.iocs ?? 4896);
  const campaignsCount = Number(govStats?.corpus_stats?.campaigns ?? 19);

  const pcRawCode = String(
    pcAudit?.triage?.diagnosis?.verdict_code || pcAudit?.verdict || '',
  ).toLowerCase();
  const pcAlerts =
    Number(pcAudit?.triage?.total_matches ?? 0) +
    Number(pcAudit?.yara_hits?.length ?? 0) +
    Number(pcAudit?.behavioral_anomalies?.length ?? 0);
  const pcSockets = Number(pcAudit?.live_sockets_total ?? 0);
  const pcHealthy = Boolean(pcAudit && (pcRawCode === 'clean' || pcRawCode === 'low' || pcAlerts === 0));
  const pcWarn = Boolean(pcAudit && !pcHealthy);
  const pcVerdict = pcRawCode || null;

  const androidOk = Boolean(usbStatus?.android?.connected);
  const iosOk = Boolean(usbStatus?.ios?.connected);
  const usbConnected = androidOk || iosOk;

  const linkRisk = String(lastLinkResult?.risk_level || lastLinkResult?.verdict || '').toUpperCase();

  // Paleta atmosférica discreta derivada del estado real del equipo
  const atmospherePalette = useMemo(() => {
    if (pcWarn || linkRisk === 'HIGH') {
      return {
        primary: '214, 130, 52',
        secondary: '96, 114, 140',
        accent: '232, 93, 74',
        corner: '214, 130, 52',
      };
    }
    if (pcHealthy) {
      return {
        primary: '56, 148, 108',
        secondary: '74, 112, 168',
        accent: '76, 184, 128',
        corner: '64, 164, 118',
      };
    }
    return {
      primary: '68, 108, 178',
      secondary: '86, 104, 132',
      accent: '198, 146, 72',
      corner: '188, 138, 68',
    };
  }, [pcWarn, pcHealthy, linkRisk]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let rafId = 0;
    let width = 0;
    let height = 0;
    const startTs = performance.now();

    const syncSize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawLightCurtains(ctx, width, height, 0, atmospherePalette, false);
    };

    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(container);

    const tick = (now) => {
      if (!document.hidden && !reducedMotion) {
        drawLightCurtains(ctx, width, height, (now - startTs) / 1000, atmospherePalette, true);
        rafId = requestAnimationFrame(tick);
      }
    };

    const onVisibility = () => {
      cancelAnimationFrame(rafId);
      if (!document.hidden && !reducedMotion) {
        rafId = requestAnimationFrame(tick);
      }
    };

    if (!reducedMotion && !document.hidden) {
      rafId = requestAnimationFrame(tick);
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [atmospherePalette]);

  const sensors = useMemo(
    () => [
      {
        id: 'windows',
        label: 'PC Windows',
        ariaLabel: '#01 Esta PC · Windows',
        icon: Laptop,
        tone: pcWarn ? 'alert' : pcHealthy ? 'clean' : 'amber',
        status: pcWarn
          ? `Revisar (${pcAlerts})`
          : pcHealthy
            ? pcScannedAt
              ? `Verificado · ${pcScannedAt}`
              : 'Verificado'
            : technicalMode
              ? 'Listo · WMI/RAM'
              : 'Listo en RAM',
        meta: technicalMode ? `${pcSockets} sockets · ${pcAlerts} hits YARA` : 'Procesos y red local',
      },
      {
        id: 'usb',
        label: 'Celulares por USB',
        ariaLabel: '#02 Celular por USB',
        icon: Smartphone,
        tone: usbConnected ? 'clean' : 'neutral',
        status: androidOk
          ? usbStatus?.android?.model || 'Android USB'
          : iosOk
            ? usbStatus?.ios?.device?.name || 'iPhone USB'
            : 'En espera',
        meta: technicalMode ? 'ADB / Lockdown iOS' : 'Android e iPhone por cable',
      },
      {
        id: 'link',
        label: 'Escudo de enlaces',
        ariaLabel: '#03 Escudo de enlaces',
        icon: Link2,
        tone: linkRisk === 'HIGH' ? 'alert' : lastLinkResult ? 'clean' : 'neutral',
        status: lastLinkResult ? linkRisk || 'Revisado' : 'Listo',
        meta: technicalMode ? 'Sandbox URL pasivo' : 'Sin abrir ni conectar',
      },
      {
        id: 'corpus',
        label: 'Base forense local',
        ariaLabel: '#04 Base forense STIX2',
        icon: Layers,
        tone: apiOnline ? 'clean' : 'amber',
        status: apiOnline
          ? technicalMode
            ? `${campaignsCount} campañas`
            : `${reportsCount} reportes`
          : 'Sin API',
        meta: `${iocsCount.toLocaleString('en-US')} firmas STIX2`,
      },
    ],
    [
      pcWarn,
      pcHealthy,
      pcAlerts,
      pcScannedAt,
      pcSockets,
      technicalMode,
      usbConnected,
      androidOk,
      iosOk,
      usbStatus,
      linkRisk,
      lastLinkResult,
      apiOnline,
      campaignsCount,
      reportsCount,
      iocsCount,
    ],
  );

  const postureHeadline = useMemo(() => {
    if (pcWarn) {
      return {
        title: 'Revisión preventiva sugerida.',
        subtitle:
          'Detectamos señales en memoria que conviene inspeccionar en el informe detallado.',
      };
    }
    if (pcHealthy) {
      return {
        title: 'Entorno local verificado.',
        subtitle: technicalMode
          ? `Lectura de ${pcScannedAt || 'sesión'}: ${pcSockets} sockets activos y 0 coincidencias YARA/CTI en memoria.`
          : `Chequeo ${pcScannedAt || 'en vivo'}: procesos, red y defensas del sistema operando sin anomalías conocidas.`,
      };
    }
    return {
      title: 'Protección pasiva lista.',
      subtitle:
        'Audita procesos en RAM, teléfonos conectados por USB y enlaces sospechosos sin escribir datos en disco.',
    };
  }, [pcWarn, pcHealthy, pcScannedAt, pcSockets, technicalMode]);

  return (
    <section
      ref={containerRef}
      aria-label="Postura de seguridad OMEGA"
      className="relative h-full w-full overflow-hidden bg-[#0B0E13] border-r border-white/[0.06] select-none flex flex-col justify-between"
    >
      {/* Fondo atmosférico de cortinas verticales de luz */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {/* Sutiles marcas arquitectónicas de encuadre en esquinas */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-3 border border-white/[0.03] rounded-[18px]"
      />

      {/* Barra superior agrupada arriba */}
      <div className="relative z-20 shrink-0 flex flex-col gap-2">
        <div className="px-5 sm:px-6 pt-4 flex items-center justify-between gap-2 titlebar-drag [&_button]:[-webkit-app-region:no-drag]">
          <button
            type="button"
            onClick={() => onSelectNav('inicio')}
            className="inline-flex items-center gap-2.5 text-left cursor-pointer group shrink-0"
          >
            <OmegaLogo size={22} isThinking={isLoadingChat} />
            <span className="text-[15.5px] font-semibold tracking-[0.06em] text-[#F4F6FA] group-hover:text-white">
              OMEGA
            </span>
          </button>

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

          {!isCompactRail && (
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onSyncStix}
                disabled={syncingStix}
                aria-label="Sincronizar firmas STIX2"
                title="Actualizar firmas STIX2 y YARA"
                className="h-9 w-9 rounded-full border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.09] text-[#DCE2EC] inline-flex items-center justify-center backdrop-blur-md transition-colors cursor-pointer disabled:opacity-55"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncingStix ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={onOpenCommandPalette}
                aria-label="Abrir paleta de acciones"
                title="Buscar módulo o acción (⌘K)"
                className="h-9 w-9 rounded-full border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.09] text-[#DCE2EC] inline-flex items-center justify-center backdrop-blur-md transition-colors cursor-pointer"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

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

      {/* Recepción minimalista central */}
      {!isCompactRail ? (
        <div className="relative z-10 flex-1 min-h-0 flex flex-col justify-center px-6 sm:px-10 lg:px-12 py-4">
          <div className="w-full max-w-[490px] mx-auto md:mx-0">
            <h2 className="text-[clamp(1.6rem,2.6vw,2.25rem)] font-medium tracking-[-0.03em] leading-[1.14] text-[#F4F6FA]">
              {postureHeadline.title}
            </h2>

            <p className="mt-3 max-w-[44ch] text-[14px] sm:text-[14.5px] leading-[1.58] text-[#A2ACB9]">
              {postureHeadline.subtitle}
            </p>

            {/* Lista arquitectónica de sensores (sin pines de mapa) */}
            <div
              role="listbox"
              aria-label="Superficies de inspección OMEGA"
              className="mt-7 border-t border-white/[0.08]"
            >
              {sensors.map((item) => {
                const Icon = item.icon;
                const selected = selectedNodeId === item.id;
                const dotColor =
                  item.tone === 'alert'
                    ? 'bg-[#FF453A]'
                    : item.tone === 'clean'
                      ? 'bg-[#30D158]'
                      : item.tone === 'amber'
                        ? 'bg-[#F5A623]'
                        : 'bg-[#7A8494]';

                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-label={item.ariaLabel}
                    onClick={() => onSelectNode?.(item.id)}
                    className={`group relative w-full border-b border-white/[0.08] py-3 px-3 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                      selected
                        ? 'bg-white/[0.055]'
                        : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    {/* Indicador vertical fino para el sensor activo */}
                    <span
                      aria-hidden="true"
                      className={`absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-full transition-opacity ${
                        selected ? 'bg-[#F4F4EF] opacity-100' : 'opacity-0'
                      }`}
                    />

                    <div className="min-w-0 flex items-center gap-3">
                      <Icon
                        className={`h-4 w-4 shrink-0 transition-colors ${
                          selected ? 'text-[#F4F6FA]' : 'text-[#8C95A4] group-hover:text-[#D5DCE6]'
                        }`}
                        strokeWidth={1.7}
                      />
                      <div className="min-w-0">
                        <div
                          className={`text-[13.5px] font-medium truncate ${
                            selected ? 'text-[#FFFFFF]' : 'text-[#DCE2EC]'
                          }`}
                        >
                          {item.label}
                        </div>
                        <div className="text-[11.5px] text-[#8E98A8] truncate">
                          {item.meta}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="inline-flex items-center gap-1.5 font-tech text-[11.5px] text-[#CBD3DF]">
                        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                        <span>{item.status}</span>
                      </span>
                      <ChevronRight
                        className={`h-3.5 w-3.5 transition-transform ${
                          selected
                            ? 'text-[#F4F6FA] translate-x-0.5'
                            : 'text-[#6E7786] group-hover:text-[#AEB7C4]'
                        }`}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* Rail compacto sereno en vistas especializadas (sin mapa ni sobrecarga visual) */
        <div className="relative z-10 flex-1 min-h-0 flex flex-col justify-center px-5 py-6">
          <div className="border-t border-white/[0.08]">
            {sensors.map((item) => {
              const Icon = item.icon;
              const dotColor =
                item.tone === 'alert'
                  ? 'bg-[#FF453A]'
                  : item.tone === 'clean'
                    ? 'bg-[#30D158]'
                    : item.tone === 'amber'
                      ? 'bg-[#F5A623]'
                      : 'bg-[#7A8494]';

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectNode?.(item.id);
                    if (item.id === 'link') onNavigate?.('enlace');
                    else if (item.id === 'corpus') onNavigate?.('amenazas');
                    else if (item.id === 'usb') onNavigate?.('equipo', { tab: iosOk ? 'ios' : 'android' });
                    else onNavigate?.('equipo', { tab: 'pc' });
                  }}
                  className="w-full border-b border-white/[0.08] py-3 px-2 flex items-center justify-between gap-2 text-left hover:bg-white/[0.03] transition-colors cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2.5 min-w-0">
                    <Icon className="h-3.5 w-3.5 text-[#8E98A8] shrink-0" strokeWidth={1.7} />
                    <span className="text-[12.5px] font-medium text-[#D6DCE6] truncate">
                      {item.label}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-tech text-[11px] text-[#9BA5B4] shrink-0">
                    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                    <span className="max-w-[148px] truncate whitespace-nowrap">{item.status}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Pie discreto con garantía operativa real */}
      <div className="relative z-20 shrink-0 px-5 sm:px-6 pb-4 flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11.5px] text-[#CBD3DF] backdrop-blur-md">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${apiOnline ? 'bg-[#30D158]' : 'bg-[#F5A623]'}`}
          />
          <span className="font-tech">
            {pcScannedAt ? `Chequeo ${pcScannedAt} · Solo RAM` : 'Memoria volátil · 0 bytes en disco'}
          </span>
        </div>

        {!isCompactRail && (
          <button
            type="button"
            onClick={() => onNavigate?.('amenazas')}
            className="hidden sm:inline-flex items-center gap-1.5 text-[12px] font-medium text-[#9FA8B7] hover:text-[#F4F6FA] transition-colors cursor-pointer"
          >
            <span>Explorar amenazas</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </section>
  );
}
