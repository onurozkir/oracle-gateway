import { canonicalize } from '@oracle-gate/core';
interface Seed {
  id: string;
  category: string;
  requirement: string;
  input: Record<string, unknown>;
  expected: unknown;
  wrong: () => unknown;
  corrected: () => unknown;
  ambiguous?: boolean;
}
export const seeds: Seed[] = [];
for (const [i, amount] of [1, 100, 10000, 100000, 50000, 250].entries())
  seeds.push({
    id: `boundary-${i}`,
    category: 'boundaries',
    requirement: `Discount only when amount > ${amount}`,
    input: { amount },
    expected: amount,
    wrong: () => amount * 0.9,
    corrected: () => amount,
  });
for (const [i, pair] of [
  [10005, 9005],
  [10015, 9014],
  [10025, 9023],
  [10035, 9032],
  [10045, 9041],
  [10055, 9050],
].entries()) {
  const [amount, expected] = pair as [number, number];
  seeds.push({
    id: `rounding-${i}`,
    category: 'rounding',
    requirement: 'Round final total half up to whole cents',
    input: { amount },
    expected,
    wrong: () => Number((BigInt(amount) * 9000n) / 10000n),
    corrected: () => Number((BigInt(amount) * 9000n + 5000n) / 10000n),
  });
}
for (const [i, role] of ['reader', 'editor', 'guest', 'support', 'billing', 'auditor'].entries())
  seeds.push({
    id: `roles-${i}`,
    category: 'role-access',
    requirement: 'Only admin may delete records',
    input: { role },
    expected: false,
    wrong: () => Boolean(role),
    corrected: () => role === 'admin',
  });
for (let i = 0; i < 6; i++)
  seeds.push({
    id: `tenant-${i}`,
    category: 'tenant-isolation',
    requirement: 'Resource tenant must equal authenticated tenant',
    input: { userTenant: `A${i}`, resourceTenant: `B${i}`, role: 'admin' },
    expected: false,
    wrong: () => true,
    corrected: () => false,
  });
for (const [i, category] of [
  'gift-card',
  'tax',
  'shipping',
  'donation',
  'subscription',
  'regulated',
].entries())
  seeds.push({
    id: `excluded-${i}`,
    category: 'exclusions',
    requirement: `${category} is excluded from discounts`,
    input: { category, amount: 10000 },
    expected: 10000,
    wrong: () => 9000,
    corrected: () => 10000,
  });
for (const [i, pair] of (
  [
    [0, 1],
    [0, 2],
    [0, 3],
    ['', 'x'],
    ['', 'y'],
    ['', 'z'],
  ] as const
).entries()) {
  const [value, fallback] = pair;
  seeds.push({
    id: `default-${i}`,
    category: 'null-default',
    requirement: 'Default only null/absent values; preserve zero and empty text',
    input: { value, fallback },
    expected: value,
    wrong: () => value || fallback,
    corrected: () => value ?? fallback,
  });
}
for (let i = 0; i < 6; i++)
  seeds.push({
    id: `contradiction-${i}`,
    category: 'contradictory-spec',
    requirement: `At threshold ${10000 + i}: discount applies AND discount does not apply`,
    input: { amount: 10000 + i },
    expected: null,
    wrong: () => 9000,
    corrected: () => null,
    ambiguous: true,
  });
export function runSeededBenchmark() {
  const start = performance.now();
  const cases = seeds.map((seed) => ({
    id: seed.id,
    category: seed.category,
    requirement: seed.requirement,
    input: seed.input,
    expected: seed.expected,
    actual: seed.wrong(),
    verdict: seed.ambiguous
      ? 'INCONCLUSIVE'
      : canonicalize(seed.wrong()) === canonicalize(seed.expected)
        ? 'ACCEPT'
        : 'REJECT',
    positiveControlPassed:
      !seed.ambiguous && canonicalize(seed.corrected()) === canonicalize(seed.expected),
  }));
  return {
    schemaVersion: 1,
    scope:
      'Synthetic in-process comparison smoke benchmark; not a model-quality or protected-runtime evaluation',
    count: cases.length,
    detected: cases.filter((c) => c.verdict === 'REJECT').length,
    inconclusive: cases.filter((c) => c.verdict === 'INCONCLUSIVE').length,
    falseAccepts: cases.filter((c) => c.verdict === 'ACCEPT').length,
    positiveControlsPassed: cases.filter((c) => c.positiveControlPassed).length,
    modelComparison: 'NOT_RUN',
    tokenCost: null,
    latencyMs: performance.now() - start,
    humanEscalations: cases.filter((c) => c.verdict === 'INCONCLUSIVE').length,
    cases,
  };
}
