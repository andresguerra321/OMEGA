export function presentEvaluation(result) {
  const data = result?.observations || {};
  const diagnosis = data.diagnosis || {};
  const actions = diagnosis.recommended_actions || diagnosis.recommendedActions || data.recommended_actions || data.recommendedActions || [];
  const findings = [data.findings, data.cti_matches, data.yara_hits, data.hits, data.manifest_findings, data.behavioral_anomalies].flatMap(value => Array.isArray(value) ? value : []);
  return {
    verdict: diagnosis.verdict_label || diagnosis.verdictLabel || data.verdict || 'Sin veredicto registrado',
    confidence: diagnosis.confidence || 'No consta',
    explanation: diagnosis.rationale || data.recommendation || 'Revisa las observaciones conservadas y los límites del análisis.',
    actions: Array.isArray(actions) ? actions.filter(value => typeof value === 'string') : [],
    findings: findings.slice(0, 40).map(item => typeof item === 'string' ? item : item.userFriendlyExplanation || item.explanation || item.description || item.context || item.rule_name || item.rule || item.ioc_value || item.severity || 'Observación técnica; consulta el detalle'),
    totalFindings: findings.length,
  };
}
