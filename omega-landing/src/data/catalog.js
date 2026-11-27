/**
 * Catálogo comercial para la Landing Page de OMEGA (público ejecutivo y directivo).
 * Sincronizado con los planes, precios en COP y límites reales de OMEGA.
 */

export const OMEGA_APP_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OMEGA_APP_URL) ||
  'http://localhost:5173';

export const OMEGA_DEMO_VIDEO = {
  src: '/media/omega-demo.mp4',
};

export const LANDING_PAGES = [
  { id: 'plataforma', label: 'Plataforma' },
  { id: 'perfiles', label: 'Perfiles' },
  { id: 'seguridad', label: 'Privacidad' },
  { id: 'planes', label: 'Planes' },
];

export const HERO_DISCRETE_CONCEPTS = [
  'Cero rastro',
  'Contra espionaje real',
  'Privacidad absoluta',
  'Informes verificables',
];

export const LANDING_PROFILES = [
  {
    id: 'GENERAL',
    label: 'General',
    domain: 'Personal y Directivo',
    headline: 'Protege tus dispositivos sin copiar tus archivos.',
    summary: 'Revisión rápida para computadores, celulares y enlaces sospechosos.',
    capabilities: [
      {
        icon: 'laptop',
        title: 'Revisión silenciosa de tu computador',
        detail:
          'Detecta programas ocultos y actividad inusual sin tocar tus documentos personales.',
      },
      {
        icon: 'smartphone',
        title: 'Diagnóstico de celulares por USB',
        detail:
          'Conecta iPhone o Android y descarta señales de espionaje en cuestión de minutos.',
      },
      {
        icon: 'globe',
        title: 'Escudo preventivo de enlaces',
        detail:
          'Verifica links y correos sospechosos antes de abrirlos, sin exponerte al sitio.',
      },
    ],
    preview: {
      greeting: '¡Hola!',
      roleLabel: 'Directivo',
      modules: [
        { name: 'Equipo Local', status: 'Limpio' },
        { name: 'Celular USB', status: 'Sin amenazas' },
        { name: 'Escudo Web', status: 'Activo' },
      ],
    },
  },
  {
    id: 'DEVELOPER',
    label: 'Desarrollo',
    domain: 'Equipos de Tecnología',
    headline: 'Detén fallos de seguridad antes de publicar.',
    summary: 'Revisión automática de tu código y dependencias sin frenar entregas.',
    capabilities: [
      {
        icon: 'git',
        title: 'Revisión continua de tu código',
        detail:
          'Analiza cada cambio automáticamente y señala únicamente los riesgos que sí importan.',
      },
      {
        icon: 'package',
        title: 'Control de librerías de terceros',
        detail:
          'Detecta componentes externos vulnerables antes de que lleguen a tus clientes.',
      },
      {
        icon: 'file',
        title: 'Informes ejecutivos en un clic',
        detail:
          'Traduce hallazgos técnicos a reportes claros para dirección y auditorías.',
      },
    ],
    preview: {
      repoLabel: 'repositorio-pagos · Rama principal',
      repoBadge: 'Protegido',
      alertBadge: 'Riesgo crítico detenido',
      alertTitle: 'Librería externa con vulnerabilidad conocida',
      alertSubtitle: 'Actualización segura lista antes de publicación',
      progressLabel: 'Verificación completada',
      footerLeft: '0 fallos en producción',
      footerRight: 'Informe PDF listo',
    },
  },
  {
    id: 'LEGAL',
    label: 'Legal',
    domain: 'Firmas y Despachos',
    headline: 'Analiza expedientes con citas exactas y cero filtraciones.',
    summary: 'Consulta contratos y casos confidenciales en segundos.',
    capabilities: [
      {
        icon: 'quote',
        title: 'Respuestas 100% respaldadas',
        detail:
          'Cada hallazgo señala el documento y la página exacta; si no existe evidencia, no inventa.',
      },
      {
        icon: 'lock',
        title: 'Control estricto por expediente',
        detail:
          'Separa casos confidenciales con permisos individuales y trazabilidad completa.',
      },
      {
        icon: 'briefcase',
        title: 'Resúmenes listos para clientes',
        detail:
          'Genera cronologías e informes en PDF en segundos sin subir archivos a terceros.',
      },
    ],
    preview: {
      caseLabel: 'Expediente #2026-041',
      accessBadge: 'Acceso restringido',
      question: '¿Existe cláusula de penalidad por terminación anticipada?',
      answer:
        'Sí. Preaviso obligatorio de 30 días y compensación equivalente a un mes de servicio.',
      citation: 'Contrato_Servicios_2026.pdf · Pág. 14 · Cláusula 8.2',
      verifiedNote: 'Verificado sin copias externas',
    },
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
    LANDING_PROFILES.find((item) => item.id === profileId)?.label || 'General';

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
