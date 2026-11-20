import { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FileSearch,
  HardDrive,
  Lock,
  MessageSquare,
  Shield,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { OmegaBrandMark } from './OmegaBrandMark';
import {
  SPRING_SNAPPY,
  backdropVariants,
  popVariants,
  stepSlideVariants,
} from '../lib/motion';

function buildGreeting(authSession) {
  const name = authSession?.fullName?.trim();
  if (name) return `Hola, ${name.split(/\s+/)[0]}`;
  const mailPrefix = authSession?.email?.split('@')[0];
  return mailPrefix ? `Hola, ${mailPrefix}` : 'Bienvenido a OMEGA';
}

const TOUR_STEPS = [
  {
    id: 'bienvenida',
    badge: '01 · Visión general',
    title: 'Bienvenido a tu Cabina OMEGA',
    subtitle:
      'Tu centro defensivo de ciberinteligencia, análisis forense en memoria y verificación pasiva de enlaces.',
    accent: 'Cabina unificada',
  },
  {
    id: 'equipos-enlaces',
    badge: '02 · Análisis preventivo',
    title: 'Revisa tus dispositivos y enlaces',
    subtitle:
      'Audita PC Windows, Android o respaldos iOS en RAM y valida enlaces sospechosos antes de abrirlos.',
    accent: 'Cero huella en disco',
  },
  {
    id: 'evidencia-cti',
    badge: '03 · Inteligencia CTI',
    title: 'Cruce verificable contra campañas',
    subtitle:
      'Correlaciona artefactos locales con reportes primarios de Citizen Lab, Amnesty Tech y Google TAG.',
    accent: 'Trazabilidad [#]',
  },
  {
    id: 'copiloto-modos',
    badge: '04 · Copiloto asistido',
    title: 'Respuestas claras o telemetría forense',
    subtitle:
      'Consulta al Copiloto con citas verificables y alterna el nivel de detalle según tu necesidad.',
    accent: 'RAG verificable',
  },
  {
    id: 'control-atajos',
    badge: '05 · Atajos y privacidad',
    title: 'Domina los atajos y tu privacidad',
    subtitle:
      'Muévete por toda la cabina con el teclado o ejecuta una purga rápida de memoria en un clic.',
    accent: 'Control total',
  },
];

const DEMO_FLOW_STEPS = [
  { label: 'Conectar equipo o pegar URL', detail: 'Snapshot RAM / URL aislada' },
  { label: 'Inspección en RAM', detail: '0 bytes escritos en disco' },
  { label: 'Veredicto limpio', detail: '0 coincidencias CTI · Listo', clean: true },
];

export function OnboardingTourModal({
  isOpen,
  onClose,
  onNavigate,
  onOpenCopilot,
  authSession = null,
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <OnboardingTourDialog
          key="omega-onboarding-dialog"
          onClose={onClose}
          onNavigate={onNavigate}
          onOpenCopilot={onOpenCopilot}
          authSession={authSession}
        />
      )}
    </AnimatePresence>
  );
}

function OnboardingTourDialog({
  onClose,
  onNavigate,
  onOpenCopilot,
  authSession = null,
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [demoTone, setDemoTone] = useState('claro');
  const [flowTick, setFlowTick] = useState(2);
  const pillGroupId = useId();

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      } else if (e.key === 'ArrowRight') {
        setDirection(1);
        setStepIndex((prev) => Math.min(prev + 1, TOUR_STEPS.length - 1));
      } else if (e.key === 'ArrowLeft') {
        setDirection(-1);
        setStepIndex((prev) => Math.max(prev - 1, 0));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (stepIndex !== 1) return undefined;
    const timer = setInterval(() => {
      setFlowTick((prev) => (prev + 1) % DEMO_FLOW_STEPS.length);
    }, 1800);
    return () => clearInterval(timer);
  }, [stepIndex]);

  const currentStep = TOUR_STEPS[stepIndex] || TOUR_STEPS[0];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_STEPS.length - 1;
  const tenantSlug = authSession?.tenantSlug || 'personal';

  function goToStep(nextIdx) {
    if (nextIdx === stepIndex || nextIdx < 0 || nextIdx >= TOUR_STEPS.length) return;
    setDirection(nextIdx > stepIndex ? 1 : -1);
    setStepIndex(nextIdx);
  }

  function finishAndNavigate(targetNav) {
    onClose?.();
    if (targetNav) {
      onNavigate?.(targetNav);
    }
  }

  const displayTitle =
    stepIndex === 0
      ? `${buildGreeting(authSession)} — tu cabina está lista`
      : currentStep.title;

  return (
    <motion.div
      variants={backdropVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A0A0C]/85 p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Pasarela interactiva de bienvenida a OMEGA"
    >
      <motion.div
        variants={popVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[860px] rounded-2xl overflow-hidden bg-[#0F131B]/95 backdrop-blur-xl border border-white/[0.08] shadow-[0_32px_90px_rgba(0,0,0,0.85)] my-auto"
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-7 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3 min-w-0">
            <OmegaBrandMark showText={false} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-tech text-[10.5px] uppercase tracking-[0.14em] text-[#2F6FED]">
                  {currentStep.badge}
                </span>
                <span className="hidden sm:inline-flex items-center rounded-full border border-white/[0.07] bg-[#141923]/75 px-2 py-0.5 text-[10px] font-medium text-[#9A9AA2]">
                  {currentStep.accent}
                </span>
              </div>
              <p className="text-[12px] text-[#9A9AA2] truncate">
                Guía interactiva de primeros pasos · OMEGA
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar guía de bienvenida"
            title="Omitir guía (Esc)"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#141923]/75 hover:border-white/[0.14] px-3 py-1 text-[11.5px] text-[#9A9AA2] hover:text-[#F2F2F4] transition-colors cursor-pointer shrink-0"
          >
            <span className="hidden sm:inline">Omitir</span>
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>

        {/* Stepper superior (01 a 05) */}
        <div className="px-5 sm:px-7 pt-4">
          <div
            role="tablist"
            aria-label="Pasos del recorrido OMEGA"
            className="grid grid-cols-5 gap-1.5 rounded-lg bg-[#141923]/75 border border-white/[0.05] p-1"
          >
            {TOUR_STEPS.map((step, idx) => {
              const active = idx === stepIndex;
              const done = idx < stepIndex;
              return (
                <button
                  key={step.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => goToStep(idx)}
                  className={`relative rounded-lg py-1.5 px-2 text-[11px] font-medium transition-colors cursor-pointer ${
                    active
                      ? 'text-white'
                      : done
                        ? 'text-[#2F6FED] hover:text-[#F2F2F4]'
                        : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId={`${pillGroupId}-active`}
                      transition={SPRING_SNAPPY}
                      aria-hidden="true"
                      className="absolute inset-0 rounded-lg bg-[#2F6FED]"
                    />
                  )}
                  <span className="relative z-10 font-tech">0{idx + 1}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Contenido dinámico con composición propia por cada paso */}
        <div className="px-5 sm:px-7 py-6">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep.id}
              custom={direction}
              variants={stepSlideVariants}
              initial="enter"
              animate="center"
              exit="exit"
            >
              {/* PASO 01 — Visión General (Hero de Bienvenida + 3 columnas limpias) */}
              {stepIndex === 0 && (
                <div className="space-y-7">
                  <div className="max-w-[600px] space-y-2.5">
                    <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight leading-[1.15] text-[#F2F2F4]">
                      {displayTitle}
                    </h2>
                    <p className="text-[14px] leading-relaxed text-[#9A9AA2]">
                      {currentStep.subtitle}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.06] border-t border-white/[0.06] pt-5">
                    <div className="pb-4 md:pb-0 md:pr-5 space-y-1.5">
                      <Lock className="h-4 w-4 text-[#2F6FED]" strokeWidth={1.75} />
                      <h3 className="text-[14px] font-semibold text-[#F2F2F4]">
                        Espacio privado
                      </h3>
                      <p className="text-[12.5px] text-[#9A9AA2] leading-relaxed">
                        Organización «{tenantSlug}» aislada con sesión en memoria.
                      </p>
                    </div>

                    <div className="py-4 md:py-0 md:px-5 space-y-1.5">
                      <Terminal className="h-4 w-4 text-[#2F6FED]" strokeWidth={1.75} />
                      <h3 className="text-[14px] font-semibold text-[#F2F2F4]">
                        Lenguaje claro o técnico
                      </h3>
                      <p className="text-[12.5px] text-[#9A9AA2] leading-relaxed">
                        Explica hallazgos complejos o consulta telemetría forense directa.
                      </p>
                    </div>

                    <div className="pt-4 md:pt-0 md:pl-5 space-y-1.5">
                      <HardDrive className="h-4 w-4 text-[#2F6FED]" strokeWidth={1.75} />
                      <h3 className="text-[14px] font-semibold text-[#F2F2F4]">
                        Cero retención en disco
                      </h3>
                      <p className="text-[12.5px] text-[#9A9AA2] leading-relaxed">
                        Respaldos, capturas y enlaces se evalúan únicamente en RAM.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* PASO 02 — Análisis Preventivo (Split Showcase) */}
              {stepIndex === 1 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <h2 className="font-display text-2xl font-semibold tracking-tight leading-tight text-[#F2F2F4]">
                        {displayTitle}
                      </h2>
                      <p className="text-[13.5px] leading-relaxed text-[#9A9AA2]">
                        Evalúa procesos de Windows, teléfonos Android/iOS por USB o respaldo, y verifica URLs sospechosas sin abrirlas en tu navegador.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={() => finishAndNavigate('equipo')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#141923]/75 hover:border-[#2F6FED]/50 px-3.5 py-2 text-[12.5px] font-medium text-[#F2F2F4] transition-colors cursor-pointer"
                      >
                        <span>Ir a Equipos</span>
                        <ArrowRight className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                      </button>

                      <button
                        type="button"
                        onClick={() => finishAndNavigate('enlace')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#141923]/75 hover:border-[#2F6FED]/50 px-3.5 py-2 text-[12.5px] font-medium text-[#F2F2F4] transition-colors cursor-pointer"
                      >
                        <span>Ir a Enlaces</span>
                        <ArrowRight className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>

                  {/* Tarjeta de demostración en vivo */}
                  <div className="rounded-xl bg-[#141923]/80 border border-white/[0.06] p-4 space-y-3">
                    <div className="flex items-center justify-between text-[11px] font-tech text-[#9A9AA2]">
                      <span>FLUJO EN MEMORIA RAM</span>
                      <span className="inline-flex items-center gap-1.5 text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        0 B en disco
                      </span>
                    </div>

                    <div className="divide-y divide-white/[0.06]">
                      {DEMO_FLOW_STEPS.map((stage, i) => {
                        const active = i === flowTick;
                        const completed = i < flowTick || (stage.clean && active);
                        return (
                          <div
                            key={stage.label}
                            className={`py-2.5 flex items-center justify-between gap-3 transition-opacity ${
                              active ? 'opacity-100' : 'opacity-55'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {stage.clean ? (
                                <CheckCircle2
                                  className="h-4 w-4 text-emerald-400 shrink-0"
                                  strokeWidth={1.75}
                                />
                              ) : (
                                <Cpu
                                  className={`h-4 w-4 shrink-0 ${
                                    active || completed ? 'text-[#2F6FED]' : 'text-[#9A9AA2]'
                                  }`}
                                  strokeWidth={1.75}
                                />
                              )}
                              <div className="min-w-0">
                                <div className="text-[12.5px] font-medium text-[#F2F2F4] truncate">
                                  {stage.label}
                                </div>
                                <div className="font-tech text-[11px] text-[#9A9AA2] truncate">
                                  {stage.detail}
                                </div>
                              </div>
                            </div>

                            {stage.clean && (
                              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 font-tech text-[10.5px] text-emerald-400 shrink-0">
                                Limpio
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* PASO 03 — Inteligencia CTI y Campañas (Evidence Preview) */}
              {stepIndex === 2 && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                  <div className="md:col-span-5 space-y-4">
                    <div className="space-y-2">
                      <h2 className="font-display text-2xl font-semibold tracking-tight leading-tight text-[#F2F2F4]">
                        {displayTitle}
                      </h2>
                      <p className="text-[13.5px] leading-relaxed text-[#9A9AA2]">
                        Cada hallazgo cruza tus artefactos locales contra firmas STIX 2.1 y reglas YARA con fecha de corte explícita y enlace al reporte original.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => finishAndNavigate('amenazas')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#141923]/75 hover:border-[#2F6FED]/50 px-3.5 py-2 text-[12.5px] font-medium text-[#F2F2F4] transition-colors cursor-pointer"
                    >
                      <Shield className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                      <span>Ver Amenazas</span>
                      <ArrowRight className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                    </button>
                  </div>

                  {/* Ficha forense de ejemplo */}
                  <div className="md:col-span-7 rounded-xl bg-[#141923]/80 border border-white/[0.06] p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-tech text-[11px] uppercase tracking-[0.06em] text-[#9A9AA2]">
                        EJEMPLO DE FICHA FORENSE
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-full border border-rose-500/35 bg-rose-500/12 px-2 py-0.5 font-tech text-[10.5px] font-medium text-rose-400">
                          CVSS 9.8
                        </span>
                        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 font-tech text-[10.5px] text-emerald-400">
                          Citizen Lab · #1
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="font-tech text-[13px] text-[#F2F2F4]">
                        ns1.example-telemetry[.]net
                      </div>
                      <p className="text-[12px] text-[#9A9AA2] leading-relaxed">
                        Dominio C2 asociado a campaña de spyware comercial (CVE-2023-41064). Coincidencia verificada contra el reporte primario sin inventar datos.
                      </p>
                    </div>

                    <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[11px] font-tech text-[#9A9AA2]">
                      <span>Vector: iMessage / WebKit</span>
                      <span className="inline-flex items-center gap-1 text-[#F2F2F4]">
                        <FileSearch className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                        Cita verificable
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* PASO 04 — Copiloto y Modo Técnico/Claro (Interactive Toggle Demo) */}
              {stepIndex === 3 && (
                <div className="space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                    <div className="space-y-1.5 max-w-[520px]">
                      <h2 className="font-display text-2xl font-semibold tracking-tight leading-tight text-[#F2F2F4]">
                        {displayTitle}
                      </h2>
                      <p className="text-[13.5px] leading-relaxed text-[#9A9AA2]">
                        Prueba cómo responde el Copiloto al cambiar entre explicación directa y análisis técnico.
                      </p>
                    </div>

                    {/* Mini-selector interactivo */}
                    <div
                      role="group"
                      aria-label="Ejemplo de tono del Copiloto"
                      className="inline-flex rounded-lg bg-[#141923]/75 border border-white/[0.05] p-0.5 shrink-0 self-start sm:self-auto"
                    >
                      <button
                        type="button"
                        onClick={() => setDemoTone('claro')}
                        className={`rounded-lg px-3 py-1 text-[12px] font-medium transition-colors cursor-pointer ${
                          demoTone === 'claro'
                            ? 'bg-[#2F6FED] text-white'
                            : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                        }`}
                      >
                        Modo Claro
                      </button>
                      <button
                        type="button"
                        onClick={() => setDemoTone('tecnico')}
                        className={`rounded-lg px-3 py-1 text-[12px] font-medium transition-colors cursor-pointer ${
                          demoTone === 'tecnico'
                            ? 'bg-[#2F6FED] text-white'
                            : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                        }`}
                      >
                        Modo Técnico
                      </button>
                    </div>
                  </div>

                  {/* Vista previa en vivo de respuesta del Copiloto */}
                  <div className="rounded-xl bg-[#141923]/80 border border-white/[0.06] p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-tech text-[#9A9AA2]">
                      <span className="inline-flex items-center gap-1.5 text-[#F2F2F4]">
                        <Sparkles className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                        Copiloto OMEGA · Vista previa
                      </span>
                      <span>{demoTone === 'claro' ? 'Resumen ejecutivo' : 'Telemetría forense'}</span>
                    </div>

                    {demoTone === 'claro' ? (
                      <p className="text-[13px] leading-relaxed text-[#F2F2F4]/90">
                        El enlace analizado intenta imitar una página de acceso oficial para capturar credenciales, pero no se abrió en tu navegador. Puedes descartarlo sin riesgo y activar verificación en dos pasos [1].
                      </p>
                    ) : (
                      <p className="font-tech text-[12px] leading-relaxed text-[#F2F2F4]/90">
                        TLS SAN mismatch · homograph IDN detectado en FQDN · 0 peticiones HTTP salientes · Regla YARA-X `phish_oauth_kit` y cruce STIX 2.1 sin coincidencias de implante C2 [1].
                      </p>
                    )}

                    <div className="pt-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => finishAndNavigate('preguntar')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#0F131B] hover:border-[#2F6FED]/50 px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] transition-colors cursor-pointer"
                      >
                        <MessageSquare className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                        <span>Abrir Asistente</span>
                        <ExternalLink className="h-3 w-3 text-[#9A9AA2]" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* PASO 05 — Atajos y Control de Privacidad (Keyboard Matrix) */}
              {stepIndex === 4 && (
                <div className="space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                    <div className="space-y-1.5">
                      <h2 className="font-display text-2xl font-semibold tracking-tight leading-tight text-[#F2F2F4]">
                        {displayTitle}
                      </h2>
                      <p className="text-[13.5px] leading-relaxed text-[#9A9AA2]">
                        {currentStep.subtitle}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onClose?.();
                        onOpenCopilot?.({});
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#141923]/75 hover:border-[#2F6FED]/50 px-3.5 py-2 text-[12.5px] font-medium text-[#F2F2F4] transition-colors cursor-pointer shrink-0 self-start sm:self-auto"
                    >
                      <span>Probar Copiloto</span>
                      <ArrowRight className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                    </button>
                  </div>

                  <div className="rounded-xl bg-[#141923]/80 border border-white/[0.06] divide-y divide-white/[0.06]">
                    <div className="px-4 py-3 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[13px] font-medium text-[#F2F2F4]">
                          Paleta de comandos rápida
                        </div>
                        <p className="text-[12px] text-[#9A9AA2]">
                          Salta entre módulos, busca campañas o abre acciones al instante.
                        </p>
                      </div>
                      <kbd className="px-2 py-1 rounded-md bg-[#141923] border border-white/10 font-mono text-xs text-slate-200 shrink-0">
                        Ctrl + K
                      </kbd>
                    </div>

                    <div className="px-4 py-3 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[13px] font-medium text-[#F2F2F4]">
                          Copiloto lateral flotante
                        </div>
                        <p className="text-[12px] text-[#9A9AA2]">
                          Consulta dudas sobre el análisis activo sin abandonar tu pantalla.
                        </p>
                      </div>
                      <kbd className="px-2 py-1 rounded-md bg-[#141923] border border-white/10 font-mono text-xs text-slate-200 shrink-0">
                        Ctrl + J
                      </kbd>
                    </div>

                    <div className="px-4 py-3 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[13px] font-medium text-rose-400 inline-flex items-center gap-1.5">
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span>Purga rápida</span>
                        </div>
                        <p className="text-[12px] text-[#9A9AA2]">
                          Destruye tokens, historial en RAM y caché local de inmediato.
                        </p>
                      </div>
                      <span className="rounded-full border border-rose-500/35 bg-rose-500/12 px-2.5 py-0.5 font-tech text-[10.5px] text-rose-400 shrink-0">
                        Barra superior
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Pie con navegación */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 sm:px-7 py-4 border-t border-white/[0.06] bg-[#0A0A0C]/60">
          <div className="flex items-center gap-1.5 text-[12px] text-[#9A9AA2]">
            <span className="font-tech text-[#F2F2F4]">
              {stepIndex + 1}/{TOUR_STEPS.length}
            </span>
            <span className="hidden sm:inline">· Usa ← y → para moverte</span>
          </div>

          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                type="button"
                onClick={() => goToStep(stepIndex - 1)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#141923]/75 hover:border-white/[0.14] px-3.5 py-2 text-[12.5px] font-medium text-[#F2F2F4] transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Anterior</span>
              </button>
            )}

            {!isLast ? (
              <button
                type="button"
                onClick={() => goToStep(stepIndex + 1)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2F6FED] hover:bg-[#2F6FED]/90 px-4 py-2 text-[12.5px] font-medium text-white transition-colors cursor-pointer"
              >
                <span>Siguiente</span>
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => finishAndNavigate('inicio')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2F6FED] hover:bg-[#2F6FED]/90 px-4 py-2 text-[12.5px] font-medium text-white transition-colors cursor-pointer"
              >
                <span>Empezar a usar OMEGA</span>
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
