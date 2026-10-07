import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSyntheticProof } from '../../scripts/proof/synthetic.js';

test('CDP composes original nodes in isolated cross-site frames with a transparent 120px gap', { timeout: 30000 }, async () => {
  const report = await runSyntheticProof();
  assert.ok(report.sources.every((source) => source.sessionType === 'iframe-target'), 'This test must actually exercise out-of-process iframe sessions.');
});

test('the same proof supports cross-origin frames when process isolation is disabled', { timeout: 30000 }, async () => {
  const report = await runSyntheticProof({ sameProcess: true });
  assert.ok(report.sources.every((source) => source.sessionType === 'page-context'), 'This test must exercise multiple contexts on the selected page session.');
});
