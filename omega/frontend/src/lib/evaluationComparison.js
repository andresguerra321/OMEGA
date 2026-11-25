export function compareEvaluations(older, newer) {
  if (!older || !newer || older.id === newer.id) throw new Error('Selecciona dos evaluaciones diferentes.');
  if (older.operation !== newer.operation) throw new Error('Compara evaluaciones del mismo tipo.');
  const counts = value => {
    const fields = value?.result?.observations || {};
    for (const key of ['total_matches', 'totalMatches', 'hits_count', 'hitsCount']) {
      if (typeof fields[key] === 'number' && Number.isFinite(fields[key])) return fields[key];
    }
    return null;
  };
  const before = counts(older); const after = counts(newer);
  return { before, after, delta: before == null || after == null ? null : after - before,
    limitation: 'Comprueba que ambas evaluaciones tienen el mismo alcance. La variación de coincidencias no demuestra corrección ni ausencia de amenazas.' };
}
