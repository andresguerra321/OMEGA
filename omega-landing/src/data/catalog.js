/**
 * Catálogo comercial para la Landing Page de OMEGA (público ejecutivo y directivo).
 * Sincronizado con los planes, precios en COP y límites reales de OMEGA.
 */

export const OMEGA_APP_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OMEGA_APP_URL) ||
  'http://localhost:5173';

export const LANDING_PAGES = [
  { id: 'plataforma', label: 'Plataforma' },
  { id: 'perfiles', label: 'Perfiles' },
  { id: 'seguridad', label: 'Privacidad' },
  { id: 'planes', label: 'Planes' },
];

export const EDITORIAL_SPACES = [
  {
    id: 'GENERAL',
    eyebrow: 'Personal',
    label: 'General',
    title: 'Dispositivos y enlaces',
    description:
      'Revisión rápida para computadores, celulares por USB y enlaces sospechosos sin copiar archivos.',
    image: '/media/space-personal.jpg',
    imageAlt: 'Dispositivos personales y móvil sobre superficie obsidiana',
  },
  {
    id: 'DEVELOPER',
    eyebrow: 'Desarrollo',
    label: 'Desarrollo',
    title: 'Código y entregas',
    description:
      'Revisión automática de tu código y librerías externas antes de publicar sin frenar entregas.',
    image: '/media/space-dev.jpg',
    imageAlt: 'Capas de vidrio y metal con haz azul rey para seguridad de código',
  },
  {
    id: 'LEGAL',
    eyebrow: 'Legal',
    label: 'Legal',
    title: 'Expedientes privados',
    description:
      'Análisis de expedientes confidenciales con citas exactas por página y cero filtraciones.',
    image: '/media/space-legal.jpg',
    imageAlt: 'Expedientes archivados oscuros y prisma de cristal sobre piedra negra',
  },
];

export const PRIVACY_BENTO_TOP = {
  zeroStorage: {
    title: 'Cero almacenamiento oculto',
    description:
      'Tus archivos, respaldos y enlaces se revisan al instante en memoria activa y se descartan automáticamente al emitir el diagnóstico. Nada queda retenido en disco.',
    counterLabel: '0 B guardados',
  },
  tamperProof: {
    title: 'Reportes a prueba de alteraciones',
    description:
      'Cada informe incluye un sello digital único y trazabilidad de permisos que demuestra ante dirección, auditorías o clientes que el documento nunca fue modificado.',
    docLabel: 'Informe Ejecutivo · PDF',
    pillLabel: 'Sello digital íntegro · Inalterable',
    sealCode: 'ID · 9F4A-82C1 · VERIFICADO',
  },
};

export const PRIVACY_DEPLOYMENT_MODES = [
  {
    id: 'cloud',
    label: 'En la nube de OMEGA',
    headline: 'Operando en minutos, sin infraestructura propia.',
    description:
      'Ideal para equipos ágiles, consultores y empresas que quieren protección inmediata con aislamiento total por organización.',
    points: [
      { icon: 'zap', text: 'Activación inmediata sin instalar servidores' },
      { icon: 'sliders', text: 'Consumo predecible con límites claros antes de ejecutar' },
      { icon: 'shield', text: 'Cero retención de tus archivos originales' },
    ],
  },
  {
    id: 'private',
    label: 'Instalado en tu empresa (Modo Privado)',
    headline: 'Control absoluto dentro de tu propia red.',
    description:
      'Pensado para despachos jurídicos, bancos y sectores regulados donde ningún dato puede salir del perímetro corporativo.',
    points: [
      { icon: 'server', text: 'Opera 100% dentro de tus propios servidores' },
      { icon: 'cpu', text: 'Inteligencia artificial privada sin costos por consulta' },
      { icon: 'lock', text: 'Cumplimiento normativo y soberanía total de datos' },
    ],
  },
];

export const PROFILE_ACCESS_NOTES = {
  GENERAL: 'La cuenta individual General incluye acceso gratuito permanente.',
  DEVELOPER: 'El espacio Desarrollo requiere plan Pro o Enterprise.',
  LEGAL: 'El espacio Legal requiere plan Pro o Enterprise.',
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
  const spaceLabel =
    EDITORIAL_SPACES.find((item) => item.id === profileId)?.label || 'General';

  return [
    {
      id: 'FREE',
      name: 'Gratis',
      tagline: 'Para explorar OMEGA en tu equipo personal.',
      priceMonthly: 0,
      priceAnnual: null,
      displayPrice: '$0',
      unitLabel: '/mes',
      subtext:
        profileId === 'GENERAL'
          ? 'COP · sin tarjeta de crédito'
          : `COP · actualiza a Pro para usar ${spaceLabel}`,
      featured: false,
      ctaLabel: 'Empezar gratis',
      ctaAction: 'register',
      ctaVariant: 'glass',
      features: [
        '30 créditos de bienvenida',
        '1 usuario y 1 dispositivo',
        'Revisión de PC y verificador de enlaces',
        'Diagnóstico de celulares con tus créditos',
      ],
    },
    {
      id: 'PRO',
      name: 'Pro',
      badge: 'Recomendado',
      tagline: 'Para profesionales, consultores y directivos.',
      priceMonthly: 59900,
      priceAnnual: 599000,
      displayPrice: isAnnual ? formatCop(599000) : formatCop(59900),
      unitLabel: isAnnual ? '/año' : '/mes',
      subtext: isAnnual
        ? 'COP · equivale a $49.917/mes · ahorras 2 meses'
        : 'COP · o $599.000/año',
      featured: true,
      ctaLabel: 'Elegir Pro',
      ctaAction: 'subscribe',
      ctaVariant: 'primary',
      features: [
        '500 créditos mensuales incluidos',
        'Hasta 5 dispositivos vinculados',
        'Acceso completo a tu espacio elegido',
        'Informes PDF profesionales ilimitados',
        'Recargas opcionales de 200 créditos ($29.900)',
      ],
    },
    {
      id: 'ENTERPRISE',
      name: 'Enterprise',
      tagline: 'Para empresas, equipos técnicos y despachos.',
      priceMonthly: 299900,
      priceAnnual: 2999000,
      displayPrice: isAnnual ? formatCop(2999000) : formatCop(299900),
      unitLabel: isAnnual ? '/año' : '/mes',
      subtext: isAnnual
        ? 'COP · equivale a $249.917/mes · ahorras 2 meses'
        : 'COP · facturación corporativa disponible',
      featured: false,
      ctaLabel: 'Hablar con ventas',
      ctaAction: 'pilot',
      ctaVariant: 'light',
      features: [
        '3.000 créditos mensuales compartidos',
        '5 puestos de equipo y 25 dispositivos',
        'Gestión de permisos y auditoría central',
        'Opción de instalación privada en tu empresa',
        'Piloto guiado y soporte prioritario',
      ],
    },
  ];
}
