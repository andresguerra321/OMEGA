/**
 * Catálogo técnico y comercial de la Landing Page de OMEGA.
 * Fuente única sincronizada con PRODUCT.md, docs/perfiles.md,
 * docs/commercial-readiness.md y docs/billing-mercadopago.md.
 */

export const OMEGA_APP_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OMEGA_APP_URL) ||
  'http://localhost:5173';

export const OMEGA_DEMO_VIDEO = {
  youtubeId: 'h8RutTVyJzY',
  watchUrl: 'https://youtu.be/h8RutTVyJzY',
  embedUrl:
    'https://www.youtube-nocookie.com/embed/h8RutTVyJzY?autoplay=1&rel=0&modestbranding=1',
  poster: '/landing/omega-v2-0-1-showcase.jpg',
  title: 'Demostración oficial de OMEGA v2.2',
  highlights: [
    {
      label: 'Inspección en RAM',
      detail: 'Auditoría local de PC y triaje USB Android/iOS sin persistir archivos fuente en disco.',
    },
    {
      label: 'AppSec & SBOM',
      detail: 'Escaneo de repositorios GitHub, inventario CycloneDX/SPDX y salida SARIF para CI.',
    },
    {
      label: 'Módulo Legal',
      detail: 'Expedientes confidenciales con citas obligatorias por página y abstención determinista.',
    },
  ],
};

export const LANDING_PAGES = [
  { id: 'plataforma', label: 'Plataforma' },
  { id: 'demo', label: 'Demostración' },
  { id: 'perfiles', label: 'Perfiles' },
  { id: 'seguridad', label: 'Seguridad' },
  { id: 'planes', label: 'Planes' },
];

export const LANDING_METRICS = [
  {
    value: '0 B en disco',
    label: 'Análisis volátil en RAM',
    detail: 'Volcados móviles, respaldos cifrados y enlaces se descartan al emitir el resultado.',
  },
  {
    value: 'STIX2 & YARA',
    label: 'Catálogo CTI + spyware comercial',
    detail: 'Cruce verificable contra Pegasus, Predator, Candiru, NoviSpy y Triangulation.',
  },
  {
    value: 'Modo Soberano',
    label: 'Ejecución local con Ollama',
    detail: 'Inferencia en infraestructura propia con 0 créditos de IA y sin nube externa.',
  },
  {
    value: 'App Nativa',
    label: 'Escritorio Tauri + Java/Python',
    detail: 'Sensor local en Rust de solo lectura acoplado a un motor transaccional aislado.',
  },
];

export const LANDING_PROFILES = [
  {
    id: 'GENERAL',
    label: 'General',
    domain: 'Seguridad Personal y Ejecutiva',
    headline: 'Audita equipos y teléfonos por USB sin copiar archivos personales.',
    summary:
      'Inspección preventiva de solo lectura sobre Windows y macOS, triaje móvil Android/iOS con MVT y Escudo Web pasivo en una sola cabina.',
    image: '/landing/omega-v2-0-1-showcase.jpg',
    imageAlt: 'Cabina de inspección local en RAM del perfil General de OMEGA',
    surfaceLabel: 'omega-sensor · solo lectura en memoria',
    operationalSpec: [
      {
        label: 'Superficie auditada',
        value: 'Procesos activos, persistencia WMI root\\subscription, sockets TCP y respaldos iOS Manifest.db en :memory:.',
      },
      {
        label: 'Límite operativo',
        value: 'No modifica el equipo ni sube archivos fuente. Escudo Web verifica enlaces sin emitir peticiones HTTP salientes.',
      },
      {
        label: 'Salida verificable',
        value: 'Cruce contra STIX 2.1 y reglas YARA con informe PDF/JSON sellado con hash SHA-256.',
      },
    ],
    capabilities: [
      {
        title: 'Inspector local de PC en RAM',
        detail: 'Evalúa procesos, tareas programadas, Defender, Firewall, UAC y SmartScreen sin indexar documentos del usuario.',
      },
      {
        title: 'Triaje USB Android (ADB) e iOS/iPadOS (MVT)',
        detail: 'Conector portátil integrado en 1 clic con desbloqueo en memoria de respaldos cifrados de iPhone.',
      },
      {
        title: 'Escudo Web pasivo y catálogo CTI',
        detail: 'Inspecciona dominios, correos e indicadores sospechosos antes de abrirlos y sin contactar el destino.',
      },
    ],
  },
  {
    id: 'DEVELOPER',
    label: 'Desarrollo',
    domain: 'AppSec y Cadena de Suministro',
    headline: 'Inspecciona repositorios, Pull Requests y dependencias con salida lista para CI.',
    summary:
      'Detecta secretos expuestos, patrones de exfiltración y riesgos de terceros desde GitHub App o CLI local con trazabilidad por commit.',
    image: '/landing/omega-v2-0-1-shield-pillars.jpg',
    imageAlt: 'Arquitectura AppSec, SBOM y cadena de suministro de OMEGA',
    surfaceLabel: 'omega-cli --project · appsec & sbom',
    operationalSpec: [
      {
        label: 'Superficie auditada',
        value: 'Repositorios GitHub, Pull Requests, archivos locales comprimidos, secretos y árbol de dependencias.',
      },
      {
        label: 'Límite operativo',
        value: 'Nunca afirma "repo seguro": reporta exactamente "Sin señales detectadas con las reglas actuales".',
      },
      {
        label: 'Salida verificable',
        value: 'Inventario SBOM CycloneDX 1.5 / SPDX 2.3, cruce OpenSSF y exportación SARIF para integración continua.',
      },
    ],
    capabilities: [
      {
        title: 'Escaneo de repositorios y Pull Requests',
        detail: 'Análisis estático de código, credenciales filtradas y vectores de exfiltración en GitHub o proyectos locales.',
      },
      {
        title: 'SBOM, OpenSSF y exportación SARIF',
        detail: 'Genera inventarios normalizados de dependencias y entrega hallazgos compatibles con pipelines de ingeniería.',
      },
      {
        title: 'Políticas, triaje y reportes por commit',
        detail: 'Gestiona excepciones justificadas y exporta informes PDF/JSON desde resultados existentes por 0 créditos.',
      },
    ],
  },
  {
    id: 'LEGAL',
    label: 'Legal',
    domain: 'Despachos y Firmas Jurídicas',
    headline: 'Expedientes confidenciales con citas obligatorias y abstención determinista.',
    summary:
      'Aísla casos por permisos granulares, verifica conflictos de interés por partes y consulta documentos extensos sin invenciones del modelo.',
    image: '/landing/omega-v2-0-1-showcase.jpg',
    imageAlt: 'Espacio de expedientes confidenciales del perfil Legal de OMEGA',
    surfaceLabel: 'omega-legal · citas verificables & custodia',
    operationalSpec: [
      {
        label: 'Superficie auditada',
        value: 'Expedientes cerrados con permisos READ/WRITE por rol, documentos procesales y partes normalizadas.',
      },
      {
        label: 'Límite operativo',
        value: 'Toda respuesta exige cita de documento y página; sin evidencia suficiente responde con LEGAL_ABSTENTION.',
      },
      {
        label: 'Salida verificable',
        value: 'Verificación de conflictos sin revelar casos restringidos, cronología documental y dossier PDF/JSON con SHA-256.',
      },
    ],
    capabilities: [
      {
        title: 'Aislamiento y permisos por expediente',
        detail: 'Control estricto por espacio y delegación explícita de lectura o escritura con bitácora de auditoría encadenada.',
      },
      {
        title: 'Revisión documental citada sin alucinaciones',
        detail: 'Cada afirmación apunta al documento y página exacta; si el respaldo no existe, el motor se abstiene.',
      },
      {
        title: 'Conflictos de interés, cronología y dossier',
        detail: 'Cruza partes normalizadas preservando confidencialidad y genera informes verificables con hash SHA-256.',
      },
    ],
  },
];

export const OPERATIONAL_GUARANTEES = [
  {
    id: 'zero-retention',
    title: 'Zero-Retention en RAM',
    whatItDoes:
      'Volcados ADB/iOS, bases Manifest.db descifradas en :memory: y enlaces sospechosos se procesan en memoria volátil y se liberan al emitir el diagnóstico.',
    boundary: 'Los archivos originales nunca se conservan en disco del servidor.',
  },
  {
    id: 'verifiable-evidence',
    title: 'Integridad SHA-256 trazable',
    whatItDoes:
      'Cada evento sensible y cada informe PDF o JSON incluye hash SHA-256 encadenado, registro de permisos y costo transparente antes de ejecutar.',
    boundary: 'Acredita integridad técnica del archivo; no sustituye una firma electrónica legal.',
  },
  {
    id: 'sovereign-control',
    title: 'Nube administrada o Soberano Local',
    whatItDoes:
      'Opera en infraestructura gestionada o en modo autoalojado (SELF_HOSTED) con Ollama en tu red interna, MFA obligatorio y separación por espacios.',
    boundary: 'En Ollama local la inferencia de IA consume 0 créditos y ningún dato sale de tu red.',
  },
];

export const DEPLOYMENT_MODES = [
  {
    mode: 'Nube administrada',
    infra: 'Infraestructura gestionada con aislamiento por espacio y MFA obligatorio.',
    aiCost: 'Consumo predecible en créditos con límite visible antes de ejecutar.',
    retention: '0 bytes de volcados móviles o archivos fuente en disco.',
  },
  {
    mode: 'Modo Soberano (SELF_HOSTED)',
    infra: 'Contenedores en tu propia red con motor local Ollama.',
    aiCost: '0 créditos de IA en inferencia local.',
    retention: 'Control físico y normativo total dentro de tu infraestructura.',
  },
];

export const PROFILE_ACCESS_NOTES = {
  GENERAL:
    'La cuenta individual General incluye acceso gratuito permanente con 30 créditos de bienvenida.',
  DEVELOPER:
    'Los espacios de Desarrollo y organizaciones operan bajo membresía Pro o Enterprise.',
  LEGAL:
    'Los espacios Legal y despachos operan bajo membresía Pro o Enterprise con MFA organizacional.',
};

export const LANDING_FAQ = [
  {
    q: '¿Qué pasa si consumo todos los créditos del mes?',
    a: 'No hay sobreconsumo ni recarga automática. Puedes esperar a la renovación mensual o adquirir una recarga opcional de 200 créditos por $29.900 COP con vigencia de 12 meses.',
  },
  {
    q: '¿Cuánto cuesta exportar informes PDF o JSON?',
    a: '0 créditos cuando se generan a partir de resultados ya calculados. Cada exportación incluye su hash SHA-256 para verificación técnica de integridad.',
  },
  {
    q: '¿Puedo cancelar o cambiar de plan cuando quiera?',
    a: 'Sí. Al cancelar la renovación conservas el acceso y los créditos restantes hasta el final del período pagado, sin penalidades.',
  },
  {
    q: '¿Cómo funciona el Modo Soberano con Ollama local?',
    a: 'En despliegue autoalojado la inferencia corre en tu propia infraestructura con Ollama y consume 0 créditos de IA. Enterprise incluye piloto guiado y facturación corporativa.',
  },
];

export const PILOT_SUMMARY_TEXT = [
  'OMEGA v2.2 — Resumen de Piloto Corporativo',
  'Plan Enterprise base: $299.900 COP/mes o $2.999.000 COP/año (ahorro de 2 meses)',
  'Capacidad inicial: 5 puestos compartidos · 25 dispositivos · 3.000 créditos/mes',
  'Espacios disponibles: General (PC/USB MVT), Desarrollo (GitHub/SBOM/SARIF) y Legal (Expedientes/Citas)',
  'Despliegue: Nube administrada o Modo Soberano Local con Ollama (SELF_HOSTED, 0 créditos de IA)',
].join('\n');

export function formatCop(amount) {
  if (amount === 0) return '$0';
  return `$${amount.toLocaleString('es-CO')}`;
}

export function getPlansForProfile(profileId, billingCycle) {
  const isAnnual = billingCycle === 'annual';
  const isGeneral = profileId === 'GENERAL';

  const freeFeatures = isGeneral
    ? [
        '30 créditos de bienvenida (una sola vez)',
        '1 puesto individual y 1 dispositivo',
        'Inspector local de PC, Escudo Web y catálogo STIX2/YARA',
        'Triaje USB Android/iOS usando tu saldo de créditos',
      ]
    : [
        '30 créditos de bienvenida al activar suscripción',
        '1 puesto individual y acceso al perfil General gratuito',
        'Configuración previa del espacio antes de migrar',
        'Requiere Pro o Enterprise para módulos profesionales',
      ];

  const proProfileFeature =
    profileId === 'DEVELOPER'
      ? 'Escaneo de repositorios, Pull Requests en GitHub, SBOM y SARIF'
      : profileId === 'LEGAL'
        ? 'Expedientes confidenciales, citas obligatorias, conflictos y cronología'
        : 'Triaje USB completo, auditoría profunda de PC y monitoreo OSINT';

  const enterpriseProfileFeature =
    profileId === 'DEVELOPER'
      ? 'Múltiples repositorios, políticas por organización y CLI/CI en equipo'
      : profileId === 'LEGAL'
        ? 'Espacios aislados por práctica, MFA reforzado y gobierno de firma'
        : 'Hasta 25 dispositivos gestionados bajo gobierno centralizado';

  return [
    {
      id: 'FREE',
      name: 'Gratis',
      tagline: isGeneral
        ? 'Evaluación inmediata y protección personal local.'
        : 'Crea tu cuenta y valida la cabina antes de suscribirte.',
      priceMonthly: 0,
      priceAnnual: null,
      displayPrice: '$0',
      periodLabel: 'COP · sin tarjeta',
      annualSubtext: isGeneral
        ? 'Gratis para cuenta individual General'
        : 'Actualiza a Pro para activar este perfil',
      creditsLabel: '30 créditos de bienvenida',
      seatsLabel: '1 puesto · 1 dispositivo',
      featured: false,
      ctaLabel: 'Crear cuenta',
      ctaAction: 'register',
      features: freeFeatures,
    },
    {
      id: 'PRO',
      name: 'Pro',
      tagline: 'Operación completa para especialistas y profesionales independientes.',
      priceMonthly: 59900,
      priceAnnual: 599000,
      displayPrice: isAnnual ? formatCop(599000) : formatCop(59900),
      periodLabel: isAnnual ? 'COP / año' : 'COP / mes',
      annualSubtext: isAnnual
        ? 'Equivale a $49.917 COP/mes · ahorras $119.800 (2 meses)'
        : 'O $599.000 COP/año con 2 meses de ahorro',
      creditsLabel: '500 créditos / mes',
      seatsLabel: '1 puesto · hasta 5 dispositivos',
      featured: true,
      ctaLabel: 'Suscribirse con Mercado Pago',
      ctaAction: 'subscribe',
      features: [
        '500 créditos mensuales + recargas opcionales de 200 ($29.900 COP)',
        'Hasta 5 dispositivos vinculados y 1 titular',
        proProfileFeature,
        'Informes PDF y JSON con hash SHA-256 (0 créditos)',
      ],
    },
    {
      id: 'ENTERPRISE',
      name: 'Enterprise',
      tagline: 'Para equipos de ingeniería, organizaciones y despachos jurídicos.',
      priceMonthly: 299900,
      priceAnnual: 2999000,
      displayPrice: isAnnual ? formatCop(2999000) : formatCop(299900),
      periodLabel: isAnnual ? 'COP / año' : 'COP / mes',
      annualSubtext: isAnnual
        ? 'Equivale a $249.917 COP/mes · ahorras $599.800 (2 meses)'
        : 'O $2.999.000 COP/año · facturación corporativa disponible',
      creditsLabel: '3.000 créditos / mes',
      seatsLabel: '5 puestos compartidos · 25 dispositivos',
      featured: false,
      ctaLabel: 'Solicitar piloto guiado',
      ctaAction: 'pilot',
      features: [
        '3.000 créditos mensuales compartidos por organización',
        '5 puestos de equipo y hasta 25 dispositivos gestionados',
        enterpriseProfileFeature,
        'Modo soberano local (Ollama), piloto guiado y facturación corporativa',
      ],
    },
  ];
}
