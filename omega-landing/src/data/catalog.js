/**
 * Catálogo comercial y técnico-ejecutivo de la Landing Page de OMEGA.
 * Sincronizado con PRODUCT.md, docs/perfiles.md y docs/billing-mercadopago.md.
 * Cero jerga técnica visible en la interfaz pública.
 */

export const OMEGA_APP_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OMEGA_APP_URL) ||
  'http://localhost:5173';

export const LANDING_SECTIONS = [
  { id: 'plataforma', label: 'Plataforma' },
  { id: 'perfiles', label: 'Perfiles' },
  { id: 'privacidad', label: 'Privacidad' },
  { id: 'planes', label: 'Planes' },
];

export const HERO_CONTENT = {
  pill: 'Nuevo · Informes con sello digital',
  headline: 'Cada hallazgo, con su prueba.',
  subtitle:
    'Omega revisa dispositivos, código y expedientes, y entrega conclusiones con citas exactas y un sello que nadie puede alterar.',
  ctaPrimary: 'Comenzar gratis',
  ctaSecondary: 'Ver planes',
  microtext: '30 créditos de bienvenida · sin tarjeta',
  preview: {
    sealCode: 'ID · 9F4A-82C1',
    statusLabel: 'Evidencia verificada',
    rows: [
      {
        space: 'General',
        subject: 'Equipo Windows y teléfono USB',
        evidence: 'Procesos y red auditados · Solo lectura',
        badge: 'Sin hallazgos',
      },
      {
        space: 'Desarrollo',
        subject: 'Repositorio plataforma-web',
        evidence: 'Dependencias verificadas · Regla explicable',
        badge: '98 / 100',
      },
      {
        space: 'Legal',
        subject: 'Contrato_servicios_2026.pdf',
        evidence: 'Cláusula de confidencialidad · Pág. 14',
        badge: 'Cita exacta',
      },
    ],
  },
};

export const HERO_SPECS = [
  { value: '0 B', label: 'Rastro en disco' },
  { value: '3', label: 'Espacios integrados' },
  { value: '100%', label: 'Privacidad verificable' },
];

export const PRODUCT_OVERVIEW = {
  headline: 'Defensa preventiva e inteligencia privada en un solo lugar.',
  description:
    'Unifica la revisión de tus equipos, código, enlaces y expedientes en una sola cabina que nunca almacena tus archivos.',
  pillars: [
    {
      id: 'devices',
      icon: 'laptop',
      shortLabel: 'Equipos y celulares',
      summary: 'Inspección pasiva de PC y teléfonos sin modificar archivos.',
      scene: {
        topTag: 'Computador y móvil',
        topTitle: 'Procesos y cable USB verificados',
        topMeta: 'Solo lectura',
        bottomTag: 'Retención en disco',
        bottomValue: '0 bytes',
        bottomBarPercent: 100,
      },
      metrics: [
        { label: 'Retención en disco', value: '0 bytes' },
        { label: 'Operación', value: 'Solo lectura' },
        { label: 'Cobertura', value: 'USB y procesos' },
      ],
      detail:
        'Comprueba la salud de computadores Windows o macOS y analiza teléfonos Android o copias de iPhone buscando amenazas comerciales sin requerir conocimientos técnicos.',
    },
    {
      id: 'links',
      icon: 'globe',
      shortLabel: 'Enlaces y exposición',
      summary: 'Verifica enlaces dudosos antes de abrirlos y mide riesgos públicos.',
      scene: {
        topTag: 'Verificación aislada',
        topTitle: 'Redirecciones analizadas sin riesgo',
        topMeta: 'Entorno temporal',
        bottomTag: 'Exposición controlada',
        bottomValue: '100%',
        bottomBarPercent: 96,
      },
      metrics: [
        { label: 'Ejecución externa', value: 'Aislada' },
        { label: 'Costo por consulta', value: '1 crédito' },
        { label: 'Consentimiento', value: 'Explícito' },
      ],
      detail:
        'Evalúa redirecciones ocultas, suplantación y campañas maliciosas dentro de un entorno efímero antes de que tú o tu equipo hagan clic.',
    },
    {
      id: 'code',
      icon: 'code',
      shortLabel: 'Código y entregas',
      summary: 'Auditoría de repositorios y librerías externas antes de publicar.',
      scene: {
        topTag: 'Espacio Desarrollo',
        topTitle: 'Dependencias y reglas al día',
        topMeta: 'Aislado por proyecto',
        bottomTag: 'Capacidad por análisis',
        bottomValue: '25 MiB',
        bottomBarPercent: 88,
      },
      metrics: [
        { label: 'Escala analizada', value: 'Hasta 25 MiB' },
        { label: 'Criterio', value: 'Reglas reales' },
        { label: 'Control', value: 'Políticas activas' },
      ],
      detail:
        'Detecta riesgos en código propio y librerías de terceros con trazabilidad completa por entrega para decidir con claridad qué sale a producción.',
    },
    {
      id: 'legal',
      icon: 'scale',
      shortLabel: 'Expedientes legales',
      summary: 'Análisis documental privado con citas exactas por página.',
      scene: {
        topTag: 'Expediente reservado',
        topTitle: 'Citas exactas por documento y página',
        topMeta: 'Sin suposiciones',
        bottomTag: 'Trazabilidad legal',
        bottomValue: 'Doc. y página',
        bottomBarPercent: 100,
      },
      metrics: [
        { label: 'Trazabilidad', value: 'Doc. y página' },
        { label: 'Aislamiento', value: 'Por expediente' },
        { label: 'Evidencia', value: 'Cero suposiciones' },
      ],
      detail:
        'Consulta contratos, anexos escaneados y cronologías con citas exactas por página y abstención segura cuando un dato no consta en el expediente.',
    },
  ],
};

export const MANIFESTO_LINES = [
  { id: 'teams', text: 'Un antivirus para tus equipos.' },
  {
    id: 'code-contracts',
    text: 'Otra plataforma para tu código. Chats públicos para tus contratos.',
  },
  {
    id: 'omega-unifies',
    text: 'OMEGA unifica todo en una sola cabina privada, sin guardar tus archivos.',
    highlight: true,
  },
];

export const EDITORIAL_SPACES = [
  {
    id: 'GENERAL',
    indexLabel: '01 / PERSONAL',
    eyebrow: 'Personal',
    label: 'General',
    title: 'Dispositivos y enlaces',
    description:
      'Revisión rápida para computadores, celulares por cable y enlaces sospechosos sin copiar archivos.',
    image: '/media/space-personal.jpg',
    imageAlt: 'Dispositivos personales y teléfono móvil sobre superficie obsidiana',
    modal: {
      targetsLine: 'PC y Mac · Android e iPhone · Enlaces y exposición',
      whatProtects:
        'Computadores de trabajo o uso personal, teléfonos Android y respaldos de iPhone/iPad, además de enlaces y presencia pública expuesta a vigilancia comercial.',
      practices: [
        {
          title: 'Auditoría de solo lectura',
          detail:
            'Revisa procesos activos, defensas del equipo y conexiones salientes sin alterar tus archivos personales.',
        },
        {
          title: 'Inspección móvil directa',
          detail:
            'Analiza teléfonos por cable y copias encriptadas buscando señales de espionaje comercial.',
        },
        {
          title: 'Escudo de enlaces y exposición',
          detail:
            'Verificación pasiva de enlaces sospechosos en entorno aislado y monitoreo público bajo autorización explícita.',
        },
      ],
      deliverable:
        'Informe ejecutivo en PDF con diagnóstico comprensible, evidencia priorizada y sello digital de integridad sin costo adicional.',
      trustNote: 'Sin instalación invasiva · 0 retención',
    },
  },
  {
    id: 'DEVELOPER',
    indexLabel: '02 / DESARROLLO',
    eyebrow: 'Desarrollo',
    label: 'Desarrollo',
    title: 'Código y entregas',
    description:
      'Revisión automática de tu código y librerías externas antes de publicar sin frenar entregas.',
    image: '/media/space-dev.jpg',
    imageAlt: 'Capas de vidrio y metal con haz azul rey para seguridad de software',
    modal: {
      targetsLine: 'Repositorios · Librerías externas · Políticas de entrega',
      whatProtects:
        'Repositorios de código fuente, librerías de terceros y flujos de entrega continua de equipos de tecnología.',
      practices: [
        {
          title: 'Escaneo automático explicable',
          detail:
            'Análisis por enlace o paquete comprimido hasta 25 MiB con puntaje transparente y trazabilidad clara.',
        },
        {
          title: 'Control de dependencias',
          detail:
            'Detección de vulnerabilidades en librerías externas e inteligencia de cadena de suministro con aislamiento por proyecto.',
        },
        {
          title: 'Reglas sin fricción',
          detail:
            'Integración fluida con el trabajo diario de ingeniería y políticas claras para frenar entregas riesgosas a tiempo.',
        },
      ],
      deliverable:
        'Reporte de hallazgos, inventario de dependencias e informe PDF verificable para dirección y auditorías de entrega.',
      trustNote: 'Sin acceso de escritura · 0 retención',
    },
  },
  {
    id: 'LEGAL',
    indexLabel: '03 / LEGAL',
    eyebrow: 'Legal',
    label: 'Legal',
    title: 'Expedientes privados',
    description:
      'Análisis de expedientes confidenciales con citas exactas por página y cero filtraciones.',
    image: '/media/space-legal.jpg',
    imageAlt: 'Expedientes confidenciales oscuros y prisma de cristal sobre piedra negra',
    modal: {
      targetsLine: 'Expedientes · Contratos · Lectura privada',
      whatProtects:
        'Expedientes judiciales, contratos corporativos, anexos escaneados y documentos reservados de firmas y áreas jurídicas.',
      practices: [
        {
          title: 'Citas exactas por página',
          detail:
            'Respuestas respaldadas por documento y número de página, con abstención segura cuando un dato no existe.',
        },
        {
          title: 'Permisos y aislamiento total',
          detail:
            'Control estricto por usuario y búsqueda transversal en el despacho sin mezclar ni filtrar casos entre clientes.',
        },
        {
          title: 'Cronología y documentos largos',
          detail:
            'Construcción automática de línea de tiempo del caso y lectura privada de documentos de hasta 1.000 páginas.',
        },
      ],
      deliverable:
        'Dossier del expediente en PDF con trazabilidad de permisos y firma única que certifica ante terceros que nunca fue alterado.',
      trustNote: 'Citas exactas por página · 0 retención',
    },
  },
];

export const DRIVE_PRIVACY_MODES = [
  {
    id: 'cloud',
    label: 'En la nube',
    headline: 'Operando en minutos.',
    description:
      'Entorno aislado por organización, consumo predecible y cero retención de tus archivos originales.',
  },
  {
    id: 'private',
    label: 'En tu empresa',
    headline: 'Ningún dato sale de tu red.',
    description:
      'Instalado en tus propios servidores con inteligencia artificial privada local, ideal para despachos y sectores regulados.',
  },
];

export const PRIVACY_SPECS = [
  { value: '0 bytes', label: 'Retención en disco' },
  { value: 'Sello digital', label: 'Informes inalterables' },
  { value: '24/7', label: 'Control y trazabilidad' },
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
          ? 'COP · 30 créditos de bienvenida · sin tarjeta'
          : `COP · actualiza a Pro para usar ${spaceLabel}`,
      featured: false,
      ctaLabel: 'Empezar gratis',
      ctaAction: 'register',
      ctaVariant: 'glass',
      features: [
        '30 créditos de bienvenida por única vez',
        '1 usuario y 1 dispositivo vinculado',
        'Revisión de computador y enlaces sospechosos',
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
        '1 puesto y hasta 5 dispositivos vinculados',
        'Acceso completo a tu espacio elegido',
        'Informes PDF con sello digital ilimitados',
        'Recargas de 200 créditos por $29.900 COP',
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
