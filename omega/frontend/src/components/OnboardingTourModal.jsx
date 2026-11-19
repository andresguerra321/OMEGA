import { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Command,
  FileUp,
  Laptop,
  Layers,
  Link2,
  Lock,
  MessageSquare,
  Radar,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { OmegaLogo } from './OmegaLogo';
import {
  SPRING_SNAPPY,
  SPRING_SOFT,
  backdropVariants,
  fadeUpItem,
  hoverLift,
  popVariants,
  staggerContainer,
  stepSlideVariants,
  tapPress,
} from '../lib/motion';

const TOUR_STEPS = [
  {
    id: 'bienvenida',
    badge: '01 · Visión general',
    title: 'Bienvenido a tu Cabina OMEGA',
    subtitle:
      'Tu centro defensivo de inteligencia CTI, análisis forense sin retención y verificación OSINT.',
    accent: 'Cabina unificada',
  },
  {
    id: 'equipos-enlaces',
    badge: '02 · Análisis preventivo',
    title: 'Revisa tus dispositivos y enlaces',
    subtitle:
      'Audita PC Windows, Android (ADB) o respaldos iOS en RAM y valida enlaces sospechosos antes de abrirlos.',
    accent: 'Cero huella en disco',
  },
  {
    id: 'asistente-pdfs',
    badge: '03 · Inteligencia con citas',
    title: 'Pregunta al Asistente y sube PDFs',
    subtitle:
      'Toda respuesta sobre amenazas cita exactamente el documento y página fuente. Además puedes analizar tus propios informes.',
    accent: 'RAG verificable',
  },
  {
    id: 'amenazas-osint',
    badge: '04 · Contexto externo',
    title: 'Explora campañas y exposición',
    subtitle:
      'Consulta campañas STIX 2.1 con fecha de corte explícita y evalúa superficie DNS/certificados con consentimiento previo.',
    accent: 'Transparencia de alcance',
  },
  {
    id: 'control-atajos',
    badge: '05 · Escudo vs. Laboratorio',
    title: 'Elige tu modo y controla tu flota',
    subtitle:
      'Alterna entre Modo Escudo (3 flujos guiados con sensor nativo Rust) y Modo Laboratorio (STIX, OSINT, RAG y dictamen PDF), o gestiona equipos y cuotas desde Cuenta.',
    accent: 'Control total v2.0',
  },
];

function buildGreeting(authSession) {
  const name = authSession?.fullName?.trim();
  if (name) return `Hola, ${name.split(/\s+/)[0]}`;
  const mailPrefix = authSession?.email?.split('@')[0];
  return mailPrefix ? `Hola, ${mailPrefix}` : 'Bienvenido a OMEGA';
}

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

  const currentStep = TOUR_STEPS[stepIndex] || TOUR_STEPS[0];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_STEPS.length - 1;

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

  return (
    <motion.div
      variants={backdropVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A0A0C]/80 backdrop-blur-md p-3.5 sm:p-6"
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
            className="omega-glass-panel relative w-full max-w-[700px] rounded-[22px] overflow-hidden border border-white/[0.12] shadow-[0_28px_80px_rgba(0,0,0,0.78),0_0_48px_rgba(47,111,237,0.14)]"
          >
            {/* Halo sutil superior */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-48 w-[420px] rounded-full opacity-45"
              style={{
                background:
                  'radial-gradient(circle, rgba(47, 111, 237, 0.45) 0%, rgba(47, 111, 237, 0) 70%)',
              }}
            />

            {/* Cabecera con barra de progreso */}
            <div className="relative z-10 flex items-center justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-white/[0.07]">
              <div className="flex items-center gap-3 min-w-0">
                <OmegaLogo size={32} isThinking={stepIndex === 0} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-tech text-[10.5px] uppercase tracking-[0.14em] text-[#6FA0FF]">
                      {currentStep.badge}
                    </span>
                    <span className="hidden sm:inline-flex items-center rounded-full border border-[#2F6FED]/35 bg-[#2F6FED]/15 px-2 py-0.5 text-[10px] font-medium text-[#CFE0FF]">
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
                className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.1] px-2.5 py-1 text-[11.5px] text-[#9A9AA2] hover:text-[#F2F2F4] transition-colors cursor-pointer shrink-0"
              >
                <span className="hidden sm:inline">Omitir</span>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Indicador segmentado interactivo con layoutId */}
            <div className="relative z-10 px-5 sm:px-6 pt-3.5">
              <div
                role="tablist"
                aria-label="Pasos del recorrido OMEGA"
                className="grid grid-cols-5 gap-1.5 rounded-[12px] bg-white/[0.03] border border-white/[0.06] p-1"
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
                      className={`relative rounded-[8px] py-1.5 px-2 text-[11px] font-medium transition-colors cursor-pointer ${
                        active
                          ? 'text-[#F2F2F4]'
                          : done
                            ? 'text-[#8AB4FF] hover:text-[#F2F2F4]'
                            : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId={`${pillGroupId}-active`}
                          transition={SPRING_SNAPPY}
                          aria-hidden="true"
                          className="absolute inset-0 rounded-[8px] bg-[rgba(47,111,237,0.28)] border border-[#2F6FED]/55 shadow-[0_0_18px_rgba(47,111,237,0.22)]"
                        />
                      )}
                      <span className="relative z-10 font-tech">0{idx + 1}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Contenido animado del paso */}
            <div className="relative z-10 px-5 sm:px-6 py-5 min-h-[310px] sm:min-h-[300px] overflow-hidden flex flex-col justify-center">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={currentStep.id}
                  custom={direction}
                  variants={stepSlideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="space-y-4"
                >
                  <div>
                    <h2 className="font-display text-[20px] sm:text-[22px] font-semibold tracking-[-0.02em] text-[#F2F2F4]">
                      {stepIndex === 0
                        ? `${buildGreeting(authSession)} — tu cabina está lista`
                        : currentStep.title}
                    </h2>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#9A9AA2]">
                      {currentStep.subtitle}
                    </p>
                  </div>

                  {stepIndex === 0 && (
                    <motion.div
                      variants={staggerContainer}
                      initial="initial"
                      animate="animate"
                      className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1"
                    >
                      <motion.div
                        variants={fadeUpItem}
                        className="apple-well rounded-[14px] p-3.5 space-y-1.5"
                      >
                        <div className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#2F6FED]/15 border border-[#2F6FED]/35 text-[#6FA0FF]">
                          <ShieldCheck className="h-4 w-4" />
                        </div>
                        <div className="text-[13px] font-semibold text-[#F2F2F4]">
                          Espacio privado creado
                        </div>
                        <p className="text-[11.5px] text-[#9A9AA2] leading-snug">
                          Organización{' '}
                          <span className="font-tech text-[#CFE0FF]">
                            {authSession?.tenantSlug || 'personal'}
                          </span>{' '}
                          lista con sesión protegida por cookie HttpOnly / RAM.
                        </p>
                      </motion.div>

                      <motion.div
                        variants={fadeUpItem}
                        className="apple-well rounded-[14px] p-3.5 space-y-1.5"
                      >
                        <div className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#30D158]/15 border border-[#30D158]/35 text-[#30D158]">
                          <Sparkles className="h-4 w-4" />
                        </div>
                        <div className="text-[13px] font-semibold text-[#F2F2F4]">
                          Modo Simple o Técnico
                        </div>
                        <p className="text-[11.5px] text-[#9A9AA2] leading-snug">
                          Alterna arriba en la barra entre lenguaje claro para decisiones rápidas o telemetría forense detallada.
                        </p>
                      </motion.div>

                      <motion.div
                        variants={fadeUpItem}
                        className="apple-well rounded-[14px] p-3.5 space-y-1.5"
                      >
                        <div className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-white/[0.06] border border-white/[0.12] text-[#F2F2F4]">
                          <Lock className="h-4 w-4" />
                        </div>
                        <div className="text-[13px] font-semibold text-[#F2F2F4]">
                          Cero retención volátil
                        </div>
                        <p className="text-[11.5px] text-[#9A9AA2] leading-snug">
                          Las inspecciones de archivos, SQLite y respaldos se procesan únicamente en memoria RAM.
                        </p>
                      </motion.div>
                    </motion.div>
                  )}

                  {stepIndex === 1 && (
                    <motion.div
                      variants={staggerContainer}
                      initial="initial"
                      animate="animate"
                      className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1"
                    >
                      <motion.button
                        type="button"
                        variants={fadeUpItem}
                        whileHover={hoverLift}
                        whileTap={tapPress}
                        onClick={() => finishAndNavigate('equipo')}
                        className="omega-glass-card rounded-[15px] p-4 text-left space-y-2 border border-white/[0.09] hover:border-[#2F6FED]/55 cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#2F6FED]/18 border border-[#2F6FED]/40 text-[#6FA0FF]">
                            <Laptop className="h-4 w-4" />
                          </div>
                          <span className="font-tech text-[10.5px] text-[#6FA0FF]">
                            Módulo Equipos →
                          </span>
                        </div>
                        <div className="text-[13.5px] font-semibold text-[#F2F2F4]">
                          Escáner de PC Windows, Android y iPhone
                        </div>
                        <p className="text-[12px] text-[#9A9AA2] leading-snug">
                          Ejecuta snapshot local de Windows, conecta un Android por ADB o carga un respaldo iOS/MVT para detectar persistencia e IOCs.
                        </p>
                      </motion.button>

                      <motion.button
                        type="button"
                        variants={fadeUpItem}
                        whileHover={hoverLift}
                        whileTap={tapPress}
                        onClick={() => finishAndNavigate('enlace')}
                        className="omega-glass-card rounded-[15px] p-4 text-left space-y-2 border border-white/[0.09] hover:border-[#2F6FED]/55 cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#2F6FED]/18 border border-[#2F6FED]/40 text-[#6FA0FF]">
                            <Link2 className="h-4 w-4" />
                          </div>
                          <span className="font-tech text-[10.5px] text-[#6FA0FF]">
                            Módulo Enlaces →
                          </span>
                        </div>
                        <div className="text-[13.5px] font-semibold text-[#F2F2F4]">
                          Verificador seguro de URLs sospechosas
                        </div>
                        <p className="text-[12px] text-[#9A9AA2] leading-snug">
                          Pega enlaces recibidos por SMS o correo (incluso ofuscados tipo <code className="font-tech text-[#CFE0FF]">hxxps://</code>) para inspeccionar redirecciones sin exponer tu equipo.
                        </p>
                      </motion.button>
                    </motion.div>
                  )}

                  {stepIndex === 2 && (
                    <motion.div
                      variants={staggerContainer}
                      initial="initial"
                      animate="animate"
                      className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1"
                    >
                      <motion.button
                        type="button"
                        variants={fadeUpItem}
                        whileHover={hoverLift}
                        whileTap={tapPress}
                        onClick={() => finishAndNavigate('preguntar')}
                        className="omega-glass-card rounded-[15px] p-4 text-left space-y-2 border border-white/[0.09] hover:border-[#2F6FED]/55 cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#2F6FED]/18 border border-[#2F6FED]/40 text-[#6FA0FF]">
                            <MessageSquare className="h-4 w-4" />
                          </div>
                          <span className="font-tech text-[10.5px] text-[#6FA0FF]">
                            Asistente RAG →
                          </span>
                        </div>
                        <div className="text-[13.5px] font-semibold text-[#F2F2F4]">
                          Consultas con citas exactas
                        </div>
                        <p className="text-[12px] text-[#9A9AA2] leading-snug">
                          Elige profundidad (<strong className="text-[#F2F2F4]">Rápido / Estándar / En profundidad</strong>) y haz clic en cualquier cita <code className="font-tech text-[#CFE0FF]">[#]</code> para abrir la página original en el panel de fuentes.
                        </p>
                      </motion.button>

                      <motion.button
                        type="button"
                        variants={fadeUpItem}
                        whileHover={hoverLift}
                        whileTap={tapPress}
                        onClick={() => finishAndNavigate('cuenta')}
                        className="omega-glass-card rounded-[15px] p-4 text-left space-y-2 border border-white/[0.09] hover:border-[#2F6FED]/55 cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#30D158]/15 border border-[#30D158]/35 text-[#30D158]">
                            <FileUp className="h-4 w-4" />
                          </div>
                          <span className="font-tech text-[10.5px] text-[#30D158]">
                            Biblioteca privada →
                          </span>
                        </div>
                        <div className="text-[13.5px] font-semibold text-[#F2F2F4]">
                          Indexa tus propios informes PDF
                        </div>
                        <p className="text-[12px] text-[#9A9AA2] leading-snug">
                          Sube reportes forenses o peritajes en <strong className="text-[#F2F2F4]">Cuenta</strong> o desde el chat para cruzarlos de forma aislada dentro de tu organización.
                        </p>
                      </motion.button>
                    </motion.div>
                  )}

                  {stepIndex === 3 && (
                    <motion.div
                      variants={staggerContainer}
                      initial="initial"
                      animate="animate"
                      className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1"
                    >
                      <motion.button
                        type="button"
                        variants={fadeUpItem}
                        whileHover={hoverLift}
                        whileTap={tapPress}
                        onClick={() => finishAndNavigate('amenazas')}
                        className="omega-glass-card rounded-[15px] p-4 text-left space-y-2 border border-white/[0.09] hover:border-[#2F6FED]/55 cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#2F6FED]/18 border border-[#2F6FED]/40 text-[#6FA0FF]">
                            <Layers className="h-4 w-4" />
                          </div>
                          <span className="font-tech text-[10.5px] text-[#6FA0FF]">
                            Amenazas CTI →
                          </span>
                        </div>
                        <div className="text-[13.5px] font-semibold text-[#F2F2F4]">
                          Campañas, CVEs e indicadores STIX 2.1
                        </div>
                        <p className="text-[12px] text-[#9A9AA2] leading-snug">
                          Explora familias como Pegasus o Predator, filtra CVEs verificados y revisa siempre la fecha de corte del catálogo de inteligencia.
                        </p>
                      </motion.button>

                      <motion.button
                        type="button"
                        variants={fadeUpItem}
                        whileHover={hoverLift}
                        whileTap={tapPress}
                        onClick={() => finishAndNavigate('exposicion')}
                        className="omega-glass-card rounded-[15px] p-4 text-left space-y-2 border border-white/[0.09] hover:border-[#2F6FED]/55 cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#2F6FED]/18 border border-[#2F6FED]/40 text-[#6FA0FF]">
                            <Radar className="h-4 w-4" />
                          </div>
                          <span className="font-tech text-[10.5px] text-[#6FA0FF]">
                            Exposición OSINT →
                          </span>
                        </div>
                        <div className="text-[13.5px] font-semibold text-[#F2F2F4]">
                          Auditoría pasiva con consentimiento
                        </div>
                        <p className="text-[12px] text-[#9A9AA2] leading-snug">
                          Inspecciona transparencia de certificados (<code className="font-tech text-[#CFE0FF]">crt.sh</code>) y postura SPF/DMARC sobre dominios autorizados, 100% pasivo.
                        </p>
                      </motion.button>
                    </motion.div>
                  )}

                  {stepIndex === 4 && (
                    <motion.div
                      variants={staggerContainer}
                      initial="initial"
                      animate="animate"
                      className="space-y-2.5 pt-1"
                    >
                      <motion.div
                        variants={fadeUpItem}
                        className="apple-well rounded-[14px] p-3.5 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#2F6FED]/18 border border-[#2F6FED]/40 text-[#6FA0FF] shrink-0">
                            <Command className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-[13px] font-semibold text-[#F2F2F4]">
                              Paleta Spotlight & Copiloto flotante
                            </div>
                            <p className="text-[11.5px] text-[#9A9AA2]">
                              Salta entre módulos al instante con <code className="font-tech text-[#CFE0FF]">Ctrl+K</code> o abre el Copiloto sin perder lo que estás haciendo con <code className="font-tech text-[#CFE0FF]">Ctrl+J</code>.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onClose?.();
                            onOpenCopilot?.({});
                          }}
                          className="omega-glass-chip shrink-0 rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium text-[#CFE0FF] hover:text-white cursor-pointer"
                        >
                          Probar Copiloto
                        </button>
                      </motion.div>

                      <motion.div
                        variants={fadeUpItem}
                        className="apple-well rounded-[14px] p-3.5 flex items-center justify-between gap-3 border-[#FF453A]/20"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#FF453A]/15 border border-[#FF453A]/35 text-[#FF7A73] shrink-0">
                            <Lock className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-[13px] font-semibold text-[#F2F2F4]">
                              Purga rápida y re-apertura de esta guía
                            </div>
                            <p className="text-[11.5px] text-[#9A9AA2]">
                              El botón rojo en la barra superior borra la memoria local y cierra sesión al instante. Puedes volver a abrir este tutorial desde el botón <BookOpen className="inline h-3 w-3 text-[#6FA0FF]" /> arriba o en <code className="font-tech text-[#CFE0FF]">Ctrl+K</code>.
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Pie con navegación */}
            <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 px-5 sm:px-6 py-4 border-t border-white/[0.07] bg-[#0A0A0C]/45">
              <div className="flex items-center gap-1.5 text-[11.5px] text-[#9A9AA2]">
                <span className="font-tech text-[#CFE0FF]">
                  {stepIndex + 1}/{TOUR_STEPS.length}
                </span>
                <span className="hidden sm:inline">· Usa ← y → para moverte</span>
              </div>

              <div className="flex items-center gap-2">
                {!isFirst && (
                  <motion.button
                    type="button"
                    whileTap={tapPress}
                    onClick={() => goToStep(stepIndex - 1)}
                    className="omega-glass-chip inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[12.5px] font-medium text-[#F2F2F4] cursor-pointer"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Anterior</span>
                  </motion.button>
                )}

                {!isLast ? (
                  <motion.button
                    type="button"
                    whileTap={tapPress}
                    transition={SPRING_SOFT}
                    onClick={() => goToStep(stepIndex + 1)}
                    className="tactile-key-primary inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-[12.5px] font-medium cursor-pointer"
                  >
                    <span>Siguiente</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </motion.button>
                ) : (
                  <motion.button
                    type="button"
                    whileTap={tapPress}
                    transition={SPRING_SOFT}
                    onClick={() => finishAndNavigate('inicio')}
                    className="tactile-key-primary inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-[12.5px] font-medium cursor-pointer"
                  >
                    <span>Empezar a usar OMEGA</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </motion.button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
  );
}
