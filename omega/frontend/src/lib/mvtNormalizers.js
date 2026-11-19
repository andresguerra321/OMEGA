export const DEFAULT_OS_SCOPE_NOTICE =
  'Sin coincidencias contra el catálogo vigente no descarta exploits avanzados a nivel de sistema. Mantén actualizado tu sistema operativo, activa Modo Aislamiento en iOS/macOS y conserva el cifrado de disco.';

export function dedupeMatches(rawMatches) {
  const seen = new Set();
  const list = [];
  for (const m of rawMatches) {
    const val = (m.ioc_value || '').trim();
    if (!val) continue;
    const key = `${val.toLowerCase()}::${(m.spyware_family || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({
      id: `${list.length}-${val}`,
      ioc_value: val,
      spyware_family: m.spyware_family || 'Sin clasificar',
      artifact_origin: m.artifact_origin || 'Volcado MVT',
      campaign: m.campaign || '',
      source_report: m.source_report || '',
      context: m.context || '',
    });
  }
  return list;
}

export function normalizeParallelResult(res, files = [], customSourceLabel = '') {
  const allMatches = [];
  for (const sub of res.subagents || []) {
    for (const m of sub.matches || []) {
      allMatches.push(m);
    }
  }
  const findings = dedupeMatches(allMatches);
  const fileNames = files.map((f) => f.name).join(', ');
  const emptyClean = res.diagnosis?.verdict_code === 'CLEAN' && !(res.total_indicators_analyzed > 0);

  return {
    sourceLabel: customSourceLabel || fileNames || 'volcado_mvt',
    analyzedCount: res.total_indicators_analyzed ?? 0,
    filesAnalyzed: res.total_files ?? files.length,
    matchesCount: findings.length,
    behavioralAnomalies: res.behavioral_anomalies || [],
    yaraHits: res.yara_hits || [],
    timeline: res.timeline || [],
    timelineSummary: res.timeline_summary || null,
    coverageGaps: res.coverage_gaps || [],
    verdictCode: emptyClean ? 'INCOMPLETE' : res.diagnosis?.verdict_code || (findings.length > 0 ? 'DETECTED' : (res.total_indicators_analyzed > 0 ? 'CLEAN' : 'INCOMPLETE')),
    verdictLabel: emptyClean ? 'Análisis incompleto · no se evaluaron indicadores' : res.diagnosis?.verdict_label || '',
    rationale: emptyClean ? 'No se evaluaron indicadores. Este resultado no permite concluir que el análisis haya terminado sin hallazgos.' : res.diagnosis?.rationale || '',
    recommendedActions: res.diagnosis?.recommended_actions || [],
    catalogFreshness: res.catalog_freshness || null,
    osScopeNotice: res.os_scope_notice || '',
    platformMitigations: Array.isArray(res.platform_mitigations) ? res.platform_mitigations : [],
    findings,
  };
}

export function normalizeManualResult(res) {
  const findings = dedupeMatches(res.matches || []);
  return {
    sourceLabel: 'indicadores_manuales.txt',
    analyzedCount: res.analyzed_indicators ?? 0,
    matchesCount: findings.length,
    behavioralAnomalies: [],
    yaraHits: [],
    verdictCode: findings.length > 0 ? 'DETECTED' : (res.analyzed_indicators > 0 ? 'CLEAN' : 'INCOMPLETE'),
    verdictLabel: '',
    rationale: '',
    catalogFreshness: res.catalog_freshness || null,
    osScopeNotice: res.os_scope_notice || '',
    platformMitigations: Array.isArray(res.platform_mitigations) ? res.platform_mitigations : [],
    recommendedActions:
      findings.length > 0
        ? [
            'Preservar el respaldo completo y evitar restaurar el equipo antes de la revisión forense.',
            'Correlacionar el indicador detectado con los reportes técnicos desde el Asistente.',
          ]
        : [],
    findings,
  };
}

export function buildForensicMarkdownReport(result, hardeningReport) {
  const anomalies = result.behavioralAnomalies || [];
  const yaraHits = result.yaraHits || [];
  const checks = hardeningReport?.hardening_checks || [];
  const alerts = hardeningReport?.abuse_alerts || [];
  const sockets = hardeningReport?.live_sockets || [];
  const cutoffDate =
    result.catalogFreshness?.catalog_cutoff_date ||
    hardeningReport?.catalog_freshness?.catalog_cutoff_date ||
    '2024-12-16';
  const scopeNotice =
    result.osScopeNotice ||
    hardeningReport?.os_scope_notice ||
    DEFAULT_OS_SCOPE_NOTICE;

  const lines = [
    '# OMEGA · Verificación de Integridad del Dispositivo',
    `- **Origen:** \`${result.sourceLabel}\``,
    `- **Artefactos evaluados:** ${result.filesAnalyzed ?? 1}`,
    `- **Indicadores evaluados:** ${result.analyzedCount}`,
    `- **Coincidencias CTI:** ${result.matchesCount}`,
    `- **Corte del catálogo CTI:** ${cutoffDate} (PR review + SHA-256)`,
    `- **Firmas YARA detectadas:** ${yaraHits.length}`,
    `- **Anomalías conductuales / Manifest.db:** ${anomalies.length}`,
    `- **Almacenamiento:** 0 bytes guardados en disco`,
    '',
  ];

  if (checks.length > 0) {
    lines.push('## Postura de Endurecimiento del Dispositivo (ADB USB)');
    checks.forEach((chk) => {
      lines.push(`- [${chk.status}] **${chk.control}** (\`${chk.value}\`): ${chk.detail}`);
    });
    lines.push('');
  }

  if (alerts.length > 0) {
    lines.push('## Alertas de Accesibilidad, Privilegios y Red');
    alerts.forEach((al, idx) => {
      lines.push(`${idx + 1}. [${al.severity}] **${al.category}** — \`${al.indicator}\`: ${al.detail}`);
    });
    lines.push('');
  }

  if (yaraHits.length > 0) {
    lines.push('## Caza de Firmas YARA en RAM');
    yaraHits.forEach((yh, idx) => {
      lines.push(
        `${idx + 1}. \`${yh.rule_name}\` — **${yh.spyware_family}** (${yh.cve}) en \`${yh.artifact}\` [${(yh.matched_strings || []).join(', ')}]: ${yh.description}`,
      );
    });
    lines.push('');
  }

  if (sockets.length > 0) {
    lines.push(`## Sockets Públicos de Kernel (${hardeningReport?.live_sockets_total || sockets.length})`);
    sockets.slice(0, 25).forEach((s) => {
      const flag = s.cti_match ? ` [CTI MATCH: ${s.spyware_family}]` : '';
      lines.push(`- \`${s.remote_ip}:${s.remote_port}\` (${s.state})${flag}`);
    });
    lines.push('');
  }

  if (result.findings.length === 0 && anomalies.length === 0 && yaraHits.length === 0) {
    lines.push(
      `## Resultado\n0 coincidencias detectadas en los artefactos analizados frente al catálogo CTI con corte ${cutoffDate}.`,
    );
  } else {
    if (result.findings.length > 0) {
      lines.push('## Coincidencias CTI Detectadas');
      result.findings.forEach((f, idx) => {
        lines.push(`${idx + 1}. \`${f.ioc_value}\` — **${f.spyware_family}** (${f.artifact_origin})`);
      });
      lines.push('');
    }
    if (anomalies.length > 0) {
      lines.push('## Anomalías Conductuales y Manifest.db Detectadas (RAM)');
      anomalies.forEach((a, idx) => {
        lines.push(`${idx + 1}. [${a.severity}] \`${a.indicator}\` — **${a.category}** (\`${a.artifact}\`): ${a.detail}`);
      });
    }
  }

  lines.push('');
  lines.push('## Alcance y límites del sistema operativo (RNF9)');
  lines.push(scopeNotice);
  lines.push('- Activar Modo Aislamiento (Lockdown Mode) en iOS/macOS en perfiles de riesgo.');
  lines.push('- Mantener actualizaciones del SO al día y cifrado de disco completo (BitLocker / FileVault / LUKS).');

  return lines.join('\n');
}

export function isInspectableNetworkIndicator(val) {
  const s = String(val || '').trim();
  if (!s || s.includes(' ') || s.includes('@')) return false;
  return (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    /^([a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#].*)?$/i.test(s) ||
    /^(\d{1,3}\.){3}\d{1,3}(?:[:/].*)?$/.test(s)
  );
}
