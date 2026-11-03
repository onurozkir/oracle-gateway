import { expect, it } from 'vitest';
import { seeds, runSeededBenchmark } from '../scripts/benchmark-cases.js';
it('publishes 42 seeded counterexamples and positive controls across seven categories', () => {
  expect(seeds).toHaveLength(42);
  expect(new Set(seeds.map((s) => s.category)).size).toBe(7);
  const result = runSeededBenchmark();
  expect(result.detected).toBe(36);
  expect(result.inconclusive).toBe(6);
  expect(result.falseAccepts).toBe(0);
  expect(result.positiveControlsPassed).toBe(36);
  expect(result.modelComparison).toBe('NOT_RUN');
});
