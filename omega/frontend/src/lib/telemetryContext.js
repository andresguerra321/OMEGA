export function formatRelativeTime(isoString) {
  if (!isoString) return 'Reciente';
  const ts = new Date(isoString).getTime();
  const diffHours = Math.floor((Date.now() - ts) / (1000 * 60 * 60));
  if (diffHours < 1) return 'Hace momentos';
  if (diffHours === 1) return 'Hace 1 h';
  if (diffHours < 24) return `Hace ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Ayer';
  return `Hace ${diffDays} d`;
}

export function formatClockTime(date = new Date()) {
  try {
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'ahora';
  }
}

export function getSmoothDelayMs(targetMs) {
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  ) {
    return 0;
  }
  return targetMs;
}

export function formatLinkTelemetryContext(res) {
  if (!res) return '';
  const ctiMatches = Array.isArray(res.cti_matches) ? res.cti_matches : [];
  const heuristics = Array.isArray(res.heuristics) ? res.heuristics : [];
  const owasp = Array.isArray(res.owasp_findings) ? res.owasp_findings : [];
  const vt = res.external_reputation?.virustotal;
  const abuse = res.external_reputation?.abuseipdb;
  const trace = res.trace_result;
  const lines = [
    `URL analizada: ${res.normalized_url || res.host || 'N/D'}`,
    `Host: ${res.host || 'N/D'} | Dominio raíz: ${res.root_domain || res.host || 'N/D'} | Esquema: ${res.scheme || 'N/D'}`,
    `Nivel de riesgo: ${res.risk_level || 'N/D'} — ${res.verdict || ''}`,
    res.recommendation ? `Recomendación: ${res.recommendation}` : '',
    res.passive_ct_certificates !== null && res.passive_ct_certificates !== undefined
      ? `Certificados CT (crt.sh/CertSpotter): ${res.passive_ct_certificates} registros`
      : 'Certificados CT: N/D',
    vt && vt.status === 'ok'
      ? `VirusTotal / Reputación: ${vt.malicious || 0} maliciosos, ${vt.suspicious || 0} sospechosos`
      : '',
    abuse && abuse.status === 'ok'
      ? `AbuseIPDB: Score ${abuse.abuse_confidence_score}% (${abuse.total_reports} reportes)`
      : '',
    ctiMatches.length > 0
      ? `Coincidencias CTI (${ctiMatches.length}): ${ctiMatches.slice(0, 5).map((m) => `${m.ioc_value} [${m.spyware_family || m.campaign || 'CTI'}: ${m.context || ''}]`).join(' ; ')}`
      : 'Coincidencias CTI: 0',
    owasp.length > 0
      ? `Reglas OWASP activadas (${owasp.length}): ${owasp.map((f) => `[${f.rule_id} ${f.severity}] ${f.title}: ${f.detail}`).join(' ; ')}`
      : '',
    heuristics.length > 0
      ? `Alertas estructurales (${heuristics.length}): ${heuristics.join(' ; ')}`
      : '',
    trace?.final_url && trace.final_url !== res.normalized_url
      ? `Destino tras redirecciones (sin JS): ${trace.final_url}`
      : '',
  ];
  return lines.filter(Boolean).join('\n');
}
