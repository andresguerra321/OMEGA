const CVE_RE = /\bCVE-\d{4}-\d{4,7}\b/gi;
const SHA256_RE = /\b[a-f0-9]{64}\b/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const DOMAIN_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ca|uk|xyz|top|info|me|co|gov|edu|online|site)\b/gi;
const FORENSIC_ARTIFACT_RE =
  /\b(?:shutdown\.log|safari_history\.json|History\.db|IMTranscoderAgent|BlastDoor|CoreGraphics|PassKit|abscarrylog)\b/gi;

const CATEGORY_RULES = [
  {
    category: 'Vector y explotación',
    keywords: [
      'cve-',
      'zero-click',
      '0-day',
      '1-click',
      'exploit',
      'imessage',
      'blastdoor',
      'sandbox',
      'vulnerabil',
      'passkit',
      'webp',
      'coregraphics',
      'ejecución',
    ],
  },
  {
    category: 'Infraestructura y C2',
    keywords: [
      'dominio',
      'c2',
      'servidor',
      'dns',
      'redirec',
      'url',
      'infraestructura',
      'entrega',
      'inyección',
      'shortener',
    ],
  },
  {
    category: 'Artefactos forenses',
    keywords: [
      'mvt',
      'shutdown.log',
      'safari',
      'crash',
      'imtranscoderagent',
      'artefacto',
      'sqlite',
      'proceso',
      'hash',
      'sha-256',
      'respaldo',
      'persistencia',
    ],
  },
  {
    category: 'Actores y objetivos',
    keywords: [
      'sector',
      'región',
      'periodist',
      'gobierno',
      'derechos humanos',
      'diplomát',
      'objetivo',
      'víctima',
      'nso',
      'intellexa',
      'candiru',
      'pegasus',
      'predator',
      'actor',
      'campaña',
    ],
  },
  {
    category: 'Mitigación y defensa',
    keywords: [
      'mitig',
      'parche',
      'actualiz',
      'lockdown',
      'bloqueo',
      'verific',
      'recomend',
      'defens',
    ],
  },
];

const ACTOR_PATTERNS = [
  { label: 'Pegasus (NSO Group)', re: /\b(?:pegasus|nso\s*group)\b/i },
  { label: 'Predator (Intellexa / Cytrox)', re: /\b(?:predator|intellexa|cytrox)\b/i },
  { label: 'Candiru', re: /\bcandiru\b/i },
  { label: 'QuaDream (KingsPawn)', re: /\b(?:quadream|kingspawn)\b/i },
  { label: 'FinFisher (FinSpy)', re: /\b(?:finfisher|finspy)\b/i },
];

function computeConfidence(citList) {
  if (!citList || citList.length === 0) return 'Referencial';
  const bestSim = Math.max(...citList.map((c) => Number(c.similarity || 0)));
  const hasHybridOrExact = citList.some(
    (c) =>
      c.retrieval_method === 'Híbrido (Vector + Exacto)' ||
      c.retrieval_method === 'Coincidencia Exacta'
  );
  if ((hasHybridOrExact && bestSim >= 0.65) || bestSim >= 0.82) return 'Alta';
  if (bestSim >= 0.58 || hasHybridOrExact) return 'Media';
  return 'Referencial';
}

function classifyFinding(title, summary) {
  const haystack = `${title} ${summary}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => haystack.includes(kw))) {
      return rule.category;
    }
  }
  return 'Hallazgo analítico';
}

/**
 * Construye el dossier analítico de 5 pilares (respuesta ejecutiva, hallazgos,
 * evidencias, indicadores relacionados y trazabilidad) priorizando `msg.analysis`
 * del backend y derivando con exactitud en cliente para sesiones previas o fallback.
 */
export function deriveInvestigationAnalysis(message) {
  if (message?.analysis && typeof message.analysis === 'object') {
    const analysis = message.analysis;
    // Asegurar artefactos forenses notables si el backend no los listó como IOCs
    const extraArtifacts = extractForensicArtifacts(message.content, message.citations);
    const existingValues = new Set(
      (analysis.related_indicators?.iocs || []).map((i) => i.value.toLowerCase())
    );
    const mergedIocs = [
      ...(analysis.related_indicators?.iocs || []),
      ...extraArtifacts.filter((a) => !existingValues.has(a.value.toLowerCase())),
    ].slice(0, 12);

    return {
      ...analysis,
      related_indicators: {
        cves: analysis.related_indicators?.cves || [],
        iocs: mergedIocs,
        actors_families: analysis.related_indicators?.actors_families || [],
        campaigns: analysis.related_indicators?.campaigns || [],
      },
    };
  }

  const content = (message?.content || '').trim();
  const citations = message?.citations || [];
  const insufficient =
    citations.length === 0 ||
    content.toLowerCase().includes('no hay evidencia suficiente en los reportes indexados');

  if (insufficient) {
    return {
      insufficient_evidence: true,
      executive_summary: content,
      findings: [],
      related_indicators: { cves: [], iocs: [], actors_families: [], campaigns: [] },
      traceability: {
        overall_confidence: 'Referencial',
        sources_count: citations.length,
        organizations: [],
        hybrid_count: 0,
        max_similarity: 0,
        sources: [],
      },
    };
  }

  const citMap = new Map(citations.map((c) => [c.index, c]));
  const lines = content.split(/\r?\n/);
  const execLines = [];
  const findings = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const bulletMatch = trimmed.match(/^(?:[-*]|\d+\.)\s+(?:\*\*([^*]+?)\*\*\s*:?\s*)?(.*)$/);
    if (bulletMatch) {
      let title = (bulletMatch[1] || '').trim().replace(/:$/, '');
      let summary = (bulletMatch[2] || '').trim();
      if (!title && summary.includes(':') && summary.indexOf(':') < 60) {
        const idx = summary.indexOf(':');
        title = summary.slice(0, idx).trim();
        summary = summary.slice(idx + 1).trim();
      } else if (!title) {
        title = 'Evidencia documentada';
      }

      const citNums = Array.from(summary.matchAll(/\[(\d+)\]/g))
        .map((m) => Number(m[1]))
        .filter((n) => citMap.has(n));
      const uniqueCits = Array.from(new Set(citNums));
      const citedObjs = uniqueCits.map((n) => citMap.get(n)).filter(Boolean);

      findings.push({
        category: classifyFinding(title, summary),
        title,
        summary,
        citations: uniqueCits,
        confidence: computeConfidence(citedObjs.length > 0 ? citedObjs : citations),
      });
    } else if (findings.length === 0 && !trimmed.startsWith('>') && !trimmed.startsWith('#')) {
      execLines.push(trimmed);
    }
  }

  const executiveSummary = execLines.join(' ').trim() || lines[0]?.trim() || content;
  const combinedText = [content, ...citations.map((c) => c.snippet || '')].join('\n');

  const cves = Array.from(
    new Set((combinedText.match(CVE_RE) || []).map((c) => c.toUpperCase()))
  ).sort();

  const seenIoc = new Set();
  const iocs = [];
  const pushIoc = (type, value, source) => {
    const key = value.toLowerCase();
    if (
      seenIoc.has(key) ||
      key.includes('citizenlab.ca') ||
      key.includes('amnesty.org') ||
      key.includes('blog.google')
    ) {
      return;
    }
    seenIoc.add(key);
    iocs.push({ type, value, source });
  };

  for (const h of combinedText.match(SHA256_RE) || []) pushIoc('sha256', h.toLowerCase(), 'Respuesta');
  for (const d of combinedText.match(DOMAIN_RE) || []) pushIoc('domain', d.toLowerCase(), 'Respuesta');
  for (const ip of combinedText.match(IPV4_RE) || []) pushIoc('ip', ip, 'Respuesta');
  for (const art of extractForensicArtifacts(content, citations)) {
    pushIoc(art.type, art.value, art.source);
  }

  const actorsFamilies = ACTOR_PATTERNS.filter((p) => p.re.test(combinedText)).map((p) => p.label);

  const traceSources = citations.map((c) => ({
    index: c.index,
    report_id: c.report_id,
    title: c.title,
    organization: c.organization,
    page: c.page,
    retrieval_method: c.retrieval_method || 'Híbrido (Vector + Exacto)',
    similarity: Number(c.similarity || 0),
    confidence: computeConfidence([c]),
  }));

  return {
    insufficient_evidence: false,
    executive_summary: executiveSummary,
    findings,
    related_indicators: {
      cves,
      iocs: iocs.slice(0, 12),
      actors_families: actorsFamilies,
      campaigns: [],
    },
    traceability: {
      overall_confidence: computeConfidence(citations),
      sources_count: citations.length,
      organizations: Array.from(new Set(citations.map((c) => c.organization).filter(Boolean))).sort(),
      hybrid_count: citations.filter(
        (c) =>
          c.retrieval_method === 'Híbrido (Vector + Exacto)' ||
          c.retrieval_method === 'Coincidencia Exacta'
      ).length,
      max_similarity: citations.length
        ? Math.max(...citations.map((c) => Number(c.similarity || 0)))
        : 0,
      sources: traceSources,
    },
  };
}

function extractForensicArtifacts(content = '', citations = []) {
  const combined = [content, ...citations.map((c) => c.snippet || '')].join('\n');
  const seen = new Set();
  const out = [];
  for (const match of combined.match(FORENSIC_ARTIFACT_RE) || []) {
    const key = match.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ type: 'artifact', value: match, source: 'Artefacto citado' });
    }
  }
  return out;
}

export function formatRelativeTimestamp(isoString) {
  if (!isoString) return 'Ahora';
  const ts = new Date(isoString).getTime();
  if (Number.isNaN(ts)) return 'Reciente';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'Ahora';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Hace ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Ayer';
  if (diffDays < 30) return `Hace ${diffDays} d`;
  return new Date(ts).toISOString().slice(0, 10);
}

