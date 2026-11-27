import { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { Plus } from 'lucide-react';
import { EDITORIAL_SPACES } from '../../data/catalog';

const REVEAL_EASE = [0.22, 1, 0.36, 1];

function SpaceCard({ space, idx, scrollYProgress, reducedMotion, onOpenSpace }) {
  const imgY = useTransform(scrollYProgress, [0, 1], ['-5%', '5%']);

  return (
    <motion.article
      initial={reducedMotion ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.16 }}
      transition={{ duration: 0.65, delay: idx * 0.07, ease: REVEAL_EASE }}
      onClick={() => onOpenSpace(space)}
      className="aspect-[3/4] min-h-[540px] rounded-2xl overflow-hidden relative group border border-white/[0.08] bg-[#070A10] cursor-pointer"
    >
      {/* Capa de parallax separada del scale en hover para evitar peleas de transform */}
      <motion.div
        aria-hidden="true"
        style={reducedMotion ? undefined : { y: imgY, scale: 1.1 }}
        className="pointer-events-none absolute inset-0 will-change-transform"
      >
        <img
          src={space.image}
          alt={space.imageAlt}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04]"
        />
      </motion.div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#05070B] via-[#05070B]/75 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#05070B]/60 to-transparent"
      />

      <div className="relative z-10 p-7 flex flex-col justify-between h-full">
        <span className="text-[11px] font-mono tracking-[0.18em] uppercase text-[#E2E8F0]/80">
          {space.indexLabel}
        </span>

        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 className="text-2xl font-medium tracking-[-0.025em] text-[#F8FAFC] text-balance">
              {space.title}
            </h3>
            <p className="text-sm text-[#CBD5E1]/90 mt-2 leading-relaxed">
              {space.description}
            </p>
          </div>

          <button
            type="button"
            aria-label={`Explorar frente ${space.label}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenSpace(space);
            }}
            className="w-10 h-10 rounded-full bg-white/[0.10] backdrop-blur-md border border-white/[0.18] flex items-center justify-center text-white shrink-0 group-hover:bg-[#2F6FED] group-hover:border-[#2F6FED] transition-colors"
          >
            <Plus className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </motion.article>
  );
}

/**
 * Capítulo 3: Galería editorial de 3 frentes con parallax fluido en GPU.
 */
export function SpacesShowcase({ onOpenSpace }) {
  const sectionRef = useRef(null);
  const reducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });

  return (
    <section id="perfiles" ref={sectionRef} className="py-32 md:py-44 bg-[#05070B]">
      <div className="max-w-6xl mx-auto px-6 mb-14">
        <p className="text-xs tracking-[0.2em] uppercase text-[#60A5FA]">
          LOS TRES FRENTES
        </p>
        <h2 className="mt-3 text-4xl md:text-6xl font-medium tracking-[-0.035em] leading-[1.06] text-[#F8FAFC] text-balance">
          Diseñado para cada área crítica.
        </h2>
      </div>

      <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        {EDITORIAL_SPACES.map((space, idx) => (
          <SpaceCard
            key={space.id}
            space={space}
            idx={idx}
            scrollYProgress={scrollYProgress}
            reducedMotion={Boolean(reducedMotion)}
            onOpenSpace={onOpenSpace}
          />
        ))}
      </div>
    </section>
  );
}
