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
      'Diagnóstico preventivo de tu computador',
      'Detección de espionaje en iPhone y Android por USB',
      'Verificación segura de enlaces antes de abrirlos',
    ],
    preview: {
      greeting: '¡Hola!',
      roleLabel: 'Directivo',
      modules: [
        { name: 'Equipo Local', status: 'Limpio' },
        { name: 'iPhone por USB', status: 'Sin amenazas' },
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
      'Alertas claras y priorizadas en cada cambio',
      'Control automático de librerías externas vulnerables',
      'Informes ejecutivos listos en un clic',
    ],
    preview: {
      repoLabel: 'repositorio-pagos · Rama principal',
      repoBadge: 'Protegido',
      alertBadge: 'Riesgo crítico bloqueado',
      alertTitle: 'Librería externa con vulnerabilidad conocida',
      alertStatus: 'Actualización segura lista · Revisado antes de publicación',
      footerLeft: '0 fallos críticos en producción',
      footerRight: 'Informe PDF disponible',
    },
  },
  {
    id: 'LEGAL',
    label: 'Legal',
    domain: 'Firmas y Despachos',
    headline: 'Analiza expedientes con citas exactas y cero filtraciones.',
    summary: 'Consulta contratos y casos confidenciales en segundos.',
    capabilities: [
      'Cada respuesta cita el documento y la página exacta',
      'Control estricto de acceso por expediente',
      'Resúmenes e informes PDF listos para clientes',
    ],
    preview: {
      caseLabel: 'Expediente #2026-041 · Acceso restringido',
      question: '¿Existe cláusula de penalidad por terminación anticipada?',
      answer:
        'Sí. Se establece un preaviso obligatorio de 30 días y compensación equivalente a un mes de servicio.',
      citation: 'Contrato_Servicios_2026.pdf · Página 14 · Cláusula 8.2',
      verifiedNote: 'Verificado sin copias externas',
    },
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
