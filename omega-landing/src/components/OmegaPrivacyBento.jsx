import { useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Cloud,
  Cpu,
  FileCheck2,
  FileText,
  Globe,
  Laptop,
  Lock,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import { PRIVACY_BENTO_TOP, PRIVACY_DEPLOYMENT_MODES } from '../data/catalog';

const EASE_OUT = [0.22, 1, 0.36, 1];

const BENTO_CARD_CLASS =
  'relative rounded-[24px] bg-gradient-to-br from-white/[0.07] via-[#0B1222]/60 to-[#060912]/80 backdrop-blur-2xl border border-white/[0.11] shadow-[inset_0_1px_1px_rgba(255,255,255,0.18),0_28px_70px_rgba(0,0,0,0.7)] p-7 overflow-hidden';

const TACTILE_NODE_CLASS =
  'bg-gradient-to-b from-[#151E30]/90 to-[#0B101B]/95 rounded-2xl border border-white/[0.08] shadow-[10px_14px_28px_rgba(0,0,0,0.65),-2px_-2px_8px_rgba(255,255,255,0.03),inset_0_1px_0_rgba(255,255,255,0.16)]';

const DEBOSSED_CLASS =
  'bg-[#050810]/85 border border-white/[0.04] shadow-[inset_4px_4px_10px_rgba(0,0,0,0.85),inset_-1px_-1px_4px_rgba(255,255,255,0.05)]';

const POINT_ICONS = {
  zap: Zap,
  sliders: SlidersHorizontal,
  shield: ShieldCheck,
  server: Server,
  cpu: Cpu,
  lock: Lock,
};

function ZeroStorageStage({ active, reducedMotion }) {
  const animateLoop = active && !reducedMotion;

  return (
    <div
      className={`relative h-[220px] rounded-2xl ${DEBOSSED_CLASS} p-5 flex flex-col justify-between overflow-hidden`}
    >
      {/* Conectores SVG con pulso de luz azul rey */}
      <svg
        aria-hidden="true"
        viewBox="0 0 460 120"
        fill="none"
        className="pointer-events-none absolute inset-x-4 top-5 h-[120px] w-[calc(100%-2rem)]"
      >
        <path
          d="M96 60 H188"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <motion.path
          d="M96 60 H188"
          stroke="#60A5FA"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="24 68"
          animate={animateLoop ? { strokeDashoffset: [92, 0] } : { strokeDashoffset: 32 }}
          transition={
            animateLoop ? { duration: 2.2, repeat: Infinity, ease: 'linear' } : undefined
          }
        />
        <path
          d="M272 60 H364"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <motion.path
          d="M272 60 H364"
          stroke="#34D399"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="24 68"
          animate={animateLoop ? { strokeDashoffset: [92, 0] } : { strokeDashoffset: 32 }}
          transition={
            animateLoop
              ? { duration: 2.2, delay: 0.45, repeat: Infinity, ease: 'linear' }
              : undefined
          }
        />
      </svg>

      {/* Flujo de 3 nodos táctiles */}
      <div className="relative z-10 grid grid-cols-3 items-center gap-3 pt-2">
        {/* Nodo 1: Archivo / Respaldo entrando y desvaneciéndose al terminar */}
        <motion.div
          animate={
            animateLoop
              ? { opacity: [1, 1, 0.35, 1], scale: [1, 0.96, 0.85, 1] }
              : { opacity: 1, scale: 1 }
          }
          transition={
            animateLoop
              ? { duration: 3.6, repeat: Infinity, ease: EASE_OUT }
              : undefined
          }
          className={`${TACTILE_NODE_CLASS} p-3 flex flex-col items-center text-center gap-2`}
        >
          <Laptop className="w-4 h-4 text-[#94A3B8]" strokeWidth={1.75} />
          <span className="text-xs font-medium text-[#CBD5E1]">Archivo / Respaldo</span>
        </motion.div>

        {/* Nodo 2: Cápsula central Ω con barrido vertical azul */}
        <div
          className={`${TACTILE_NODE_CLASS} relative p-3.5 flex flex-col items-center text-center gap-2 overflow-hidden border-[#2F6FED]/30`}
        >
          <motion.div
            aria-hidden="true"
            animate={animateLoop ? { y: [-28, 36, -28] } : { y: 0 }}
            transition={
              animateLoop ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } : undefined
            }
            className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-transparent via-[#2F6FED]/30 to-transparent"
          />
          <span className="relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#090F1D] border border-[#60A5FA]/35 text-xs font-semibold text-[#F8FAFC]">
            Ω
          </span>
          <span className="relative z-10 text-xs font-medium text-[#93C5FD]">
            Revisión en memoria
          </span>
        </div>

        {/* Nodo 3: Resultado verificado */}
        <motion.div
          animate={animateLoop ? { opacity: [0.65, 1, 1, 0.65] } : { opacity: 1 }}
          transition={
            animateLoop ? { duration: 3.6, repeat: Infinity, ease: EASE_OUT } : undefined
          }
          className={`${TACTILE_NODE_CLASS} p-3 flex flex-col items-center text-center gap-2 border-emerald-400/25`}
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400" strokeWidth={1.75} />
          <span className="text-xs font-medium text-emerald-400">Resultado verificado</span>
        </motion.div>
      </div>

      {/* Contador táctil hundido */}
      <div className="relative z-10 flex justify-center">
        <div
          className={`${DEBOSSED_CLASS} rounded-full px-4 py-1.5 inline-flex items-center gap-2 text-xs font-mono tabular-nums text-[#CBD5E1]`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
          <span>{PRIVACY_BENTO_TOP.zeroStorage.counterLabel}</span>
        </div>
      </div>
    </div>
  );
}

function TamperProofStage({ active, reducedMotion }) {
  const [hovered, setHovered] = useState(false);
  const animateLoop = active && !reducedMotion;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`relative h-[220px] rounded-2xl ${DEBOSSED_CLASS} p-5 flex flex-col justify-between overflow-hidden`}
    >
      {/* Tarjeta de informe ejecutivo en cristal elevado */}
      <motion.div
        animate={{ rotate: hovered ? 0 : -1.25, y: hovered ? -2 : 0 }}
        transition={{ duration: 0.3, ease: EASE_OUT }}
        className={`${TACTILE_NODE_CLASS} relative mx-auto w-full max-w-[360px] p-4 overflow-hidden`}
      >
        {/* Destello especular diagonal */}
        <motion.div
          aria-hidden="true"
          animate={animateLoop ? { x: [-220, 420] } : { x: 120 }}
          transition={
            animateLoop
              ? { duration: 3.4, repeat: Infinity, repeatDelay: 1.4, ease: 'easeInOut' }
              : undefined
          }
          className="pointer-events-none absolute inset-y-0 w-24 -skew-x-12 bg-gradient-to-r from-transparent via-white/[0.12] to-transparent"
        />

        <div className="relative z-10 flex items-start justify-between gap-3">
          <div className="space-y-2.5 flex-1">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-[#F8FAFC]">
              <FileText className="w-3.5 h-3.5 text-[#60A5FA]" strokeWidth={1.75} />
              <span>{PRIVACY_BENTO_TOP.tamperProof.docLabel}</span>
            </div>
            <div className="space-y-1.5 pt-0.5">
              <div className="h-2 w-4/5 rounded-full bg-white/[0.10]" />
              <div className="h-2 w-3/5 rounded-full bg-white/[0.06]" />
            </div>
          </div>

          {/* Sello digital neomórfico Ω */}
          <div className="h-11 w-11 shrink-0 rounded-xl bg-[#070B14] border border-[#2F6FED]/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_0_20px_rgba(47,111,237,0.22)] flex items-center justify-center">
            <span className="text-sm font-semibold text-[#93C5FD]">Ω</span>
          </div>
        </div>
      </motion.div>

      {/* Píldora luminosa + cadena corta discreta */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#2F6FED]/15 border border-[#60A5FA]/35 px-3 py-1 text-xs font-medium text-[#93C5FD]">
          <FileCheck2 className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>{PRIVACY_BENTO_TOP.tamperProof.pillLabel}</span>
        </span>
        <span className="font-mono text-xs tabular-nums text-[#64748B]">
          {PRIVACY_BENTO_TOP.tamperProof.sealCode}
        </span>
      </div>
    </div>
  );
}

function DeploymentTopology({ mode, active, reducedMotion }) {
  const isPrivate = mode === 'private';
  const animateLoop = active && !reducedMotion;

  return (
    <div
      className={`relative rounded-2xl ${DEBOSSED_CLASS} p-5 md:p-6 min-h-[260px] flex flex-col justify-between gap-5 overflow-hidden`}
    >
      {/* Estado superior de topología */}
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-[#CBD5E1]">
          {isPrivate ? 'Topología · Red Corporativa Privada' : 'Topología · Nube Aislada OMEGA'}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium ${
            isPrivate
              ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/25'
              : 'bg-[#2F6FED]/15 text-[#93C5FD] border border-[#2F6FED]/35'
          }`}
        >
          <Lock className="w-3 h-3" strokeWidth={1.75} />
          {isPrivate ? '0 datos salientes' : 'Aislamiento cifrado'}
        </span>
      </div>

      {/* Diagrama animado con layout transitions */}
      {isPrivate ? (
        <motion.div
          layout
          className="relative rounded-2xl border border-emerald-400/35 bg-gradient-to-br from-[#0F1B26]/80 to-[#08101A]/90 p-4 space-y-4 shadow-[inset_0_1px_0_rgba(52,211,153,0.22)]"
        >
          <p className="text-xs font-medium text-emerald-400">Tu Red Corporativa</p>

          <div className="grid grid-cols-3 gap-3 items-center">
            <motion.div layout className={`${TACTILE_NODE_CLASS} p-3 text-center space-y-1.5`}>
              <Laptop className="w-4 h-4 mx-auto text-[#CBD5E1]" strokeWidth={1.75} />
              <p className="text-xs font-medium text-[#F8FAFC]">Tus equipos</p>
            </motion.div>

            <motion.div
              layout
              className={`${TACTILE_NODE_CLASS} p-3 text-center space-y-1.5 border-[#2F6FED]/40`}
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#2F6FED]/20 text-xs font-semibold text-[#93C5FD]">
                Ω
              </span>
              <p className="text-xs font-medium text-[#F8FAFC]">Núcleo Ω</p>
            </motion.div>

            <motion.div
              layout
              className={`${TACTILE_NODE_CLASS} p-3 text-center space-y-1.5 border-emerald-400/30`}
            >
              <Cpu className="w-4 h-4 mx-auto text-emerald-400" strokeWidth={1.75} />
              <p className="text-xs font-medium text-[#F8FAFC]">IA Privada Local</p>
            </motion.div>
          </div>
        </motion.div>
      ) : (
        <motion.div layout className="relative py-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
            <motion.div layout className={`${TACTILE_NODE_CLASS} p-4 text-center space-y-2`}>
              <Laptop className="w-4 h-4 mx-auto text-[#CBD5E1]" strokeWidth={1.75} />
              <p className="text-xs font-medium text-[#F8FAFC]">Tus equipos</p>
            </motion.div>

            <motion.div
              layout
              className={`${TACTILE_NODE_CLASS} relative p-4 text-center space-y-2 border-[#2F6FED]/45`}
              style={{
                boxShadow:
                  '0 0 28px rgba(47, 111, 237, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.18)',
              }}
            >
              <Cloud className="w-4 h-4 mx-auto text-[#60A5FA]" strokeWidth={1.75} />
              <p className="text-xs font-medium text-[#F8FAFC]">Nube Aislada Ω</p>
              {animateLoop && (
                <motion.span
                  aria-hidden="true"
                  animate={{ opacity: [0.35, 0.9, 0.35] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                  className="pointer-events-none absolute inset-x-4 top-0 h-px bg-[#60A5FA]"
                />
              )}
            </motion.div>

            <motion.div
              layout
              className={`${TACTILE_NODE_CLASS} p-4 text-center space-y-2 border-emerald-400/25`}
            >
              <FileCheck2 className="w-4 h-4 mx-auto text-emerald-400" strokeWidth={1.75} />
              <p className="text-xs font-medium text-[#F8FAFC]">Informe seguro</p>
            </motion.div>
          </div>
        </motion.div>
      )}

      {/* Pie contextual de perímetro */}
      <div
        className={`flex items-center justify-between gap-3 rounded-xl px-4 py-2.5 border transition-opacity duration-300 ${
          isPrivate
            ? 'border-white/[0.06] bg-white/[0.02] opacity-60'
            : 'border-white/[0.06] bg-white/[0.03] opacity-90'
        }`}
      >
        <span className="inline-flex items-center gap-2 text-xs text-[#94A3B8]">
          <Globe className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>{isPrivate ? 'Internet externo bloqueado' : 'Conexión cifrada de extremo a extremo'}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#CBD5E1]">
          <Lock className="w-3.5 h-3.5 text-[#60A5FA]" strokeWidth={1.75} />
          <span>{isPrivate ? '0 datos salientes' : 'Cero retención'}</span>
        </span>
      </div>
    </div>
  );
}

export function OmegaPrivacyBento({ onRequestPilot, onViewPlans }) {
  const sectionRef = useRef(null);
  const inView = useInView(sectionRef, { amount: 0.2 });
  const reducedMotion = useReducedMotion();
  const [deploymentMode, setDeploymentMode] = useState('cloud');

  const activeDeployment =
    PRIVACY_DEPLOYMENT_MODES.find((item) => item.id === deploymentMode) ||
    PRIVACY_DEPLOYMENT_MODES[0];

  return (
    <div ref={sectionRef} className="relative mt-12">
      {/* Luz atmosférica azul rey detrás del Bento para refracción real */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 h-[380px] w-[min(780px,92vw)] rounded-full opacity-[0.28] blur-[100px]"
        style={{
          background:
            'radial-gradient(circle, #2563EB 0%, #1D4ED8 46%, rgba(5, 7, 11, 0) 76%)',
        }}
      />

      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Módulo 1 (Superior Izquierdo): Cero almacenamiento oculto */}
        <article className={`${BENTO_CARD_CLASS} lg:col-span-6 flex flex-col justify-between gap-6`}>
          <ZeroStorageStage active={inView} reducedMotion={Boolean(reducedMotion)} />
          <div>
            <h2 className="text-xl font-medium tracking-[-0.02em] text-[#F8FAFC]">
              {PRIVACY_BENTO_TOP.zeroStorage.title}
            </h2>
            <p className="mt-2 text-sm text-[#94A3B8] leading-relaxed">
              {PRIVACY_BENTO_TOP.zeroStorage.description}
            </p>
          </div>
        </article>

        {/* Módulo 2 (Superior Derecho): Reportes a prueba de alteraciones */}
        <article className={`${BENTO_CARD_CLASS} lg:col-span-6 flex flex-col justify-between gap-6`}>
          <TamperProofStage active={inView} reducedMotion={Boolean(reducedMotion)} />
          <div>
            <h2 className="text-xl font-medium tracking-[-0.02em] text-[#F8FAFC]">
              {PRIVACY_BENTO_TOP.tamperProof.title}
            </h2>
            <p className="mt-2 text-sm text-[#94A3B8] leading-relaxed">
              {PRIVACY_BENTO_TOP.tamperProof.description}
            </p>
          </div>
        </article>

        {/* Módulo 3 (Inferior Ancho Completo): Conmutador Vivo de Despliegue */}
        <article className={`${BENTO_CARD_CLASS} lg:col-span-12 space-y-8`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-xl font-medium tracking-[-0.02em] text-[#F8FAFC]">
              Tú eliges dónde opera OMEGA
            </h2>

            {/* Switch neomórfico hundido con layoutId */}
            <div
              role="tablist"
              aria-label="Modalidad de despliegue"
              className={`inline-flex flex-wrap rounded-full ${DEBOSSED_CLASS} p-1.5`}
            >
              {PRIVACY_DEPLOYMENT_MODES.map((opt) => {
                const isSelected = opt.id === deploymentMode;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setDeploymentMode(opt.id)}
                    className={`relative rounded-full px-4 py-2 text-xs sm:text-sm font-medium transition-colors ${
                      isSelected ? 'text-white' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                    }`}
                  >
                    {isSelected && (
                      <motion.span
                        layoutId="privacy-deployment-pill"
                        transition={{ duration: 0.28, ease: EASE_OUT }}
                        className="absolute inset-0 rounded-full bg-gradient-to-b from-[#3B82F6] to-[#2563EB] shadow-[0_6px_20px_rgba(37,99,235,0.45),inset_0_1px_0_rgba(255,255,255,0.35)]"
                      />
                    )}
                    <span className="relative z-10">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
            <motion.div
              key={activeDeployment.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.26, ease: EASE_OUT }}
              className="lg:col-span-5 space-y-6"
            >
              <div>
                <h3 className="text-2xl font-medium tracking-[-0.025em] text-[#F8FAFC]">
                  {activeDeployment.headline}
                </h3>
                <p className="mt-2.5 text-sm text-[#94A3B8] leading-relaxed">
                  {activeDeployment.description}
                </p>
              </div>

              <ul className="space-y-3.5">
                {activeDeployment.points.map((point) => {
                  const Icon = POINT_ICONS[point.icon] || ShieldCheck;
                  return (
                    <li key={point.text} className="flex items-center gap-3 text-sm text-[#CBD5E1]">
                      <span
                        aria-hidden="true"
                        className="h-8 w-8 shrink-0 rounded-xl bg-gradient-to-b from-[#151E30]/90 to-[#0B101B]/95 border border-white/[0.08] shadow-[6px_8px_16px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.16)] flex items-center justify-center"
                      >
                        <Icon className="w-4 h-4 text-[#60A5FA]" strokeWidth={1.75} />
                      </span>
                      <span>{point.text}</span>
                    </li>
                  );
                })}
              </ul>

              <div className="pt-1 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onRequestPilot}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-sm font-medium h-11 px-5 shadow-[0_0_24px_rgba(47,111,237,0.35)] transition-colors"
                >
                  <Building2 className="w-4 h-4" strokeWidth={1.75} />
                  Solicitar piloto empresarial
                </button>
                <button
                  type="button"
                  onClick={onViewPlans}
                  className="inline-flex items-center gap-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.12] text-sm font-medium text-[#F1F5F9] h-11 px-5 transition-colors"
                >
                  Ver planes
                  <ArrowRight className="w-4 h-4 text-[#60A5FA]" strokeWidth={1.75} />
                </button>
              </div>
            </motion.div>

            <div className="lg:col-span-7">
              <DeploymentTopology
                mode={deploymentMode}
                active={inView}
                reducedMotion={Boolean(reducedMotion)}
              />
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
