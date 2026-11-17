// Preajustes de movimiento compartidos (Framer Motion). Respetan prefers-reduced-motion
// mediante <MotionConfig reducedMotion="user"> definido en main.jsx.

export const EASE_OUT = [0.22, 1, 0.36, 1];

export const SPRING_SOFT = { type: 'spring', stiffness: 260, damping: 28, mass: 0.9 };
export const SPRING_SNAPPY = { type: 'spring', stiffness: 420, damping: 32 };

// Transición entre vistas (Inicio ↔ instrumentos y entre instrumentos).
export const pageVariants = {
  // Sin `filter` ni `scale`: evita re-rasterización subpixel y mantiene `position: fixed`.
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.22, ease: EASE_OUT },
  },
  exit: {
    opacity: 0,
    y: -6,
    transition: { duration: 0.12, ease: 'easeIn' },
  },
};

// Contenedor que escalona a sus hijos.
export const staggerContainer = {
  initial: {},
  animate: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

export const fadeUpItem = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: SPRING_SOFT },
};

// Mensajes de chat.
export const messageVariants = {
  initial: { opacity: 0, y: 14, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1, transition: SPRING_SOFT },
};

// Menús flotantes / modales.
export const popVariants = {
  initial: { opacity: 0, scale: 0.94, y: -6 },
  animate: { opacity: 1, scale: 1, y: 0, transition: SPRING_SNAPPY },
  exit: { opacity: 0, scale: 0.96, y: -4, transition: { duration: 0.12 } },
};

export const backdropVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.16 } },
};

export const drawerVariants = {
  initial: { x: '100%' },
  animate: { x: 0, transition: { type: 'spring', stiffness: 320, damping: 34 } },
  exit: { x: '100%', transition: { duration: 0.2, ease: 'easeIn' } },
};

// Micro-interacción para botones/tarjetas.
export const hoverLift = { y: -2, transition: SPRING_SNAPPY };
export const tapPress = { scale: 0.97 };

// Deslizamiento direccional entre pasos (onboarding / wizards).
export const stepSlideVariants = {
  enter: (direction = 1) => ({
    opacity: 0,
    x: direction >= 0 ? 32 : -32,
    scale: 0.985,
  }),
  center: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { duration: 0.28, ease: EASE_OUT },
  },
  exit: (direction = 1) => ({
    opacity: 0,
    x: direction >= 0 ? -28 : 28,
    scale: 0.985,
    transition: { duration: 0.18, ease: 'easeIn' },
  }),
};
