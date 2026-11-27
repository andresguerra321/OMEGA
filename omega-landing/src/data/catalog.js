/**
 * Catálogo comercial para la Landing Page de OMEGA (público ejecutivo y directivo).
 * Sincronizado con los planes, precios en COP y límites reales de OMEGA.
 */

export const OMEGA_APP_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OMEGA_APP_URL) ||
  'http://localhost:5173';

export const OMEGA_HERO_IMAGE = '/media/omega-general.png';

export const OMEGA_DEMO_VIDEO = {
  src: '/media/omega-demo.mp4',
  poster: '/media/omega-general.png',
  headline: 'Así se siente tener el control en una sola pantalla.',
  subtitle:
    'Un recorrido real por OMEGA: revisión de equipos, protección de software y análisis documental confidencial.',
  highlights: [
    {
      title: 'Revisión sin copias',
      detail: 'Inspecciona computadores y celulares sin almacenar archivos personales.',
    },
    {
      title: 'Seguridad para tu software',
      detail: 'Detecta riesgos en el código de tu equipo antes de salir a producción.',
    },
    {
      title: 'Asistente para expedientes',
      detail: 'Resume y verifica contratos o casos largos citando siempre la página exacta.',
    },
  ],
};

export const LANDING_PAGES = [
  { id: 'plataforma', label: 'Plataforma' },
  { id: 'demo', label: 'Demostración' },
  { id: 'perfiles', label: 'Perfiles' },
  { id: 'seguridad', label: 'Privacidad' },
  { id: 'planes', label: 'Planes' },
];

export const HERO_PILLARS = [
  {
    title: 'Cero rastro',
    detail: 'Nada se guarda ni se copia. Tus archivos se revisan al instante y desaparecen al terminar.',
  },
  {
    title: 'Contra espionaje real',
    detail: 'Detecta amenazas avanzadas en computadores y teléfonos móviles en minutos.',
  },
  {
    title: 'Privacidad absoluta',
    detail: 'Opción de trabajar 100% dentro de tu empresa, sin enviar un solo dato a terceros.',
  },
  {
    title: 'Informes verificables',
    detail: 'Cada revisión genera un reporte profesional listo para dirección, auditoría o clientes.',
  },
];

export const LANDING_PROFILES = [
  {
    id: 'GENERAL',
    label: 'General',
    domain: 'Protección Personal y Ejecutiva',
    headline: 'Revisa computadores y celulares sin copiar tu información privada.',
    summary:
      'Ideal para directivos, periodistas, independientes y familias que necesitan saber si sus dispositivos o enlaces son seguros.',
    image: '/media/omega-general.png',
    imageAlt: 'Vista principal del espacio General en OMEGA',
    capabilities: [
      {
        title: 'Revisión rápida de tu PC',
        detail: 'Identifica programas ocultos o comportamientos anómalos sin tocar tus documentos.',
      },
      {
        title: 'Diagnóstico de celulares por USB',
        detail: 'Conecta iPhone o Android y verifica señales de espionaje en minutos.',
      },
      {
        title: 'Verificador seguro de enlaces',
        detail: 'Comprueba links sospechosos antes de abrirlos, sin exponerte al sitio.',
      },
    ],
  },
  {
    id: 'DEVELOPER',
    label: 'Desarrollo',
    domain: 'Equipos de Tecnología',
    headline: 'Encuentra fallos de seguridad en tu código antes que tus clientes.',
    summary:
      'Conecta tus repositorios y recibe alertas claras, priorizadas y listas para corregir sin frenar las entregas.',
    image: '/media/omega-developer.png',
    imageAlt: 'Vista de revisión de software y alertas del espacio Desarrollo en OMEGA',
    capabilities: [
      {
        title: 'Auditoría automática de repositorios',
        detail: 'Revisa cada cambio nuevo y bloquea riesgos críticos a tiempo.',
      },
      {
        title: 'Control de librerías externas',
        detail: 'Detecta componentes vulnerables de terceros antes de publicar.',
      },
      {
        title: 'Reportes listos para auditoría',
        detail: 'Descarga informes ejecutivos y técnicos en un clic.',
      },
    ],
  },
  {
    id: 'LEGAL',
    label: 'Legal',
    domain: 'Firmas y Despachos Jurídicos',
    headline: 'Analiza expedientes confidenciales con citas exactas y cero filtraciones.',
    summary:
      'Organiza casos sensibles, detecta conflictos de interés y consulta cientos de páginas en segundos.',
    image: '/media/omega-legal.png',
    imageAlt: 'Vista de verificación de documentos con citas en el espacio Legal de OMEGA',
    capabilities: [
      {
        title: 'Respuestas siempre respaldadas',
        detail: 'Cada conclusión cita el documento y la página exacta; si no hay prueba, no inventa.',
      },
      {
        title: 'Control por expediente',
        detail: 'Define quién puede ver cada caso y mantén trazabilidad completa.',
      },
      {
        title: 'Informes ejecutivos en PDF',
        detail: 'Genera resúmenes y líneas de tiempo listas para presentar a socios o clientes.',
      },
    ],
  },
];

export const PRIVACY_GUARANTEES = [
  {
    id: 'no-storage',
    title: 'Cero almacenamiento oculto',
    detail:
      'Los archivos y respaldos que analizas se descartan automáticamente al emitir tu resultado.',
  },
  {
    id: 'tamper-proof',
    title: 'Reportes a prueba de alteraciones',
    detail:
      'Cada informe incluye un sello digital único que demuestra su autenticidad e integridad.',
  },
  {
    id: 'deployment-choice',
    title: 'Tú eliges dónde opera',
    detail:
      'Empieza hoy en nuestra nube aislada o instálalo en los servidores privados de tu empresa.',
  },
];

export const DEPLOYMENT_OPTIONS = [
  {
    id: 'cloud',
    title: 'En la nube de OMEGA',
    points: [
      'Listo en minutos',
      'Sin instalación de servidores',
      'Consumo predecible con límites claros',
      'Cero retención de tus archivos',
    ],
  },
  {
    id: 'private',
    title: 'Instalado en tu empresa (Modo Privado)',
    points: [
      'Corre 100% en tu propia red',
      'Inteligencia artificial privada sin costos por consulta',
      'Control normativo total para sectores regulados',
    ],
  },
];

export const PROFILE_ACCESS_NOTES = {
  GENERAL:
    'La cuenta individual General incluye acceso gratuito permanente con 30 créditos de bienvenida.',
  DEVELOPER:
    'Los espacios de Desarrollo y empresas operan bajo membresía Pro o Enterprise.',
  LEGAL:
    'Los despachos y firmas legales operan bajo membresía Pro o Enterprise con acceso controlado por caso.',
};

export const LANDING_FAQ = [
  {
    q: '¿Qué pasa si uso todos los créditos del mes?',
    a: 'Nunca se generan cobros sorpresa ni recargas automáticas. Puedes esperar a la renovación mensual o comprar un paquete adicional de 200 créditos por $29.900 COP con 12 meses de vigencia.',
  },
  {
    q: '¿Mis archivos o documentos privados quedan guardados en OMEGA?',
    a: 'No. Los archivos, respaldos de teléfonos y enlaces revisados se descartan automáticamente al terminar el diagnóstico. Solo conservas tus resultados e informes si decides guardarlos.',
  },
  {
    q: '¿Descargar informes en PDF tiene algún costo adicional?',
    a: 'No. Generar y descargar reportes profesionales desde revisiones ya hechas cuesta 0 créditos e incluye un sello digital único para comprobar que no fueron alterados.',
  },
  {
    q: '¿Puedo cancelar o cambiar mi suscripción cuando quiera?',
    a: 'Sí. Si cancelas la renovación conservas el acceso y los créditos restantes hasta finalizar el período que ya pagaste, sin permanencias ni penalidades.',
  },
];

export const PILOT_SUMMARY_TEXT = [
  'OMEGA · Resumen de Piloto Empresarial',
  'Plan Enterprise: $299.900 COP/mes o $2.999.000 COP/año (ahorro de 2 meses)',
  'Capacidad inicial: 5 puestos de equipo · 25 dispositivos · 3.000 créditos mensuales',
  'Espacios incluidos: General (equipos y celulares), Desarrollo (código y librerías) y Legal (expedientes)',
  'Despliegue: Nube aislada de OMEGA o instalación privada dentro de tu empresa',
].join('\n');

export function formatCop(amount) {
  if (amount === 0) return '$0';
  return `$${amount.toLocaleString('es-CO')}`;
}

export function getPlansForProfile(profileId, billingCycle) {
  const isAnnual = billingCycle === 'annual';
  const isGeneral = profileId === 'GENERAL';

  const freeBulletThird =
    profileId === 'DEVELOPER'
      ? 'Acceso inicial al espacio personal mientras activas Desarrollo'
      : profileId === 'LEGAL'
        ? 'Acceso inicial al espacio personal mientras activas Legal'
        : 'Revisión de PC y verificador de enlaces';

  const proProfileBullet =
    profileId === 'DEVELOPER'
      ? 'Auditoría automática de código, repositorios y librerías externas'
      : profileId === 'LEGAL'
        ? 'Expedientes confidenciales, citas exactas y control de acceso por caso'
        : 'Diagnóstico completo de PC, celulares y alertas de exposición';

  return [
    {
      id: 'FREE',
      name: 'Gratis',
      tagline: isGeneral
        ? 'Evaluación inmediata y protección personal en tu equipo.'
        : 'Crea tu cuenta y explora la plataforma antes de suscribirte.',
      priceMonthly: 0,
      priceAnnual: null,
      displayPrice: '$0',
      periodLabel: 'COP · sin tarjeta',
      annualSubtext: isGeneral
        ? 'Gratis para cuenta individual General'
        : 'Actualiza a Pro para activar este espacio',
      creditsLabel: '30 créditos de bienvenida',
      creditsEquivalence:
        '30 créditos permiten realizar tus primeras revisiones de equipo, enlaces o un teléfono.',
      seatsLabel: '1 usuario · 1 dispositivo',
      featured: false,
      ctaLabel: 'Crear cuenta',
      ctaAction: 'register',
      features: [
        '30 créditos de bienvenida',
        '1 usuario y 1 dispositivo',
        freeBulletThird,
        'Diagnóstico de celulares con tus créditos',
      ],
    },
    {
      id: 'PRO',
      name: 'Pro',
      tagline: 'Capacidad completa para profesionales independientes y directivos.',
      priceMonthly: 59900,
      priceAnnual: 599000,
      displayPrice: isAnnual ? formatCop(599000) : formatCop(59900),
      periodLabel: isAnnual ? 'COP / año' : 'COP / mes',
      annualSubtext: isAnnual
        ? 'Equivale a $49.917 COP/mes · ahorras $119.800 (2 meses)'
        : 'O $599.000 COP/año con 2 meses de ahorro',
      creditsLabel: '500 créditos / mes',
      creditsEquivalence:
        '500 créditos cubren decenas de revisiones completas de equipos o análisis documentales al mes.',
      seatsLabel: '1 titular · hasta 5 dispositivos',
      featured: true,
      ctaLabel: 'Suscribirse con Mercado Pago',
      ctaAction: 'subscribe',
      features: [
        '500 créditos mensuales (recargas opcionales de 200 por $29.900 COP)',
        '1 titular y hasta 5 dispositivos',
        proProfileBullet,
        'Informes PDF profesionales ilimitados (0 créditos)',
      ],
    },
    {
      id: 'ENTERPRISE',
      name: 'Enterprise',
      tagline: 'Para empresas, equipos de ingeniería y despachos jurídicos.',
      priceMonthly: 299900,
      priceAnnual: 2999000,
      displayPrice: isAnnual ? formatCop(2999000) : formatCop(299900),
      periodLabel: isAnnual ? 'COP / año' : 'COP / mes',
      annualSubtext: isAnnual
        ? 'Equivale a $249.917 COP/mes · ahorras $599.800 (2 meses)'
        : 'O $2.999.000 COP/año · facturación corporativa disponible',
      creditsLabel: '3.000 créditos / mes',
      creditsEquivalence:
        '3.000 créditos respaldan auditorías continuas de múltiples equipos, software y expedientes.',
      seatsLabel: '5 puestos de equipo · 25 dispositivos',
      featured: false,
      ctaLabel: 'Solicitar piloto empresarial',
      ctaAction: 'pilot',
      features: [
        '3.000 créditos mensuales compartidos',
        '5 puestos de equipo y hasta 25 dispositivos',
        'Gestión centralizada de permisos y auditoría',
        'Opción de instalación privada en tu empresa, piloto guiado y facturación corporativa',
      ],
    },
  ];
}
