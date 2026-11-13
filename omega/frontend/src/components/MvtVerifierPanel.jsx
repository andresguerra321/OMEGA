import { useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Lock,
  MessageSquare,
  Search,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Upload,
} from 'lucide-react';
import { runParallelTriage, verifyMvtText } from '../lib/api';

const MVT_CLI_COMMAND = 'mvt-ios check-backup --output ./dump /backup';

const DEMO_SCENARIOS = {
  infected: {
    id: 'demo_infected',
    label: 'Infección Correlacionada',
    ephemeral_notice: 'Análisis ejecutado íntegramente en memoria RAM. 0 bytes persistidos en disco (RNF4).',
    queueFiles: [
      { name: 'sms.db', badge: 'DB', parser: 'SQLite3-RAM', sizeLabel: '1.4 MB' },
      { name: 'safari_history.json', badge: 'JSON', parser: 'MVT-Web', sizeLabel: '320 KB' },
      { name: 'shutdown_log.json', badge: 'SYS', parser: 'iOS-Processes', sizeLabel: '88 KB' },
      { name: 'IMTranscoderAgent.ips', badge: 'LOG', parser: 'CrashLog', sizeLabel: '42 KB' },
    ],
    total_indicators_analyzed: 148,
    total_matches: 4,
    crash_anomalies: [
      'Crash de parsing en IMTranscoderAgent previo a reinicio inesperado en shutdown_log.json',
      'Spawn anómalo en proceso bridgepd fuera de ventana de actualización del sistema',
    ],
    subagents: [
      {
        agent_id: 'subagent_a_messaging',
        agent_name: 'Subagente A · Mensajería y SQLite',
        scope: 'sms.db · adjuntos PassKit / PDF',
        files_processed: 1,
        indicators_extracted: 46,
        matches_count: 1,
        notes: ['1 URL de carga útil y registro de adjunto PassKit en tabla message/attachment.'],
      },
      {
        agent_id: 'subagent_b_network',
        agent_name: 'Subagente B · Telemetría de Red y DNS',
        scope: 'safari_history.json · resoluciones C2',
        files_processed: 1,
        indicators_extracted: 64,
        matches_count: 2,
        notes: ['2 dominios C2 documentados en Citizen Lab / Amnesty Tech dentro de ventana de 4 min.'],
      },
      {
        agent_id: 'subagent_c_processes',
        agent_name: 'Subagente C · Procesos y CrashLogs',
        scope: 'shutdown_log.json · IMTranscoderAgent.ips',
        files_processed: 2,
        indicators_extracted: 38,
        matches_count: 1,
        notes: ['Proceso bridgepd activo tras crash de IMTranscoderAgent (patrón zero-click).'],
      },
    ],
    diagnosis: {
      verdict_code: 'CORROBORATED_INFECTION_PATTERN',
      verdict_label: 'PATRÓN DE INFECCIÓN CORRELACIONADO (CONFIANZA ALTA)',
      convergent_label: '3/3 Subagentes convergentes',
      confidence: 'ALTA',
      is_likely_false_positive: false,
      rationale:
        'Convergencia temporal estricta: descarga zero-click en mensajería (Subagente A), resolución a infraestructura C2 de Pegasus en Safari/WebKit (Subagente B) y caída crítica en IMTranscoderAgent seguida por ejecución anómala de bridgepd (Subagente C).',
      recommended_actions: [
        'Aislar red / Modo Avión',
        'Preservar volcado MVT',
        'Rotar credenciales y tokens',
      ],
    },
    findings: [
      {
        id: 'f-inf-1',
        ioc_value: 'free247downloads[.]com',
        ioc_type: 'domain',
        subagent_id: 'subagent_b_network',
        subagent_short: 'B · Red',
        match_precision: 'EXACT_IOC',
        spyware_family: 'Pegasus',
        campaign: 'BLASTPASS / NSO Infrastructure',
        cve: 'CVE-2023-41064',
        artifact_origin: 'safari_history.json · line 412 (WebKit Redirect)',
        source_report: 'Citizen Lab · BLASTPASS Report (2023)',
        organization: 'Citizen Lab',
        source_url: 'https://citizenlab.ca/2023/09/blastpass-nso-group-iphone-zero-click-zero-day-exploit-captured-in-the-wild/',
        context:
          '{"timestamp":"2024-02-11T03:14:09Z","url":"https://free247downloads[.]com/cdn/v2/stage?t=98f1a","visit_count":1,"redirect_source":"com.apple.MobileSMS"}',
      },
      {
        id: 'f-inf-2',
        ioc_value: 'IMTranscoderAgent -> bridgepd',
        ioc_type: 'process',
        subagent_id: 'subagent_c_processes',
        subagent_short: 'C · Procesos',
        match_precision: 'PROCESS_ANOMALY',
        spyware_family: 'Pegasus',
        campaign: 'FORCEDENTRY / ImageIO Zero-Click',
        cve: 'CVE-2021-30860',
        artifact_origin: 'IMTranscoderAgent.ips + shutdown_log.json · entry #19',
        source_report: 'Amnesty Tech · Forensic Methodology (MVT)',
        organization: 'Amnesty Tech',
        source_url: 'https://www.amnesty.org/en/latest/research/2021/07/forensic-methodology-report-how-to-catch-nso-groups-pegasus/',
        context:
          '{"proc":"IMTranscoderAgent","exception":"EXC_BAD_ACCESS (SIGSEGV)","fault_addr":"0x0000000104a8c000","next_spawn":"/private/var/tmp/bridgepd","delta_ms":1840}',
      },
      {
        id: 'f-inf-3',
        ioc_value: 'updates-icloud-cdn[.]org/pkpass',
        ioc_type: 'url',
        subagent_id: 'subagent_a_messaging',
        subagent_short: 'A · SQLite',
        match_precision: 'URL_CORRELATED',
        spyware_family: 'Pegasus',
        campaign: 'BLASTPASS PassKit Vector',
        cve: 'CVE-2023-41061',
        artifact_origin: 'sms.db · table:attachment ROWID=1842',
        source_report: 'Citizen Lab · BLASTPASS Report (2023)',
        organization: 'Citizen Lab',
        source_url: 'https://citizenlab.ca/2023/09/blastpass-nso-group-iphone-zero-click-zero-day-exploit-captured-in-the-wild/',
        context:
          'ROWID=1842 | guid="p:4/71C9A..." | mime_type="application/vnd.apple.pkpass" | transfer_name="pass_8841.pkpass" | origin_ref="updates-icloud-cdn[.]org/pkpass"',
      },
      {
        id: 'f-inf-4',
        ioc_value: 'cdn-apple-metrics[.]info',
        ioc_type: 'domain',
        subagent_id: 'subagent_b_network',
        subagent_short: 'B · Red',
        match_precision: 'DOMAIN_EXACT',
        spyware_family: 'Pegasus',
        campaign: 'NSO Group Telemetry Staging',
        cve: 'CVE-2023-41064',
        artifact_origin: 'safari_history.json · line 438 (Post-Exploit DNS)',
        source_report: 'Amnesty Tech · MVT Public Indicators',
        organization: 'Amnesty Tech',
        source_url: 'https://github.com/AmnestyTech/investigations',
        context:
          '{"timestamp":"2024-02-11T03:16:52Z","domain":"cdn-apple-metrics[.]info","resolved_ip":"185.220.101[.]44","process":"nsurlsessiond","bytes_out":49152}',
      },
    ],
  },

  false_positive: {
    id: 'demo_false_positive',
    label: 'Falso Positivo Aislado',
    ephemeral_notice: 'Análisis ejecutado íntegramente en memoria RAM. 0 bytes persistidos en disco (RNF4).',
    queueFiles: [
      { name: 'sms.db', badge: 'DB', parser: 'SQLite3-RAM', sizeLabel: '1.4 MB' },
      { name: 'safari_history.json', badge: 'JSON', parser: 'MVT-Web', sizeLabel: '320 KB' },
      { name: 'shutdown_log.json', badge: 'SYS', parser: 'iOS-Processes', sizeLabel: '88 KB' },
    ],
    total_indicators_analyzed: 112,
    total_matches: 1,
    crash_anomalies: [],
    subagents: [
      {
        agent_id: 'subagent_a_messaging',
        agent_name: 'Subagente A · Mensajería y SQLite',
        scope: 'sms.db · adjuntos PassKit / PDF',
        files_processed: 1,
        indicators_extracted: 41,
        matches_count: 0,
        notes: ['Sin payloads adjuntos sospechosos ni cadenas de entrega 0-click en sms.db.'],
      },
      {
        agent_id: 'subagent_b_network',
        agent_name: 'Subagente B · Telemetría de Red y DNS',
        scope: 'safari_history.json · resoluciones C2',
        files_processed: 1,
        indicators_extracted: 52,
        matches_count: 1,
        notes: ['1 coincidencia pasiva aislada de dominio sin redirecciones 1-click ni descarga asociada.'],
      },
      {
        agent_id: 'subagent_c_processes',
        agent_name: 'Subagente C · Procesos y CrashLogs',
        scope: 'shutdown_log.json · trazas iOS',
        files_processed: 1,
        indicators_extracted: 19,
        matches_count: 0,
        notes: ['Tabla de procesos limpia; 0 reinicios anómalos o crashes de parser multimedial.'],
      },
    ],
    diagnosis: {
      verdict_code: 'LIKELY_FALSE_POSITIVE',
      verdict_label: 'COINCIDENCIA AISLADA — POSIBLE FALSO POSITIVO / EXPOSICIÓN PASIVA',
      convergent_label: '1/3 Subagentes · Sin convergencia',
      confidence: 'BAJA',
      is_likely_false_positive: true,
      rationale:
        'Solo se detectó una referencia histórica de dominio en Safari sin trazas de entrega en mensajería (Subagente A) ni persistencia/crashes en procesos iOS (Subagente C). Suele corresponder a pre-fetching de enlaces, artículos citando indicadores o redirecciones bloqueadas.',
      recommended_actions: [
        'Verificar contexto histórico en Safari',
        'Auditar si existió redirección 1-click',
        'Repetir captura con MVT completo',
      ],
    },
    findings: [
      {
        id: 'f-fp-1',
        ioc_value: 'news-media-tracker[.]net',
        ioc_type: 'domain',
        subagent_id: 'subagent_b_network',
        subagent_short: 'B · Red',
        match_precision: 'SUBDOMAIN_MATCH',
        spyware_family: 'Predator',
        campaign: 'Intellexa Passive DNS Overlap',
        cve: 'N/A (Exposición pasiva)',
        artifact_origin: 'safari_history.json · line 94 (Link Preview Prefetch)',
        source_report: 'Google TAG · Predator Infrastructure Overlap',
        organization: 'Google TAG',
        source_url: 'https://blog.google/threat-analysis-group/',
        context:
          '{"timestamp":"2024-02-04T18:02:11Z","url":"https://news-media-tracker[.]net/favicon.ico","referrer":"https://newsletter.example.org/issue-41","payload_bytes":0}',
      },
    ],
  },
};

function describeUploadedFile(file) {
  const lower = file.name.toLowerCase();
  const bytes = file.size || 0;
  const sizeLabel =
    bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      : bytes >= 1024
        ? `${Math.max(1, Math.round(bytes / 1024))} KB`
        : `${bytes} B`;

  if (lower.endsWith('.db') || lower.endsWith('.sqlite') || lower.endsWith('.sqlite3')) {
    return { name: file.name, badge: 'DB', parser: 'SQLite3-RAM', sizeLabel };
  }
  if (lower.endsWith('.ips')) {
    return { name: file.name, badge: 'LOG', parser: 'CrashLog', sizeLabel };
  }
  if (lower.includes('shutdown') || lower.includes('process')) {
    return { name: file.name, badge: 'SYS', parser: 'iOS-Processes', sizeLabel };
  }
  if (lower.endsWith('.json')) {
    return { name: file.name, badge: 'JSON', parser: 'MVT-JSON', sizeLabel };
  }
  return { name: file.name, badge: 'TXT', parser: 'Text-RAM', sizeLabel };
}

function shortSubagentLabel(agentId) {
  if (agentId === 'subagent_a_messaging') return 'A · SQLite';
  if (agentId === 'subagent_b_network') return 'B · Red';
  if (agentId === 'subagent_c_processes') return 'C · Procesos';
  return 'A/B/C';
}

function normalizeBackendParallelReport(apiRes, uploadedFiles) {
  const queueFiles = uploadedFiles.map(describeUploadedFile);
  const subagents = (apiRes.subagents || []).map((sub) => ({
    agent_id: sub.agent_id,
    agent_name: sub.agent_name,
    scope:
      sub.agent_id === 'subagent_a_messaging'
        ? 'SQLite / mensajería / hashes'
        : sub.agent_id === 'subagent_b_network'
          ? 'Historial web / DNS / IPs'
          : 'shutdown_log / procesos / .ips',
    files_processed: sub.files_processed ?? 0,
    indicators_extracted: sub.indicators_extracted ?? 0,
    matches_count: sub.matches_count ?? (sub.matches?.length || 0),
    notes: sub.notes || [],
  }));

  const findings = [];
  (apiRes.subagents || []).forEach((sub) => {
    (sub.matches || []).forEach((m, idx) => {
      findings.push({
        id: `live-${sub.agent_id}-${idx}-${m.ioc_value}`,
        ioc_value: m.ioc_value,
        ioc_type: m.ioc_type || 'indicator',
        subagent_id: sub.agent_id,
        subagent_short: shortSubagentLabel(sub.agent_id),
        match_precision: m.match_precision || 'EXACT_IOC',
        spyware_family: m.spyware_family || 'Sin clasificar',
        campaign: m.campaign || 'Correlación CTI Pública',
        cve: m.cve || 'Verificación en chat',
        artifact_origin: m.artifact_origin || 'Volcado MVT en RAM',
        source_report: m.source_report || 'Corpus CTI OMEGA',
        organization: m.organization || 'CTI Pública',
        source_url: m.source_url || '',
        context: m.context || `${m.ioc_type || 'ioc'}: ${m.ioc_value}`,
      });
    });
  });

  const activeSubagentsWithHits = subagents.filter(
    (s) => s.matches_count > 0 || (s.agent_id === 'subagent_c_processes' && (apiRes.crash_anomalies?.length || 0) > 0),
  ).length;

  return {
    id: 'live_files',
    label: 'Volcado MVT en RAM',
    ephemeral_notice:
      apiRes.ephemeral_notice || 'Análisis ejecutado íntegramente en memoria RAM. 0 bytes persistidos en disco (RNF4).',
    queueFiles,
    total_indicators_analyzed: apiRes.total_indicators_analyzed ?? 0,
    total_matches: apiRes.total_matches ?? findings.length,
    crash_anomalies: apiRes.crash_anomalies || [],
    subagents,
    diagnosis: {
      verdict_code: apiRes.diagnosis?.verdict_code || 'CLEAN',
      verdict_label: apiRes.diagnosis?.verdict_label || 'ANÁLISIS COMPLETADO',
      convergent_label: `${activeSubagentsWithHits}/3 Subagentes con señales`,
      confidence: apiRes.diagnosis?.confidence || 'MEDIA',
      is_likely_false_positive: Boolean(apiRes.diagnosis?.is_likely_false_positive),
      rationale: apiRes.diagnosis?.rationale || 'Cruce paralelo completado sobre los artefactos cargados en RAM.',
      recommended_actions: apiRes.diagnosis?.recommended_actions || [],
    },
    findings,
  };
}

function normalizeManualTextReport(apiRes, rawText) {
  const bytes = new Blob([rawText]).size;
  const matches = apiRes.matches || [];
  const findings = matches.map((m, idx) => {
    const inferredAgent =
      m.ioc_type === 'process'
        ? 'subagent_c_processes'
        : m.ioc_type === 'hash'
          ? 'subagent_a_messaging'
          : 'subagent_b_network';
    return {
      id: `manual-${idx}-${m.ioc_value}`,
      ioc_value: m.ioc_value,
      ioc_type: m.ioc_type || 'indicator',
      subagent_id: inferredAgent,
      subagent_short: shortSubagentLabel(inferredAgent),
      match_precision: m.match_precision || 'EXACT_IOC',
      spyware_family: m.spyware_family || 'Sin clasificar',
      campaign: m.campaign || 'Cruce Manual en RAM',
      cve: 'Verificación en chat',
      artifact_origin: `Entrada manual (${apiRes.detected_format || 'texto libre'})`,
      source_report: m.source_report || 'Corpus CTI OMEGA',
      organization: m.organization || 'CTI Pública',
      source_url: m.source_url || '',
      context: m.context || `Indicador evaluado: ${m.ioc_value}`,
    };
  });

  const bd = apiRes.breakdown || {};
  const msgCount = (bd.hashes || 0);
  const netCount = (bd.domains || 0) + (bd.urls || 0) + (bd.ips || 0);
  const procCount = (bd.processes || 0);

  const aHits = findings.filter((f) => f.subagent_id === 'subagent_a_messaging').length;
  const bHits = findings.filter((f) => f.subagent_id === 'subagent_b_network').length;
  const cHits = findings.filter((f) => f.subagent_id === 'subagent_c_processes').length;
  const hitWorkers = [aHits, bHits, cHits].filter((n) => n > 0).length;

  const isHit = findings.length > 0;
  return {
    id: 'live_manual',
    label: 'Cruce Manual en RAM',
    ephemeral_notice:
      apiRes.ephemeral_notice || 'Indicadores procesados únicamente en memoria volátil RAM (RNF4).',
    queueFiles: [
      {
        name: 'manual_iocs.txt',
        badge: 'MEM',
        parser: 'Text-RAM',
        sizeLabel: `${bytes} B`,
      },
    ],
    total_indicators_analyzed: apiRes.analyzed_indicators ?? 0,
    total_matches: apiRes.total_matches ?? findings.length,
    crash_anomalies: [],
    subagents: [
      {
        agent_id: 'subagent_a_messaging',
        agent_name: 'Subagente A · Mensajería y SQLite',
        scope: 'Hashes SHA-256 / adjuntos',
        files_processed: msgCount > 0 ? 1 : 0,
        indicators_extracted: msgCount,
        matches_count: aHits,
        notes: [msgCount > 0 ? `${msgCount} hashes extraídos de la entrada manual.` : 'Sin artefactos SQLite/hashes en la entrada.'],
      },
      {
        agent_id: 'subagent_b_network',
        agent_name: 'Subagente B · Telemetría de Red y DNS',
        scope: 'Dominios / URLs / IPs',
        files_processed: netCount > 0 ? 1 : 0,
        indicators_extracted: netCount,
        matches_count: bHits,
        notes: [netCount > 0 ? `${netCount} indicadores de red evaluados contra IOCs públicos.` : 'Sin dominios, URLs o IPs detectados.'],
      },
      {
        agent_id: 'subagent_c_processes',
        agent_name: 'Subagente C · Procesos y CrashLogs',
        scope: 'Procesos anómalos conocidos',
        files_processed: procCount > 0 ? 1 : 0,
        indicators_extracted: procCount,
        matches_count: cHits,
        notes: [procCount > 0 ? `${procCount} nombres de proceso inspeccionados.` : 'Sin procesos o crashlogs en la entrada.'],
      },
    ],
    diagnosis: isHit
      ? {
          verdict_code: hitWorkers >= 2 ? 'CORROBORATED_INFECTION_PATTERN' : 'SUSPICIOUS_SINGLE_VECTOR',
          verdict_label:
            hitWorkers >= 2
              ? 'COINCIDENCIA MÚLTIPLE EN ENTRADA MANUAL'
              : 'COINCIDENCIA AISLADA — REQUIERE CORRELACIÓN CON VOLCADO MVT',
          convergent_label: `${hitWorkers}/3 Vectores con coincidencia`,
          confidence: hitWorkers >= 2 ? 'MEDIA-ALTA' : 'MEDIA',
          is_likely_false_positive: hitWorkers < 2,
          rationale:
            hitWorkers >= 2
              ? 'Los indicadores pegados muestran coincidencias en múltiples vectores. Complementa con artefactos reales (sms.db, safari_history.json, shutdown_log.json) para validar ventana temporal.'
              : 'Coincidencia puntual obtenida por texto manual sin evidencia paralela de SQLite ni procesos en caída. Validar si proviene de navegación previa o falso positivo.',
          recommended_actions: [
            'Contrastarlo con volcado MVT completo',
            'Auditar el indicador en Preguntar',
          ],
        }
      : {
          verdict_code: 'CLEAN',
          verdict_label: 'SIN COINCIDENCIAS CON IOCs PÚBLICOS CONOCIDOS',
          convergent_label: '0/3 Subagentes con alertas',
          confidence: 'VERIFICADO',
          is_likely_false_positive: false,
          rationale: `Se evaluaron ${apiRes.analyzed_indicators ?? 0} indicadores en memoria volátil sin coincidencias contra los reportes CTI indexados en OMEGA.`,
          recommended_actions: [
            'Conservar vigilancia preventiva',
            'Ejecutar MVT sobre backup cifrado local si persiste sospecha',
          ],
        },
    findings,
  };
}

function getDiagnosisTheme(diagnosis) {
  if (!diagnosis) {
    return {
      container: 'bg-[#15223D] border-[#2F6FED]/40 border-l-[#2F6FED]',
      badge: 'text-[#7AA7FF]',
      chip: 'bg-[#0E182E] border-[#2F6FED]/40 text-[#7AA7FF]',
      icon: ShieldCheck,
    };
  }
  const code = diagnosis.verdict_code;
  if (code === 'CORROBORATED_INFECTION_PATTERN') {
    return {
      container: 'bg-[#1C1114] border-[#5C2128] border-l-[#F87171]',
      badge: 'text-[#F87171]',
      chip: 'bg-[#261418] border-[#5C2128] text-[#F87171]',
      icon: ShieldAlert,
    };
  }
  if (code === 'LIKELY_FALSE_POSITIVE' || code === 'SUSPICIOUS_SINGLE_VECTOR' || diagnosis.is_likely_false_positive) {
    return {
      container: 'bg-[#1A160E] border-[#52401E] border-l-[#FBBF24]',
      badge: 'text-[#FBBF24]',
      chip: 'bg-[#241D11] border-[#52401E] text-[#FBBF24]',
      icon: AlertTriangle,
    };
  }
  return {
    container: 'bg-[#15223D] border-[#2F6FED]/40 border-l-[#2F6FED]',
    badge: 'text-[#7AA7FF]',
    chip: 'bg-[#0E182E] border-[#2F6FED]/40 text-[#7AA7FF]',
    icon: ShieldCheck,
  };
}

function getSubagentIcon(agentId) {
  if (agentId === 'subagent_a_messaging') return Database;
  if (agentId === 'subagent_b_network') return Globe;
  return Activity;
}

export function MvtVerifierPanel({ onAskInChat }) {
  const fileInputRef = useRef(null);

  const [report, setReport] = useState(DEMO_SCENARIOS.infected);
  const [selectedFindingId, setSelectedFindingId] = useState(DEMO_SCENARIOS.infected.findings[0].id);
  const [manualText, setManualText] = useState('');
  const [showCliCmd, setShowCliCmd] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const selectedFinding = useMemo(() => {
    if (!report.findings?.length) return null;
    return report.findings.find((f) => f.id === selectedFindingId) || report.findings[0];
  }, [report, selectedFindingId]);

  const diagnosisTheme = getDiagnosisTheme(report.diagnosis);
  const DiagnosisIcon = diagnosisTheme.icon;

  function applyReport(nextReport) {
    setReport(nextReport);
    setSelectedFindingId(nextReport.findings?.[0]?.id || null);
    setErrorMsg('');
  }

  function handleSelectScenario(key) {
    const scenario = DEMO_SCENARIOS[key];
    if (!scenario) return;
    applyReport(scenario);
  }

  async function handleFilesProcess(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setIsRunning(true);
    setErrorMsg('');
    try {
      const apiRes = await runParallelTriage(files);
      const normalized = normalizeBackendParallelReport(apiRes, files);
      applyReport(normalized);
    } catch (err) {
      setErrorMsg(
        err?.message || 'Error al ejecutar el pipeline paralelo en RAM sobre los artefactos cargados.',
      );
    } finally {
      setIsRunning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleManualVerify() {
    const trimmed = manualText.trim();
    if (!trimmed) return;
    setIsRunning(true);
    setErrorMsg('');
    try {
      const apiRes = await verifyMvtText(trimmed);
      const normalized = normalizeManualTextReport(apiRes, trimmed);
      applyReport(normalized);
    } catch (err) {
      setErrorMsg(
        err?.message || 'No se pudo cruzar el texto en memoria contra el catálogo CTI del backend.',
      );
    } finally {
      setIsRunning(false);
    }
  }

  async function copyToClipboard(key, value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      // Clipboard blocked in non-HTTPS context
    }
  }

  function handleExportMarkdown() {
    const lines = [
      '# OMEGA · Informe de Triage Forense Paralelo (MVT en RAM)',
      `- **Modo:** ${report.label}`,
      `- **Garantía de privacidad:** ${report.ephemeral_notice}`,
      `- **Indicadores analizados:** ${report.total_indicators_analyzed}`,
      `- **Coincidencias CTI:** ${report.total_matches}`,
      '',
      '## Artefactos en cola RAM',
      ...report.queueFiles.map(
        (f) => `- \`[${f.badge}] ${f.name}\` · ${f.parser} (${f.sizeLabel})`,
      ),
      '',
      '## Estado de Subagentes Paralelos',
      ...report.subagents.map(
        (s) =>
          `- **${s.agent_name}**: ${s.files_processed} archivos · ${s.indicators_extracted} indicadores · ${s.matches_count} coincidencias (${s.notes?.[0] || 'Sin notas'})`,
      ),
      '',
      `## Diagnóstico Diferencial: ${report.diagnosis?.verdict_label}`,
      report.diagnosis?.rationale || '',
      '',
      '## Hallazgos Correlacionados',
    ];

    if (!report.findings?.length) {
      lines.push('Sin coincidencias CTI en memoria.');
    } else {
      report.findings.forEach((f, idx) => {
        lines.push(`### ${idx + 1}. \`${f.ioc_value}\` (${f.spyware_family})`);
        lines.push(`- **Subagente:** ${f.subagent_short} | **Precisión:** \`${f.match_precision}\``);
        lines.push(`- **Campaña:** ${f.campaign} | **CVE:** \`${f.cve}\``);
        lines.push(`- **Origen exacto:** \`${f.artifact_origin}\``);
        lines.push(`- **Registro crudo:** \`${f.context}\``);
        lines.push('');
      });
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omega_triage_forense_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleInvestigateFinding() {
    if (!selectedFinding || !onAskInChat) return;
    const prompt = [
      `Analiza este hallazgo del workbench forense MVT:`,
      `- Indicador: ${selectedFinding.ioc_value} (${selectedFinding.ioc_type})`,
      `- Familia / Campaña: ${selectedFinding.spyware_family} · ${selectedFinding.campaign}`,
      `- Origen exacto en volcado: ${selectedFinding.artifact_origin}`,
      `- Registro crudo en RAM: ${selectedFinding.context}`,
      `¿Cómo se documenta este vector en los reportes CTI indexados y qué acciones técnicas de contención aplican?`,
    ].join('\n');
    onAskInChat(prompt);
  }

  return (
    <div className="space-y-4">
      {/* 1. Barra de Comandos Superior */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-semibold tracking-tight text-[#F2F2F4]">
            Revisar mi equipo
          </h1>
          <span className="font-tech inline-flex items-center gap-1.5 rounded-[4px] bg-[#15223D] border border-[#2F6FED]/40 px-2.5 py-1 text-[11px] font-medium text-[#7AA7FF]">
            <Lock className="h-3 w-3 shrink-0" />
            MOTOR VOLÁTIL EN RAM · 0 BYTES EN DISCO (RNF4)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-[4px] bg-[#141418] border border-[#232329] p-0.5">
            <button
              type="button"
              onClick={() => handleSelectScenario('infected')}
              className={`rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer border ${
                report.id === 'demo_infected'
                  ? 'bg-[#1C1114] border-[#5C2128] text-[#F87171]'
                  : 'border-transparent text-[#8E8E96] hover:text-[#F2F2F4]'
              }`}
            >
              Escenario: Infección Correlacionada
            </button>
            <button
              type="button"
              onClick={() => handleSelectScenario('false_positive')}
              className={`rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer border ${
                report.id === 'demo_false_positive'
                  ? 'bg-[#1A160E] border-[#52401E] text-[#FBBF24]'
                  : 'border-transparent text-[#8E8E96] hover:text-[#F2F2F4]'
              }`}
            >
              Escenario: Falso Positivo Aislado
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportMarkdown}
            className="h-8 rounded-[4px] bg-[#141418] border border-[#232329] px-3 text-[12.5px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/50 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-[#8E8E96]" />
            <span>Exportar informe (.md)</span>
          </button>
        </div>
      </div>

      {/* Aviso de error operativo no bloqueante */}
      {errorMsg && (
        <div className="rounded-[6px] bg-[#1C1114] border border-[#5C2128] px-3.5 py-2.5 flex items-center justify-between gap-3 text-[12.5px] text-[#F87171]">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg('')}
            className="text-[11.5px] text-[#F87171]/80 hover:text-[#F87171] cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* 2. Barra de Ingesta Multi-Artefacto */}
      <section className="grid grid-cols-12 gap-3">
        {/* Carga múltiple + Cola RAM (8 columnas) */}
        <div className="col-span-12 lg:col-span-8 rounded-[6px] bg-[#141418] border border-[#232329] p-3.5 flex flex-col justify-between gap-2.5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer?.files?.length) {
                handleFilesProcess(e.dataTransfer.files);
              }
            }}
            className={`rounded-[4px] border border-dashed px-3.5 py-2.5 bg-[#0E0E12] transition-colors flex flex-wrap items-center justify-between gap-2.5 ${
              isDragging
                ? 'border-[#2F6FED] bg-[#15223D]/40'
                : 'border-[#232329] hover:border-[#2F6FED]/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".json,.db,.sqlite,.sqlite3,.ips,.log,.txt"
              onChange={(e) => handleFilesProcess(e.target.files)}
              className="hidden"
            />

            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                disabled={isRunning}
                onClick={() => fileInputRef.current?.click()}
                className="h-8 rounded-[4px] bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-60 px-3 text-[12.5px] font-medium text-white flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              >
                {isRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                <span>+ Cargar artefactos MVT / SQLite / .ips</span>
              </button>
              <span className="text-[12px] text-[#8E8E96] truncate">
                Arrastra múltiples archivos (.db, .json, .ips) para triage paralelo
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowCliCmd((v) => !v)}
              className="h-7 rounded-[4px] bg-[#141418] border border-[#232329] px-2.5 text-[11.5px] font-medium text-[#8E8E96] hover:text-[#F2F2F4] hover:border-[#2F6FED]/40 transition-colors flex items-center gap-1 cursor-pointer shrink-0"
            >
              <Terminal className="h-3 w-3" />
              <span>Ver comando CLI MVT</span>
              {showCliCmd ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>

          {showCliCmd && (
            <div className="rounded-[4px] bg-[#0E0E12] border border-[#232329] px-3 py-2 flex items-center justify-between gap-2">
              <code className="font-tech text-[11.5px] text-[#7AA7FF] truncate">
                {MVT_CLI_COMMAND}
              </code>
              <button
                type="button"
                onClick={() => copyToClipboard('cli', MVT_CLI_COMMAND)}
                className="h-6 rounded-[4px] bg-[#141418] border border-[#232329] px-2 text-[11px] text-[#F2F2F4] hover:border-[#2F6FED]/50 flex items-center gap-1 cursor-pointer shrink-0"
              >
                {copiedKey === 'cli' ? (
                  <>
                    <Check className="h-3 w-3 text-[#7AA7FF]" />
                    <span>Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3 text-[#8E8E96]" />
                    <span>Copiar</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Cola de artefactos cargados en RAM */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-[#8E8E96] mr-1">
              Cola en RAM ({report.queueFiles.length}):
            </span>
            {report.queueFiles.map((item, idx) => (
              <span
                key={`${item.name}-${idx}`}
                className="font-tech inline-flex items-center gap-1.5 rounded-[4px] bg-[#0E0E12] border border-[#232329] px-2 py-1 text-[11px] text-[#F2F2F4]"
              >
                <span className="text-[#7AA7FF]">[{item.badge}]</span>
                <span>{item.name}</span>
                <span className="text-[#8E8E96]">· {item.parser}</span>
                <span className="text-[#8E8E96]">({item.sizeLabel})</span>
              </span>
            ))}
          </div>
        </div>

        {/* Cruce manual de indicador (4 columnas) */}
        <div className="col-span-12 lg:col-span-4 rounded-[6px] bg-[#141418] border border-[#232329] p-3.5 flex flex-col justify-between gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-[#F2F2F4]">
              Cruce manual de IOCs
            </span>
            <span className="font-tech text-[11px] text-[#8E8E96]">RAM-ONLY</span>
          </div>

          <textarea
            rows={2}
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="free247downloads.com, 185.220.101.44, bridgepd..."
            className="font-tech w-full resize-none rounded-[4px] bg-[#0E0E12] border border-[#232329] px-2.5 py-2 text-[11.5px] text-[#F2F2F4] placeholder-[#8E8E96]/70 focus:outline-none focus:border-[#2F6FED]"
          />

          <div className="flex items-center justify-between gap-2">
            <span className="font-tech text-[11px] text-[#8E8E96]">
              {report.total_indicators_analyzed} indicadores analizados
            </span>
            <button
              type="button"
              disabled={isRunning || !manualText.trim()}
              onClick={handleManualVerify}
              className="h-8 rounded-[4px] bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-45 px-3 text-[12.5px] font-medium text-white flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Cruzar en RAM</span>
            </button>
          </div>
        </div>
      </section>

      {/* 3. Pipeline de 3 Subagentes Paralelos */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {report.subagents.map((sub) => {
          const Icon = getSubagentIcon(sub.agent_id);
          const hasMatch = sub.matches_count > 0;
          const isIsolatedMode = report.diagnosis?.is_likely_false_positive && hasMatch;

          const statusStyle = hasMatch
            ? isIsolatedMode
              ? 'bg-[#1A160E] border-[#52401E] text-[#FBBF24]'
              : 'bg-[#1C1114] border-[#5C2128] text-[#F87171]'
            : 'bg-[#15223D] border-[#2F6FED]/40 text-[#7AA7FF]';

          return (
            <div
              key={sub.agent_id}
              className="rounded-[6px] bg-[#141418] border border-[#232329] p-3.5 flex flex-col justify-between gap-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <div className="h-7 w-7 rounded-[4px] bg-[#0E0E12] border border-[#232329] flex items-center justify-center shrink-0">
                    <Icon className="h-3.5 w-3.5 text-[#7AA7FF]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-[#F2F2F4] truncate">
                      {sub.agent_name}
                    </div>
                    <div className="font-tech text-[11px] text-[#8E8E96] truncate">
                      {sub.scope}
                    </div>
                  </div>
                </div>

                <span
                  className={`font-tech shrink-0 rounded-[4px] border px-2 py-0.5 text-[10.5px] font-medium ${statusStyle}`}
                >
                  {isRunning ? 'PROCESANDO' : hasMatch ? `${sub.matches_count} HIT${sub.matches_count > 1 ? 'S' : ''}` : 'LIMPIO'}
                </span>
              </div>

              <div className="font-tech flex items-center justify-between rounded-[4px] bg-[#0E0E12] border border-[#232329] px-2.5 py-1.5 text-[11px] text-[#8E8E96]">
                <span>Archivos: {sub.files_processed}</span>
                <span>Indicadores: {sub.indicators_extracted}</span>
                <span className={hasMatch ? (isIsolatedMode ? 'text-[#FBBF24]' : 'text-[#F87171]') : 'text-[#7AA7FF]'}>
                  IOCs: {sub.matches_count}
                </span>
              </div>

              <p className="text-[12px] text-[#8E8E96] leading-snug line-clamp-2">
                {sub.notes?.[0] || 'Ejecución paralela completada en memoria volátil.'}
              </p>
            </div>
          );
        })}
      </section>

      {/* 4. Banner de Diagnóstico Diferencial */}
      <section className={`rounded-[6px] border border-l-[3px] p-4 ${diagnosisTheme.container}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <DiagnosisIcon className={`h-4 w-4 mt-0.5 shrink-0 ${diagnosisTheme.badge}`} />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-tech text-[12px] font-semibold tracking-wide ${diagnosisTheme.badge}`}>
                  {report.diagnosis?.verdict_label}
                </span>
                <span className={`font-tech rounded-[4px] border px-2 py-0.5 text-[11px] ${diagnosisTheme.chip}`}>
                  {report.diagnosis?.convergent_label}
                </span>
              </div>
              <p className="text-[13px] text-[#F2F2F4]/90 leading-relaxed max-w-[820px]">
                {report.diagnosis?.rationale}
              </p>
            </div>
          </div>

          <span className="font-tech rounded-[4px] bg-[#0E0E12] border border-[#232329] px-2 py-1 text-[11px] text-[#8E8E96] shrink-0">
            Confianza: {report.diagnosis?.confidence}
          </span>
        </div>

        {report.diagnosis?.recommended_actions?.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[#232329]/70 flex flex-wrap items-center gap-2">
            <span className="text-[11.5px] font-medium text-[#8E8E96]">
              Acciones de contención:
            </span>
            {report.diagnosis.recommended_actions.map((action, idx) => (
              <span
                key={idx}
                className="rounded-[4px] bg-[#0E0E12] border border-[#232329] px-2.5 py-1 text-[12px] text-[#F2F2F4]"
              >
                {action}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 5. Split-Pane de Hallazgos Forenses */}
      <section className="grid grid-cols-12 min-h-[260px] rounded-[6px] bg-[#141418] border border-[#232329] overflow-hidden">
        {/* Tabla Seleccionable de Evidencia (7 columnas) */}
        <div className="col-span-12 lg:col-span-7 border-b lg:border-b-0 lg:border-r border-[#232329] flex flex-col">
          <div className="px-4 py-2.5 border-b border-[#232329] flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-[#F2F2F4]">
              Evidencia correlacionada en RAM
            </span>
            <span className="font-tech text-[11px] text-[#8E8E96]">
              {report.findings.length} hallazgo{report.findings.length === 1 ? '' : 's'}
            </span>
          </div>

          {report.findings.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
              <ShieldCheck className="h-6 w-6 text-[#7AA7FF] mb-2" />
              <div className="text-[13.5px] font-medium text-[#F2F2F4]">
                Sin coincidencias de indicadores en memoria
              </div>
              <p className="text-[12px] text-[#8E8E96] mt-1 max-w-[380px]">
                Los artefactos evaluados no coinciden con dominios, procesos, URLs ni hashes indexados de spyware comercial.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#232329] bg-[#0E0E12] text-[11px] font-medium text-[#8E8E96]">
                    <th className="py-2 px-3.5">Indicador / Artefacto</th>
                    <th className="py-2 px-3">Subagente</th>
                    <th className="py-2 px-3">Precisión</th>
                    <th className="py-2 px-3.5">Familia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#232329]/70 text-[12.5px]">
                  {report.findings.map((finding) => {
                    const isSelected = selectedFinding?.id === finding.id;
                    return (
                      <tr
                        key={finding.id}
                        onClick={() => setSelectedFindingId(finding.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-[#15223D]/60' : 'hover:bg-[#191920]'
                        }`}
                      >
                        <td className="py-2.5 px-3.5">
                          <div className="font-tech text-[12px] text-[#F2F2F4] truncate max-w-[230px]">
                            {finding.ioc_value}
                          </div>
                          <div className="font-tech text-[10.5px] text-[#8E8E96] truncate max-w-[230px]">
                            {finding.artifact_origin}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="font-tech rounded-[4px] bg-[#0E0E12] border border-[#232329] px-1.5 py-0.5 text-[11px] text-[#F2F2F4]">
                            {finding.subagent_short}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="font-tech text-[11px] text-[#7AA7FF]">
                            {finding.match_precision}
                          </span>
                        </td>
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          <span
                            className={`rounded-[4px] border px-2 py-0.5 text-[11px] font-medium ${
                              report.diagnosis?.is_likely_false_positive
                                ? 'bg-[#1A160E] border-[#52401E] text-[#FBBF24]'
                                : 'bg-[#1C1114] border-[#5C2128] text-[#F87171]'
                            }`}
                          >
                            {finding.spyware_family}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Inspector Lateral de Registro Crudo (5 columnas) */}
        <div className="col-span-12 lg:col-span-5 p-4 flex flex-col justify-between gap-3 bg-[#141418]">
          {selectedFinding ? (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#232329]">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-[#7AA7FF] shrink-0" />
                    <span className="text-[13px] font-medium text-[#F2F2F4] truncate">
                      Inspector de evidencia
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard('ioc', selectedFinding.ioc_value)}
                    className="h-6 rounded-[4px] bg-[#0E0E12] border border-[#232329] px-2 text-[11px] text-[#F2F2F4] hover:border-[#2F6FED]/50 flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    {copiedKey === 'ioc' ? (
                      <>
                        <Check className="h-3 w-3 text-[#7AA7FF]" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3 text-[#8E8E96]" />
                        <span>Copiar IOC</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-[4px] bg-[#0E0E12] border border-[#232329] p-2.5">
                    <div className="text-[11px] text-[#8E8E96]">Campaña / Familia</div>
                    <div className="text-[12.5px] font-medium text-[#F2F2F4] mt-0.5 truncate">
                      {selectedFinding.campaign}
                    </div>
                  </div>
                  <div className="rounded-[4px] bg-[#0E0E12] border border-[#232329] p-2.5">
                    <div className="text-[11px] text-[#8E8E96]">Referencia / CVE</div>
                    <div className="font-tech text-[12px] text-[#7AA7FF] mt-0.5 truncate">
                      {selectedFinding.cve}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-[#8E8E96] mb-1">
                    Origen exacto en volcado
                  </div>
                  <div className="font-tech rounded-[4px] bg-[#0E0E12] border border-[#232329] px-2.5 py-1.5 text-[11.5px] text-[#F2F2F4] break-all">
                    {selectedFinding.artifact_origin}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-[#8E8E96] mb-1">
                    Registro crudo en RAM
                  </div>
                  <pre className="font-tech rounded-[4px] bg-[#0E0E12] border border-[#232329] p-3 text-[11px] leading-relaxed text-[#F2F2F4] overflow-x-auto whitespace-pre-wrap break-all">
                    {selectedFinding.context}
                  </pre>
                </div>

                <div className="flex items-center justify-between gap-2 text-[11.5px] text-[#8E8E96]">
                  <span className="truncate">Fuente: {selectedFinding.source_report}</span>
                  {selectedFinding.source_url?.startsWith('http') && (
                    <a
                      href={selectedFinding.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[#7AA7FF] hover:underline shrink-0"
                    >
                      <span>Ver reporte</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>

              <button
                type="button"
                disabled={!onAskInChat}
                onClick={handleInvestigateFinding}
                className="w-full h-9 rounded-[4px] bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-50 text-white text-[13px] font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Investigar hallazgo en Preguntar</span>
              </button>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-8 px-4">
              <FileText className="h-5 w-5 text-[#8E8E96] mb-2" />
              <div className="text-[13px] font-medium text-[#F2F2F4]">
                Sin evidencia seleccionada
              </div>
              <p className="text-[12px] text-[#8E8E96] mt-1">
                Cuando exista un hallazgo en la tabla izquierda podrás inspeccionar su origen en volcado y registro crudo.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
