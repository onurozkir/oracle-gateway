import { describe, expect, it } from 'vitest';
import {
  digest,
  canonicalize,
  calculateTotal,
  evaluate,
  PolicySchema,
  SpecSchema,
} from '@oracle-gate/core';
import { validInput, validSpec, evidence } from './helpers.js';

describe('canonical identity and integer currency', () => {
  it('sorts object keys recursively without reordering arrays', () => {
    expect(digest({ b: 2, a: { z: 1, a: 0 } })).toBe(digest({ a: { a: 0, z: 1 }, b: 2 }));
    expect(digest([1, 2])).not.toBe(digest([2, 1]));
    expect(canonicalize({ a: 1 })).toBe('{"a":1}');
    expect(() => digest({ a: undefined })).toThrow();
    expect(() => digest(Number.NaN)).toThrow();
    expect(() => digest(new Array(2))).toThrow();
  });
  it.each([
    [9900, 9900],
    [10000, 10000],
    [10100, 9090],
    [10005, 9005],
    [Number.MAX_SAFE_INTEGER, 8106479329266892],
  ])('money %i → %i', (input, output) => {
    expect(calculateTotal(input)).toBe(output);
  });
  it.each([-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe money %s', (input) => {
    expect(() => calculateTotal(input)).toThrow();
  });
});

describe('strict schemas', () => {
  it('does not accept sensitivity-tool policy as part of the standalone contract', () => {
    expect(
      PolicySchema.safeParse({
        schemaVersion: 1,
        profile: 'standard',
        requireReview: false,
        maxEvidenceAgeMs: 60000,
      }).success
    ).toBe(true);
    expect(
      PolicySchema.safeParse({
        schemaVersion: 1,
        profile: 'standard',
        requireReview: false,
        requireSensitivity: true,
        maxEvidenceAgeMs: 60000,
      }).success
    ).toBe(false);
  });
  it('rejects self-approved and empty oracle payloads', () => {
    expect(SpecSchema.safeParse({ ...validSpec, approved: true }).success).toBe(false);
    expect(SpecSchema.safeParse({ ...validSpec, cases: [] }).success).toBe(false);
    expect(
      SpecSchema.safeParse({ ...validSpec, cases: [validSpec.cases[0], validSpec.cases[0]] })
        .success
    ).toBe(false);
  });
  it('critical policies cannot switch off their obligations', () => {
    expect(
      PolicySchema.safeParse({ ...validInput().policy, profile: 'critical', requireReview: false })
        .success
    ).toBe(false);
  });
});

describe('deterministic fail-closed policy', () => {
  it('exhausts all 216 combinations of required check states and precedence', () => {
    const states = ['PASS', 'FAIL', 'UNKNOWN', 'SKIPPED', 'ERROR', 'MISSING'] as const;
    const kinds = ['SELF_TESTS', 'ORACLE', 'REVIEW'] as const;
    const precedence = { ERROR: 0, FAIL: 1, UNKNOWN: 2, SKIPPED: 2, MISSING: 2, PASS: 3 };
    const verdicts = ['INFRASTRUCTURE_ERROR', 'REJECT', 'INCONCLUSIVE', 'ACCEPT'];
    for (const a of states)
      for (const b of states)
        for (const c of states) {
          const selected = [a, b, c];
          const input = validInput();
          input.evidence = kinds.flatMap((kind, i) => {
            const status = selected[i]!;
            return status === 'MISSING' ? [] : [evidence(kind, status)];
          });
          expect(evaluate(input).verdict, selected.join('/')).toBe(
            verdicts[Math.min(...selected.map((s) => precedence[s]))]
          );
        }
  });
  it('accepts a complete local demonstration while labeling assurance', () => {
    expect(evaluate(validInput()).verdict).toBe('ACCEPT');
  });
  it('never accepts bare candidate pass claims', () => {
    expect(() => evaluate({ oraclePassed: true })).toThrow();
  });
  it.each(['SELF_TESTS', 'ORACLE', 'REVIEW'] as const)('missing %s blocks acceptance', (kind) => {
    const input = validInput();
    input.evidence = input.evidence.filter((e) => e.kind !== kind);
    expect(evaluate(input).verdict).toBe('INCONCLUSIVE');
  });
  it('rejects trusted oracle mismatch even if reviewer is absent', () => {
    const input = validInput();
    input.evidence = [evidence('ORACLE', 'FAIL'), evidence('SELF_TESTS', 'PASS')];
    expect(evaluate(input).verdict).toBe('REJECT');
  });
  it.each(['commitSha', 'treeSha'] as const)('stale %s blocks even rejection evidence', (field) => {
    const input = validInput();
    const candidate = input.evidence[0]!.candidate;
    if ('source' in candidate) throw new Error('Expected a Git fixture');
    candidate[field] = 'f'.repeat(40);
    expect(evaluate(input).verdict).toBe('INCONCLUSIVE');
  });
  it.each(['UNKNOWN', 'SKIPPED', 'ERROR', 'FAIL'] as const)('maps required oracle %s', (status) => {
    const input = validInput();
    input.evidence = input.evidence.filter((e) => e.kind !== 'ORACLE');
    input.evidence.push(evidence('ORACLE', status));
    expect(evaluate(input).verdict).toBe(
      status === 'ERROR' ? 'INFRASTRUCTURE_ERROR' : status === 'FAIL' ? 'REJECT' : 'INCONCLUSIVE'
    );
  });
  it('requires pinned local bundle acknowledgement and matching identity', () => {
    const input = validInput();
    input.trust = 'unapproved';
    expect(evaluate(input).verdict).toBe('INCONCLUSIVE');
  });
  it('critical mode never promotes local execution to release authority', () => {
    const input = validInput();
    input.policy.profile = 'critical';
    expect(evaluate(input).verdict).toBe('INCONCLUSIVE');
  });
  it('duplicate evidence cannot conceal a failure', () => {
    const input = validInput();
    input.evidence.push(evidence('ORACLE', 'PASS'));
    expect(evaluate(input).verdict).toBe('INCONCLUSIVE');
  });
  it('same-assumption review cannot override an oracle failure', () => {
    const input = validInput();
    input.evidence = input.evidence.map((e) =>
      e.kind === 'ORACLE' ? evidence('ORACLE', 'FAIL') : e
    );
    expect(evaluate(input).verdict).toBe('REJECT');
  });
  it('reviewer disagreement escalates', () => {
    const input = validInput();
    input.disagreements = ['DISCOUNT-001: inclusive vs exclusive'];
    expect(evaluate(input).verdict).toBe('INCONCLUSIVE');
  });
});
