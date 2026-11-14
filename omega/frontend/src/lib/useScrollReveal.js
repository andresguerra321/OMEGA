import { useEffect } from 'react';

function revealElement(el, delayIndex) {
  if (!el) return;
  if (!el.style.animationDelay && el.dataset.stagger !== 'none') {
    const customDelay = el.dataset.delay;
    if (customDelay) {
      el.style.animationDelay = customDelay;
    } else if (delayIndex > 0) {
      el.style.animationDelay = `${Math.min(delayIndex * 55, 220)}ms`;
    }
  }
  el.classList.add('is-visible');
}

/**
 * Scroll-reveal trigger using IntersectionObserver paired with Tailwind `.animate-on-scroll` classes.
 * Includes immediate viewport visibility detection and a reduced-motion bypass so sections never remain hidden.
 */
export function useScrollReveal(containerRef, deps = []) {
  useEffect(() => {
    const rootEl = containerRef?.current;
    if (!rootEl) return undefined;

    const targets = Array.from(rootEl.querySelectorAll('.animate-on-scroll'));
    if (targets.length === 0) return undefined;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    if (prefersReduced || typeof IntersectionObserver === 'undefined') {
      targets.forEach((el) => el.classList.add('is-visible'));
      return undefined;
    }

    let visibleBatch = 0;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            revealElement(entry.target, visibleBatch++);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.06, rootMargin: '0px 0px -16px 0px' },
    );

    const vh = window.innerHeight || 900;
    targets.forEach((el, idx) => {
      const rect = el.getBoundingClientRect();
      if (rect.top < vh * 0.96 && rect.bottom > 0) {
        revealElement(el, idx);
      } else {
        io.observe(el);
      }
    });

    // Fallback safety timer so dynamically resized/tab-switched blocks never stall hidden
    const fallbackTimer = setTimeout(() => {
      targets.forEach((el) => {
        if (!el.classList.contains('is-visible')) {
          const rect = el.getBoundingClientRect();
          if (rect.top < (window.innerHeight || 900) + 120) {
            revealElement(el, 0);
            io.unobserve(el);
          }
        }
      });
    }, 520);

    return () => {
      clearTimeout(fallbackTimer);
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

