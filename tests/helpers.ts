import type { CheckEvidence, PolicyInput, Spec } from '@oracle-gate/core';
export const validSpec = {
  schemaVersion: 1,
  requirementId: 'DISCOUNT-001',
  source: { uri: 'discount.md', sha256: 'a'.repeat(64) },
  rule: {
    description: '100 TL üzerindeki siparişlere %10 indirim uygulanacak.',
    boundary: { operator: '>', amountCents: 10000 },
    discountBasisPoints: 1000,
  },
  adapter: { id: 'json-stdio-v1', inputField: 'amountCents', outputField: 'totalCents' },
  cases: [
    { id: 'below-threshold', input: { amountCents: 9900 }, expected: { totalCents: 9900 } },
    { id: 'exact-threshold', input: { amountCents: 10000 }, expected: { totalCents: 10000 } },
    { id: 'above-threshold', input: { amountCents: 10100 }, expected: { totalCents: 9090 } },
  ],
} satisfies Spec;
export const candidate = { commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), dirty: false };
export function evidence(
  kind: CheckEvidence['kind'],
  status: CheckEvidence['status']
): CheckEvidence {
  const observations =
    kind === 'ORACLE'
      ? {
          cases: [
            {
              id: 'exact-threshold',
              input: 10000,
              expected: 10000,
              actual: status === 'FAIL' ? 9000 : 10000,
              status: status === 'FAIL' ? 'FAIL' : 'PASS',
            },
          ],
        }
      : kind === 'REVIEW'
        ? {
            independent: true,
            stage1Digest: 'a'.repeat(64),
            stage2Digest: 'b'.repeat(64),
            provider: 'fixture',
            model: 'test',
            disagreements: [],
          }
        : { exitCode: status === 'FAIL' ? 1 : 0 };
  return {
    kind,
    status,
    candidate: { ...candidate },
    specSha256: 'a'.repeat(64),
    oracleSha256: 'b'.repeat(64),
    policySha256: 'c'.repeat(64),
    verifierId: 'gateway:' + kind,
    verifierVersion: '0.1.0',
    startedAt: '2026-11-03T00:00:00.000Z',
    finishedAt: '2026-11-03T00:00:01.000Z',
    observations,
    provenance: { executor: 'local-unprotected', inputDigests: {} },
  } as CheckEvidence;
}
export function validInput(): PolicyInput {
  return {
    candidate: { ...candidate },
    specSha256: 'a'.repeat(64),
    oracleSha256: 'b'.repeat(64),
    policySha256: 'c'.repeat(64),
    policy: {
      schemaVersion: 1,
      profile: 'standard',
      requireReview: true,
      maxEvidenceAgeMs: 60000,
    },
    trust: 'local-pinned',
    assurance: 'local-unprotected',
    purpose: 'demonstration',
    disagreements: [],
    now: '2026-11-03T00:00:02.000Z',
    evidence: ['SELF_TESTS', 'ORACLE', 'REVIEW'].map((kind) =>
      evidence(kind as CheckEvidence['kind'], 'PASS')
    ),
  };
}
