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
  Laptop,
  Lock,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import { SpecularCard } from './SpecularCard';
import { PRIVACY_BENTO_TOP, PRIVACY_DEPLOYMENT_MODES } from '../data/catalog';

const SPRING_KOWALSKI = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 };
const ENTRANCE_EASE = [0.22, 1, 0.36, 1];

const POINT_ICONS = {
  zap: Zap,
  sliders: SlidersHorizontal,
  shield: ShieldCheck,
  server: Server,
  cpu: Cpu,
  lock: Lock,
};

function DotGridBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="omega-dot-grid pointer-events-none absolute inset-0 opacity-[0.06] [mask-image:radial-gradient(ellipse_at_center,black_45%,transparent_80%)]"
    />
  );
}

function ZeroStorageStage({ active, reducedMotion }) {
  const animateLoop = active && !reducedMotion;

  return (
    <div className="relative h-[220px] flex flex-col justify-between py-2 overflow-hidden">
      <DotGridBackdrop />

      {/* Flujo horizontal de 3 nodos conectado por líneas SVG con pulso de luz */}
      <div className="relative z-10 flex items-center justify-between gap-2 pt-5">
        {/* Nodo 1: Archivo / Respaldo */}
        <motion.div
          animate={
            animateLoop
              ? { opacity: [1, 1, 0.35, 1], scale: [1, 0.96, 0.86, 1] }
              : { opacity: 1, scale: 1 }
          }
          transition={
            animateLoop ? { duration: 3.6, repeat: Infinity, ease: ENTRANCE_EASE } : undefined
          }
          className="omega-sculpted rounded-2xl px-3 py-3.5 w-[31%] flex flex-col items-center text-center gap-2"
        >
          <Laptop className="w-4 h-4 text-[#94A3B8]" strokeWidth={1.75} />
          <span className="text-xs font-medium text-[#CBD5E1]">Archivo / Respaldo</span>
        </motion.div>

        {/* Conector SVG 1 -> 2 */}
        <svg aria-hidden="true" viewBox="0 0 60 12" fill="none" className="w-10 shrink-0 h-3">
          <line x1="0" y1="6" x2="60" y2="6" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
          <motion.line
            x1="0"
            y1="6"
            x2="60"
            y2="6"
            stroke="#60A5FA"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="16 44"
            animate={animateLoop ? { strokeDashoffset: [60, 0] } : { strokeDashoffset: 20 }}
            transition={
              animateLoop ? { duration: 1.9, repeat: Infinity, ease: 'linear' } : undefined
            }
          />
        </svg>

        {/* Nodo 2: Cápsula protagonista Ω */}
        <div className="omega-sculpted rounded-2xl px-3 py-4 w-[33%] relative flex flex-col items-center text-center gap-2 overflow-hidden">
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

        {/* Conector SVG 2 -> 3 */}
        <svg aria-hidden="true" viewBox="0 0 60 12" fill="none" className="w-10 shrink-0 h-3">
          <line x1="0" y1="6" x2="60" y2="6" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
          <motion.line
            x1="0"
            y1="6"
            x2="60"
            y2="6"
            stroke="#34D399"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="16 44"
            animate={animateLoop ? { strokeDashoffset: [60, 0] } : { strokeDashoffset: 20 }}
            transition={
              animateLoop
                ? { duration: 1.9, delay: 0.4, repeat: Infinity, ease: 'linear' }
                : undefined
            }
          />
        </svg>

        {/* Nodo 3: Resultado verificado */}
        <motion.div
          animate={animateLoop ? { opacity: [0.65, 1, 1, 0.65] } : { opacity: 1 }}
          transition={
            animateLoop ? { duration: 3.6, repeat: Infinity, ease: ENTRANCE_EASE } : undefined
          }
          className="omega-sculpted rounded-2xl px-3 py-3.5 w-[31%] flex flex-col items-center text-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400" strokeWidth={1.75} />
          <span className="text-xs font-medium text-emerald-400">Resultado verificado</span>
        </motion.div>
      </div>

      {/* Píldora hundida 0 B guardados */}
      <div className="relative z-10 flex justify-center pb-1">
        <div className="omega-debossed rounded-full px-4 py-1.5 inline-flex items-center gap-2 text-xs font-mono tabular-nums text-[#CBD5E1]">
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
      className="relative h-[220px] flex flex-col justify-between py-2 overflow-hidden"
    >
      <DotGridBackdrop />

      {/* Documento flotante directamente sobre la SpecularCard */}
      <motion.div
        animate={{ rotate: hovered ? 0 : -1.2, y: hovered ? -2 : 0 }}
        transition={{ duration: 0.3, ease: ENTRANCE_EASE }}
        className="relative z-10 omega-sculpted rounded-2xl mx-auto mt-2 w-full max-w-[360px] p-4 overflow-hidden"
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
              <div className="h-2 w-4/5 rounded-full bg-white/[0.12]" />
              <div className="h-2 w-11/12 rounded-full bg-white/[0.08]" />
              <div className="h-2 w-3/5 rounded-full bg-white/[0.06]" />
            </div>
          </div>

          <div className="omega-debossed h-11 w-11 shrink-0 rounded-xl flex items-center justify-center">
            <span className="text-sm font-semibold text-[#93C5FD]">Ω</span>
          </div>
        </div>
      </motion.div>

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 pb-1">
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
    <div className="relative min-h-[260px] flex flex-col justify-between gap-6 py-2 overflow-hidden">
      <DotGridBackdrop />

      {/* Encabezado de topología: 0 datos salientes aparece SOLO aquí en modo privado */}
      <div className="relative z-10 flex items-center justify-between text-xs">
        <span className="font-medium text-[#CBD5E1]">
          {isPrivate ? 'Topología · Red Corporativa Privada' : 'Topología · Nube Aislada OMEGA'}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ${
            isPrivate
              ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/30'
              : 'bg-[#2F6FED]/15 text-[#93C5FD] border border-[#2F6FED]/35'
          }`}
        >
          <Lock className="w-3 h-3" strokeWidth={1.75} />
          {isPrivate ? '0 datos salientes' : 'Aislamiento cifrado'}
        </span>
      </div>

      {/* Diagrama animado directamente sobre la SpecularCard (cero cajas oscuras anidadas) */}
      {isPrivate ? (
        <motion.div
          layout
          className="relative z-10 rounded-2xl border border-emerald-400/35 p-4 md:p-5 space-y-4"
        >
          <p className="text-xs font-medium text-emerald-400">Tu Red Corporativa</p>

          <div className="flex items-center justify-between gap-2">
            <motion.div layout className="omega-sculpted rounded-2xl p-3 flex-1 text-center space-y-1.5">
              <Laptop className="w-4 h-4 mx-auto text-[#CBD5E1]" strokeWidth={1.75} />
              <p className="text-xs font-medium text-[#F8FAFC]">Tus equipos</p>
            </motion.div>

            <svg aria-hidden="true" viewBox="0 0 48 12" fill="none" className="w-8 shrink-0 h-3">
              <line x1="0" y1="6" x2="48" y2="6" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
              <motion.line
                x1="0"
                y1="6"
                x2="48"
                y2="6"
                stroke="#34D399"
                strokeWidth="2"
                strokeDasharray="14 34"
                animate={animateLoop ? { strokeDashoffset: [48, 0] } : { strokeDashoffset: 16 }}
                transition={
                  animateLoop ? { duration: 1.8, repeat: Infinity, ease: 'linear' } : undefined
                }
              />
            </svg>

            <motion.div layout className="omega-sculpted rounded-2xl p-3 flex-1 text-center space-y-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#2F6FED]/20 text-xs font-semibold text-[#93C5FD]">
                Ω
              </span>
              <p className="text-xs font-medium text-[#F8FAFC]">Núcleo Ω</p>
            </motion.div>

            <svg aria-hidden="true" viewBox="0 0 48 12" fill="none" className="w-8 shrink-0 h-3">
              <line x1="0" y1="6" x2="48" y2="6" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
              <motion.line
                x1="0"
                y1="6"
                x2="48"
                y2="6"
                stroke="#34D399"
                strokeWidth="2"
                strokeDasharray="14 34"
                animate={animateLoop ? { strokeDashoffset: [48, 0] } : { strokeDashoffset: 16 }}
                transition={
                  animateLoop
                    ? { duration: 1.8, delay: 0.35, repeat: Infinity, ease: 'linear' }
                    : undefined
                }
              />
            </svg>

            <motion.div layout className="omega-sculpted rounded-2xl p-3 flex-1 text-center space-y-1.5">
              <Cpu className="w-4 h-4 mx-auto text-emerald-400" strokeWidth={1.75} />
              <p className="text-xs font-medium text-[#F8FAFC]">IA Privada Local</p>
            </motion.div>
          </div>
        </motion.div>
      ) : (
        <motion.div layout className="relative z-10 flex items-center justify-between gap-2 py-4">
          <motion.div layout className="omega-sculpted rounded-2xl p-4 flex-1 text-center space-y-2">
            <Laptop className="w-4 h-4 mx-auto text-[#CBD5E1]" strokeWidth={1.75} />
            <p className="text-xs font-medium text-[#F8FAFC]">Tus equipos</p>
          </motion.div>

          <svg aria-hidden="true" viewBox="0 0 48 12" fill="none" className="w-8 shrink-0 h-3">
            <line x1="0" y1="6" x2="48" y2="6" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
            <motion.line
              x1="0"
              y1="6"
              x2="48"
              y2="6"
              stroke="#60A5FA"
              strokeWidth="2"
              strokeDasharray="14 34"
              animate={animateLoop ? { strokeDashoffset: [48, 0] } : { strokeDashoffset: 16 }}
              transition={
                animateLoop ? { duration: 1.8, repeat: Infinity, ease: 'linear' } : undefined
              }
            />
          </svg>

          <motion.div layout className="omega-sculpted rounded-2xl p-4 flex-1 text-center space-y-2">
            <Cloud className="w-4 h-4 mx-auto text-[#60A5FA]" strokeWidth={1.75} />
            <p className="text-xs font-medium text-[#F8FAFC]">Nube Aislada Ω</p>
          </motion.div>

          <svg aria-hidden="true" viewBox="0 0 48 12" fill="none" className="w-8 shrink-0 h-3">
            <line x1="0" y1="6" x2="48" y2="6" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
            <motion.line
              x1="0"
              y1="6"
              x2="48"
              y2="6"
              stroke="#34D399"
              strokeWidth="2"
              strokeDasharray="14 34"
              animate={animateLoop ? { strokeDashoffset: [48, 0] } : { strokeDashoffset: 16 }}
              transition={
                animateLoop
                  ? { duration: 1.8, delay: 0.35, repeat: Infinity, ease: 'linear' }
                  : undefined
              }
            />
          </svg>

          <motion.div layout className="omega-sculpted rounded-2xl p-4 flex-1 text-center space-y-2">
            <FileCheck2 className="w-4 h-4 mx-auto text-emerald-400" strokeWidth={1.75} />
            <p className="text-xs font-medium text-[#F8FAFC]">Informe seguro</p>
          </motion.div>
        </motion.div>
      )}

      {/* Barra inferior limpia (sin duplicar '0 datos salientes') */}
      <div className="relative z-10 omega-debossed rounded-full px-4 py-2.5 inline-flex items-center gap-2 text-xs text-[#94A3B8] self-start">
        <Lock className="w-3.5 h-3.5 text-[#60A5FA]" strokeWidth={1.75} />
        <span>
          {isPrivate ? 'Internet externo bloqueado' : 'Conexión cifrada de extremo a extremo'}
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
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 h-[380px] w-[min(780px,92vw)] rounded-full opacity-[0.28] blur-[100px]"
        style={{
          background:
            'radial-gradient(circle, #2563EB 0%, #1D4ED8 46%, rgba(5, 7, 11, 0) 76%)',
        }}
      />

      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Módulo 1 */}
        <SpecularCard
          as="article"
          className="lg:col-span-6 rounded-[24px] p-7 flex flex-col justify-between gap-6"
        >
          <ZeroStorageStage active={inView} reducedMotion={Boolean(reducedMotion)} />
          <div className="relative z-10">
            <h2 className="text-xl font-medium tracking-[-0.02em] text-[#F8FAFC] text-balance">
              {PRIVACY_BENTO_TOP.zeroStorage.title}
            </h2>
            <p className="mt-2 text-sm text-[#94A3B8] leading-relaxed">
              {PRIVACY_BENTO_TOP.zeroStorage.description}
            </p>
          </div>
        </SpecularCard>

        {/* Módulo 2 */}
        <SpecularCard
          as="article"
          className="lg:col-span-6 rounded-[24px] p-7 flex flex-col justify-between gap-6"
        >
          <TamperProofStage active={inView} reducedMotion={Boolean(reducedMotion)} />
          <div className="relative z-10">
            <h2 className="text-xl font-medium tracking-[-0.02em] text-[#F8FAFC] text-balance">
              {PRIVACY_BENTO_TOP.tamperProof.title}
            </h2>
            <p className="mt-2 text-sm text-[#94A3B8] leading-relaxed">
              {PRIVACY_BENTO_TOP.tamperProof.description}
            </p>
          </div>
        </SpecularCard>

        {/* Módulo 3 */}
        <SpecularCard as="article" className="lg:col-span-12 rounded-[24px] p-7 space-y-8">
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-xl font-medium tracking-[-0.02em] text-[#F8FAFC] text-balance">
              Tú eliges dónde opera OMEGA
            </h2>

            <div
              role="tablist"
              aria-label="Modalidad de despliegue"
              className="omega-debossed inline-flex flex-wrap rounded-full p-1"
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
                    className={`relative rounded-full px-4 py-2 text-xs sm:text-sm font-medium transition-transform active:scale-[0.97] ${
                      isSelected ? 'text-white' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                    }`}
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="deploy-mode-pill"
                        transition={SPRING_KOWALSKI}
                        className="absolute inset-0 rounded-full bg-gradient-to-b from-[#3B82F6] to-[#2563EB] shadow-[0_6px_20px_rgba(37,99,235,0.45),inset_0_1px_0_rgba(255,255,255,0.35)]"
                      />
                    )}
                    <span className="relative z-10">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
            <motion.div
              key={activeDeployment.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: ENTRANCE_EASE }}
              className="lg:col-span-5 space-y-6"
            >
              <div>
                <h3 className="text-2xl font-medium tracking-[-0.025em] text-[#F8FAFC] text-balance">
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
                        className="omega-sculpted h-8 w-8 shrink-0 rounded-xl flex items-center justify-center"
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
                  className="inline-flex items-center gap-2 rounded-full bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-sm font-medium h-11 px-6 shadow-[0_0_24px_rgba(47,111,237,0.35)] transition-transform active:scale-[0.97]"
                >
                  <Building2 className="w-4 h-4" strokeWidth={1.75} />
                  Solicitar piloto empresarial
                </button>
                <button
                  type="button"
                  onClick={onViewPlans}
                  className="inline-flex items-center gap-2 rounded-full bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.12] text-sm font-medium text-[#F1F5F9] h-11 px-6 transition-transform active:scale-[0.97]"
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
        </SpecularCard>
      </div>
    </div>
  );
}
