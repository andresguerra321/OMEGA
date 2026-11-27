/**
 * Catálogo comercial y técnico para la Landing Page independiente de OMEGA.
 * Sincronizado con PRODUCT.md, docs/perfiles.md, docs/commercial-readiness.md
 * y docs/billing-mercadopago.md (omega_rag.billing_plans).
 */

export const OMEGA_APP_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OMEGA_APP_URL) ||
  'http://localhost:5173';

export const LANDING_METRICS = [
  {
    code: '01',
    value: '0 B en disco',
    label: 'Análisis volátil en RAM',
    detail: 'Volcados móviles, respaldos cifrados y enlaces se descartan al emitir el resultado.',
  },
  {
    code: '02',
    value: 'STIX2 & YARA',
    label: 'Catálogo CTI + spyware comercial',
    detail: 'Cruce verificable contra Pegasus, Predator, Candiru y feeds STIX 2.1.',
  },
  {
    code: '03',
    value: 'Modo Soberano',
    label: 'Ejecución local con Ollama',
    detail: 'Inferencia en infraestructura propia sin enviar datos a nubes externas.',
  },
  {
    code: '04',
    value: 'App Nativa',
    label: 'Escritorio Tauri + Java/Python',
    detail: 'Cliente ligero con sensor local en Rust y backend transaccional aislado.',
  },
];

export const LANDING_PROFILES = [
  {
    id: 'GENERAL',
    label: 'General',
    badge: 'Seguridad Personal y Ejecutiva',
    headline: 'Protege tu equipo y tus teléfonos sin exponer archivos personales.',
    summary:
      'Inspección preventiva de solo lectura sobre Windows/macOS, dispositivos Android/iOS por USB y enlaces sospechosos en una cabina unificada.',
    image: '/landing/omega-v2-0-1-showcase.jpg',
    imageAlt: 'Cabina unificada de protección en RAM de OMEGA',
    previewTag: 'PERFIL GENERAL · ZERO-RETENTION',
    previewTitle: 'Centro unificado de protección en RAM',
    previewStats: [
      { k: 'Inspector PC', v: 'Procesos, persistencia WMI y sockets TCP en memoria' },
      { k: 'Triaje USB', v: 'Android ADB e iOS/iPadOS con motor MVT en 1 clic' },
      { k: 'Escudo Web', v: 'Verificación pasiva sin peticiones HTTP salientes' },
    ],
    capabilities: [
      {
        title: 'Inspector local de PC en RAM',
        detail: 'Audita procesos activos, persistencia WMI, sockets salientes y postura del sistema sin tocar archivos personales.',
      },
      {
        title: 'Triaje de celulares Android e iOS por USB',
        detail: 'Diagnóstico MVT con conector portátil integrado y lectura en memoria de respaldos cifrados de iPhone.',
      },
      {
        title: 'Escudo Web pasivo y catálogo CTI',
        detail: 'Evalúa enlaces, dominios e indicadores contra STIX 2.1 y YARA sin enviar tráfico directo al sitio analizado.',
      },
    ],
  },
  {
    id: 'DEVELOPER',
    label: 'Desarrollo',
    badge: 'AppSec y Cadena de Suministro',
    headline: 'Audita repositorios, Pull Requests y dependencias con evidencia accionable.',
    summary:
      'Detecta secretos expuestos, riesgos de cadena de suministro y vulnerabilidades en ingeniería con hallazgos explicables y trazables.',
    image: '/landing/omega-v2-0-1-shield-pillars.jpg',
    imageAlt: 'Arquitectura AppSec y cadena de suministro de OMEGA',
    previewTag: 'PERFIL DESARROLLO · APPSEC & SBOM',
    previewTitle: 'Hub de Proyectos y Cadena de Suministro',
    previewStats: [
      { k: 'GitHub & PRs', v: 'Escaneo automatizado con GitHub App y CLI --project' },
      { k: 'SBOM & Feeds', v: 'CycloneDX 1.5, SPDX 2.3 e inteligencia OpenSSF' },
      { k: 'Integración CI', v: 'Exportación SARIF, políticas y monitoreo continuo' },
    ],
    capabilities: [
      {
        title: 'Escaneo de repositorios y Pull Requests',
        detail: 'Inspección estática de código, secretos y vectores de exfiltración en GitHub o archivos locales comprimidos.',
      },
      {
        title: 'SBOM, OpenSSF y exportación SARIF',
        detail: 'Genera inventarios CycloneDX/SPDX, cruza inteligencia de cadena de suministro y exporta hallazgos listos para CI.',
      },
      {
        title: 'Políticas, triaje e informes técnicos',
        detail: 'Gestiona excepciones, prioriza hallazgos persistidos y descarga reportes PDF/JSON con trazabilidad por commit.',
      },
    ],
  },
  {
    id: 'LEGAL',
    label: 'Legal',
    badge: 'Despachos y Firmas Jurídicas',
    headline: 'Expedientes confidenciales con revisión documental citada y trazable.',
    summary:
      'Organiza casos, verifica conflictos de interés por partes y consulta documentos extensos con abstención determinista cuando no hay base.',
    image: '/landing/omega-v2-0-1-showcase.jpg',
    imageAlt: 'Espacio de expedientes confidenciales del módulo Legal de OMEGA',
    previewTag: 'PERFIL LEGAL · EXPEDIENTES & CITAS',
    previewTitle: 'Espacio de casos y verificación documental',
    previewStats: [
      { k: 'Aislamiento', v: 'Permisos granulares por expediente y rol' },
      { k: 'IA con citas', v: 'Documento + página obligatoria y abstención determinista' },
      { k: 'Conflictos', v: 'Cruce normalizado por partes sin exponer casos restringidos' },
    ],
    capabilities: [
      {
        title: 'Expedientes confidenciales y permisos granulares',
        detail: 'Aislamiento estricto por espacio y delegación controlada de lectura/escritura con auditoría encadenada.',
      },
      {
        title: 'Revisión documental con citas verificables',
        detail: 'Cada respuesta enlaza documento y página exacta; si la evidencia no existe, el motor se abstiene sin inventar.',
      },
      {
        title: 'Conflictos, líneas de tiempo e informes PDF',
        detail: 'Detecta posibles conflictos por partes, construye cronologías documentales y exporta dossiers verificables con SHA-256.',
      },
    ],
  },
];

export const TRUST_PILLARS = [
  {
    id: 'zero-retention',
    eyebrow: '01 · MEMORIA VOLÁTIL',
    title: 'Zero-Retention en RAM',
    description:
      'Los volcados móviles, respaldos cifrados y análisis de enlaces se procesan en memoria y se descartan al terminar. Los archivos originales no se conservan en el servidor.',
    meta: '0 bytes persistidos de archivos fuente',
  },
  {
    id: 'verifiable-evidence',
    eyebrow: '02 · TRAZABILIDAD',
    title: 'Evidencia verificable y trazable',
    description:
      'Cada evento crítico y cada informe PDF/JSON incluye hashes SHA-256 encadenados y permisos auditados para demostrar integridad técnica sin cajas negras.',
    meta: 'Cadena de custodia SHA-256 verificable',
  },
  {
    id: 'sovereign-control',
    eyebrow: '03 · SOBERANÍA',
    title: 'Control total: Nube o Soberano Local',
    description:
      'Opera con despliegue administrado o en modo soberano 100% local con Ollama en tu infraestructura, manteniendo MFA obligatorio y separación por espacios.',
    meta: 'Despliegue híbrido o autoalojado',
  },
];

export const PROFILE_ACCESS_NOTES = {
  GENERAL: 'Cuenta individual General incluye acceso gratuito permanente con 30 créditos de bienvenida.',
  DEVELOPER: 'Los espacios de Desarrollo y organizaciones requieren membresía Pro o Enterprise para operar módulos profesionales.',
  LEGAL: 'Los despachos y espacios Legal requieren membresía Pro o Enterprise, con aislamiento estricto y MFA organizacional.',
};

export const LANDING_FAQ = [
  {
    q: '¿Puedo cancelar o cambiar mi plan cuando quiera?',
    a: 'Sí. Al cancelar la renovación conservas acceso completo y tus créditos hasta el final del período ya pagado, sin cobros ocultos ni penalidades.',
  },
  {
    q: '¿Qué sucede si consumo todos los créditos del mes?',
    a: 'No existe sobreconsumo ni recarga automática. Puedes comprar un paquete opcional de 200 créditos por $29.900 COP con vigencia de 12 meses o esperar a la renovación mensual.',
  },
  {
    q: '¿Los archivos originales o volcados móviles se suben a la nube?',
    a: 'No. Bajo política Zero-Retention los análisis de PC, respaldos iOS/Android y enlaces corren en memoria volátil y se descartan al terminar. Exportar informes de resultados existentes cuesta 0 créditos.',
  },
  {
    q: '¿Cómo funciona el Modo Soberano local y la facturación corporativa?',
    a: 'En infraestructura propia con Ollama local la inferencia de IA no consume créditos. Para equipos y despachos en Enterprise ofrecemos piloto guiado, 5 puestos compartidos y facturación corporativa.',
  },
];

export function formatCop(amount) {
  if (amount === 0) return '$0';
  return `$${amount.toLocaleString('es-CO')}`;
}

export function getPlansForProfile(profileId, billingCycle) {
  const isAnnual = billingCycle === 'annual';
  const isGeneral = profileId === 'GENERAL';

  const freeFeatures = isGeneral
    ? [
        '30 créditos de bienvenida (única vez)',
        '1 puesto individual y 1 dispositivo',
        'Inspector local de PC, Escudo Web y catálogo STIX2/YARA',
        'Triaje USB Android/iOS bajo saldo de créditos',
      ]
    : [
        '30 créditos de bienvenida al activar suscripción',
        '1 puesto individual y configuración guiada del espacio',
        'Acceso al perfil General gratuito mientras evalúas',
        'Requiere Pro o Enterprise para activar módulos profesionales',
      ];

  const proProfileFeature =
    profileId === 'DEVELOPER'
      ? 'Escaneo de repositorios, PRs en GitHub, SBOM y SARIF'
      : profileId === 'LEGAL'
        ? 'Expedientes confidenciales, citas verificables, conflictos y cronología'
        : 'Triaje USB completo, análisis profundo de PC y monitoreo OSINT';

  const enterpriseProfileFeature =
    profileId === 'DEVELOPER'
      ? 'Múltiples proyectos, políticas por organización y CLI/CI en equipo'
      : profileId === 'LEGAL'
        ? 'Múltiples espacios aislados por práctica, MFA reforzado y gestión de firma'
        : 'Flota de hasta 25 dispositivos con gobierno centralizado por organización';

  return [
    {
      id: 'FREE',
      name: 'Gratis',
      tagline: isGeneral
        ? 'Evaluación inmediata y protección personal local.'
        : 'Crea tu cuenta y explora la plataforma antes de suscribirte.',
      priceMonthly: 0,
      priceAnnual: null,
      displayPrice: '$0',
      periodLabel: 'COP · sin tarjeta',
      annualSubtext: isGeneral ? 'Gratis para cuenta individual General' : 'Actualiza a Pro para desbloquear este perfil',
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
      tagline: 'Potencia completa para profesionales independientes y especialistas.',
      priceMonthly: 59900,
      priceAnnual: 599000,
      displayPrice: isAnnual ? formatCop(599000) : formatCop(59900),
      periodLabel: isAnnual ? 'COP / año' : 'COP / mes',
      annualSubtext: isAnnual
        ? 'Equivale a $49.917 COP/mes · ahorras 2 meses ($119.800)'
        : 'O $599.000 COP/año con 2 meses de ahorro',
      creditsLabel: '500 créditos / mes',
      seatsLabel: '1 puesto · hasta 5 dispositivos',
      featured: true,
      badge: 'Recomendado',
      ctaLabel: 'Suscribirse con Mercado Pago',
      ctaAction: 'subscribe',
      features: [
        '500 créditos mensuales + recargas de 200 por $29.900 COP',
        'Hasta 5 dispositivos vinculados y 1 titular',
        proProfileFeature,
        'Informes PDF y JSON verificables con hash SHA-256 (0 créditos)',
      ],
    },
    {
      id: 'ENTERPRISE',
      name: 'Enterprise',
      tagline: 'Para organizaciones, equipos de ingeniería y despachos jurídicos.',
      priceMonthly: 299900,
      priceAnnual: 2999000,
      displayPrice: isAnnual ? formatCop(2999000) : formatCop(299900),
      periodLabel: isAnnual ? 'COP / año' : 'COP / mes',
      annualSubtext: isAnnual
        ? 'Equivale a $249.917 COP/mes · ahorras 2 meses ($599.800)'
        : 'O $2.999.000 COP/año · facturación corporativa disponible',
      creditsLabel: '3.000 créditos / mes',
      seatsLabel: '5 puestos compartidos · 25 dispositivos',
      featured: false,
      ctaLabel: 'Hablar con ventas / Piloto',
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
