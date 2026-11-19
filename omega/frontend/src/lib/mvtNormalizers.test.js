import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeParallelResult, normalizeManualResult, buildForensicMarkdownReport } from './mvtNormalizers.js';

test('an empty capture cannot retain a legacy CLEAN verdict or inflate artifact counts', () => {
  const result = normalizeParallelResult({ total_files: 0, total_indicators_analyzed: 0,
    diagnosis: { verdict_code: 'CLEAN', verdict_label: 'No threats', rationale: 'All checked' } });
  assert.equal(result.verdictCode, 'INCOMPLETE');
  assert.notEqual(result.rationale, 'All checked');
  assert.match(buildForensicMarkdownReport(result), /Artefactos evaluados:\*\* 0/);
  assert.equal(normalizeManualResult({ analyzed_indicators: 0 }).verdictCode, 'INCOMPLETE');
});

test('coverage gaps remain visible without suppressing a positive detection', () => {
  const result = normalizeParallelResult({ total_indicators_analyzed: 10, coverage_gaps: ['firewall'],
    diagnosis: { verdict_code: 'DETECTED' }, subagents: [{ matches: [{ ioc_value: 'fixture.example', spyware_family: 'fixture' }] }] });
  assert.equal(result.verdictCode, 'DETECTED');
  assert.deepEqual(result.coverageGaps, ['firewall']);
  assert.equal(result.matchesCount, 1);
});
