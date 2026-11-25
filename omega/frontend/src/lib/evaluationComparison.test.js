import assert from 'node:assert/strict';
import test from 'node:test';
import { compareEvaluations } from './evaluationComparison.js';
import { presentEvaluation } from './evaluationPresentation.js';
test('comparison preserves unknown counts and never treats missing data as zero', () => {
  const older = { id: 'a', operation: 'PC_LIVE', result: { observations: {} } };
  const newer = { id: 'b', operation: 'PC_LIVE', result: { observations: { total_matches: 0 } } };
  assert.deepEqual([compareEvaluations(older, newer).before, compareEvaluations(older, newer).delta], [null, null]);
  assert.match(compareEvaluations(older, newer).limitation, /no demuestra corrección/);
  assert.throws(() => compareEvaluations(older, { ...newer, operation: 'LINK_VERIFY' }), /mismo tipo/);
});
test('general evidence presents the actual diagnosis and recommendations without inventing certainty', () => {
  const view = presentEvaluation({ observations: { diagnosis: { verdict_label: 'Revisión necesaria', rationale: 'Una señal observada', recommended_actions: ['Confirmar la señal'] } } });
  assert.equal(view.verdict, 'Revisión necesaria'); assert.equal(view.confidence, 'No consta');
  assert.deepEqual(view.actions, ['Confirmar la señal']);
});
