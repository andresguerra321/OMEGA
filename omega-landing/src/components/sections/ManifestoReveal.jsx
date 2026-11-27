import { useMemo, useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { MANIFESTO_LINES } from '../../data/catalog';

function KineticWord({ word, start, end, scrollYProgress, reducedMotion, highlight }) {
  const opacity = useTransform(scrollYProgress, [start, end], [0.16, 1]);
  const y = useTransform(scrollYProgress, [start, end], [8, 0]);

  if (reducedMotion) {
    return (
      <span className={highlight ? 'text-[#F8FAFC]' : 'text-[#CBD5E1]'}>{word}</span>
    );
  }

  return (
    <motion.span
      aria-hidden="true"
      style={{ opacity, y }}
      className={`inline-block will-change-transform ${
        highlight ? 'text-[#F8FAFC]' : 'text-[#CBD5E1]'
      }`}
    >
      {word}
    </motion.span>
  );
}

function ManifestoPhrase({ item, rangeStart, rangeEnd, scrollYProgress, reducedMotion }) {
  const words = useMemo(() => item.text.split(/\s+/), [item.text]);
  const glowOpacity = useTransform(scrollYProgress, [rangeStart, rangeEnd], [0, 0.36]);

  const spanPerWord = (rangeEnd - rangeStart) / Math.max(words.length, 1);

  const sentence = (
    <p
      aria-label={item.text}
      className="relative z-10 text-3xl sm:text-4xl md:text-5xl font-medium tracking-[-0.035em] leading-[1.15] text-balance"
    >
      {words.map((word, idx) => {
        const wordStart = rangeStart + idx * spanPerWord * 0.72;
        const wordEnd = Math.min(0.98, wordStart + Math.max(spanPerWord * 1.9, 0.1));
        return (
          <span key={`${item.id}-${idx}`}>
            <KineticWord
              word={word}
              start={wordStart}
              end={wordEnd}
              scrollYProgress={scrollYProgress}
              reducedMotion={reducedMotion}
              highlight={Boolean(item.highlight)}
            />
            {idx < words.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </p>
  );

  if (item.highlight) {
    return (
      <div className="relative">
        <motion.div
          aria-hidden="true"
          style={reducedMotion ? { opacity: 0.32 } : { opacity: glowOpacity }}
          className="pointer-events-none absolute -inset-x-8 -inset-y-6 rounded-full"
        >
          <div
            className="w-full h-full rounded-full"
            style={{
              background:
                'radial-gradient(ellipse 60% 55% at 35% 50%, rgba(47, 111, 237, 0.28) 0%, rgba(5, 7, 11, 0) 72%)',
            }}
          />
        </motion.div>
        {sentence}
      </div>
    );
  }

  return sentence;
}

/**
 * Capítulo 2: Tipografía cinética por palabra en GPU (sin blur por frame) ligada a Lenis.
 */
export function ManifestoReveal() {
  const sectionRef = useRef(null);
  const reducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start 0.85', 'center 0.35'],
  });

  const ranges = [
    [0.0, 0.32],
    [0.24, 0.62],
    [0.52, 0.96],
  ];

  return (
    <section ref={sectionRef} className="py-36 md:py-48 bg-[#05070B]">
      <div className="max-w-4xl mx-auto px-6 space-y-10 md:space-y-14">
        {MANIFESTO_LINES.map((item, idx) => {
          const [start, end] = ranges[idx] || [0, 1];
          return (
            <ManifestoPhrase
              key={item.id}
              item={item}
              rangeStart={start}
              rangeEnd={end}
              scrollYProgress={scrollYProgress}
              reducedMotion={Boolean(reducedMotion)}
            />
          );
        })}
      </div>
    </section>
  );
}
