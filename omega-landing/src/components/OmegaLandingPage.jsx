import { useCallback, useEffect, useRef, useState } from 'react';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useReducedMotion } from 'framer-motion';
import { LANDING_SECTIONS, OMEGA_APP_URL } from '../data/catalog';
import { Navbar } from './sections/Navbar';
import { HeroKeynote } from './sections/HeroKeynote';
import { ProductOverviewSection } from './sections/ProductOverviewSection';
import { ManifestoReveal } from './sections/ManifestoReveal';
import { SpacesShowcase } from './sections/SpacesShowcase';
import { SpaceModal } from './sections/SpaceModal';
import { DriveModePrivacy } from './sections/DriveModePrivacy';
import { PricingSection } from './sections/PricingSection';
import { FinalKeynote } from './sections/FinalKeynote';
import { Footer } from './sections/Footer';
import { PilotRequestModal } from './sections/PilotRequestModal';

const VALID_SECTIONS = new Set(LANDING_SECTIONS.map((s) => s.id));

function readSectionFromHash() {
  if (typeof window === 'undefined') return 'plataforma';
  const raw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
  return VALID_SECTIONS.has(raw) ? raw : 'plataforma';
}

/**
 * Orquestador principal con Lenis acoplado directamente al ticker de GSAP ScrollTrigger.
 */
export function OmegaLandingPage({ onEnterApp }) {
  const grainUri =
    "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

  const [activeSection, setActiveSection] = useState(readSectionFromHash);
  const [selectedSpace, setSelectedSpace] = useState(null);
  const [pricingProfile, setPricingProfile] = useState('GENERAL');
  const [pilotModalOpen, setPilotModalOpen] = useState(false);

  const reducedMotion = useReducedMotion();
  const lenisRef = useRef(null);

  const scrollToTarget = useCallback((target, options = {}) => {
    if (typeof window === 'undefined') return;
    if (lenisRef.current && !options.immediate) {
      lenisRef.current.scrollTo(target, {
        duration: 1.05,
        easing: (t) => 1 - Math.pow(1 - t, 4),
        ...options,
      });
    } else if (typeof target === 'number') {
      window.scrollTo?.({ top: target, behavior: options.immediate ? 'instant' : 'smooth' });
    } else if (target?.scrollIntoView) {
      target.scrollIntoView({
        behavior: options.immediate ? 'instant' : 'smooth',
        block: 'start',
      });
    }
  }, []);

  const scrollToSection = useCallback(
    (sectionId, immediate = false) => {
      if (!VALID_SECTIONS.has(sectionId)) return;
      setActiveSection(sectionId);
      if (typeof window === 'undefined') return;

      const targetHash = `#${sectionId}`;
      if (window.location.hash !== targetHash) {
        window.history.pushState(null, '', targetHash);
      }

      const targetEl = document.getElementById(sectionId);
      if (targetEl) {
        scrollToTarget(targetEl, { immediate });
      }
    },
    [scrollToTarget],
  );

  // Sincronización obligatoria Lenis + GSAP ticker + ScrollTrigger
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      reducedMotion ||
      typeof window.requestAnimationFrame !== 'function'
    ) {
      return undefined;
    }

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({
      lerp: 0.085,
      smoothWheel: true,
      wheelMultiplier: 0.95,
    });
    lenisRef.current = lenis;

    lenis.on('scroll', ScrollTrigger.update);

    const tick = (time) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    const onLoadRefresh = () => ScrollTrigger.refresh();
    window.addEventListener('load', onLoadRefresh);

    return () => {
      window.removeEventListener('load', onLoadRefresh);
      gsap.ticker.remove(tick);
      lenis.off('scroll', ScrollTrigger.update);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [reducedMotion]);

  // Pausar Lenis cuando hay un modal abierto
  useEffect(() => {
    const lenis = lenisRef.current;
    if (!lenis) return;
    if (selectedSpace || pilotModalOpen) {
      lenis.stop();
    } else {
      lenis.start();
    }
  }, [selectedSpace, pilotModalOpen]);

  // Seguimiento de capítulo activo
  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const elements = LANDING_SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean);
    if (!elements.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) {
          setActiveSection(visible.target.id);
        }
      },
      { rootMargin: '-25% 0px -45% 0px', threshold: [0.1, 0.35, 0.6] },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Navegación inicial y por hash
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const initialId = readSectionFromHash();
    if (window.location.hash && VALID_SECTIONS.has(initialId)) {
      document.getElementById(initialId)?.scrollIntoView?.({ behavior: 'instant', block: 'start' });
    }
    const onHashChange = () => {
      scrollToSection(readSectionFromHash());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [scrollToSection]);

  function navigateToApp(intent = 'login') {
    if (typeof onEnterApp === 'function') {
      onEnterApp(intent);
      return;
    }
    if (typeof window !== 'undefined') {
      const base = OMEGA_APP_URL.replace(/\/+$/, '');
      window.open(intent === 'register' ? `${base}/?auth=register` : base, '_self');
    }
  }

  function handleSelectPlanForSpace(spaceId) {
    setPricingProfile(spaceId);
    setSelectedSpace(null);
    scrollToSection('planes');
  }

  return (
    <div className="min-h-screen w-full bg-[#05070B] text-[#F8FAFC] antialiased flex flex-col overflow-x-clip">
      {/* Grano óptico SVG estático ligero */}
      <div
        aria-hidden="true"
        className="opacity-[0.02] pointer-events-none fixed inset-0 z-50"
        style={{ backgroundImage: grainUri, backgroundSize: '180px 180px' }}
      />

      <Navbar
        activeSection={activeSection}
        onNavigateSection={(id) => scrollToSection(id)}
        onLogin={() => navigateToApp('login')}
        onRequestPilot={() => setPilotModalOpen(true)}
      />

      <main className="flex-1">
        <HeroKeynote
          onStartFree={() => navigateToApp('register')}
          onLearnMore={() => scrollToSection('producto')}
          onViewPlans={() => scrollToSection('planes')}
        />

        <ProductOverviewSection
          onScrollToOffset={(targetY) => scrollToTarget(targetY)}
          onExploreSpaces={() => scrollToSection('espacios')}
        />

        <ManifestoReveal />

        <SpacesShowcase onOpenSpace={(space) => setSelectedSpace(space)} />

        <DriveModePrivacy />

        <PricingSection
          pricingProfile={pricingProfile}
          onChangeProfile={setPricingProfile}
          onStartApp={navigateToApp}
          onRequestPilot={() => setPilotModalOpen(true)}
        />

        <FinalKeynote
          onStartFree={() => navigateToApp('register')}
          onRequestPilot={() => setPilotModalOpen(true)}
        />
      </main>

      <Footer onOpenLegalApp={navigateToApp} />

      <SpaceModal
        space={selectedSpace}
        onClose={() => setSelectedSpace(null)}
        onSelectPlanForSpace={handleSelectPlanForSpace}
      />

      <PilotRequestModal
        open={pilotModalOpen}
        onClose={() => setPilotModalOpen(false)}
        onEnterApp={(intent) => {
          setPilotModalOpen(false);
          navigateToApp(intent);
        }}
      />
    </div>
  );
}
