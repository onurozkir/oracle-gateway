import { describe, expect, it } from 'vitest';
import { runReview } from '@oracle-gate/adapters';
import { validSpec } from './helpers.js';

describe('blind reviewer context boundaries', () => {
  it('E2E-009: stage one is persisted before candidate access', async () => {
    const events: string[] = [];
    const provider = {
      id: 'test-only',
      model: 'deterministic-fixture',
      async interpret(input: unknown) {
        expect(Object.keys(input as object).sort()).toEqual([
          'definitions',
          'requirement',
          'requirementId',
        ]);
        events.push('interpret');
        return {
          requirementId: 'DISCOUNT-001',
          operator: '>',
          unit: 'cents',
          threshold: 10000,
          assumptions: [],
          uncertainty: [],
          proposedCases: validSpec.cases,
        };
      },
      async review() {
        events.push('review');
        return { differences: [], uncertainty: [] };
      },
    };
    const receipt = await runReview({
      provider,
      requirementId: 'DISCOUNT-001',
      requirement: validSpec.rule.description,
      definitions: [],
      persist: async () => {
        events.push('persist');
      },
      readCandidate: async () => {
        events.push('candidate');
        return [{ path: 'src/total.mjs', content: 'untrusted' }];
      },
    });
    expect(events).toEqual(['interpret', 'persist', 'candidate', 'review', 'persist']);
    expect(receipt.stage1Digest).toMatch(/^[a-f0-9]{64}$/);
  });
  it('malformed interpretation prevents candidate access', async () => {
    let accessed = false;
    const provider = {
      id: 'test',
      model: 'fixture',
      interpret: async () => ({ passed: true }),
      review: async () => ({}),
    };
    await expect(
      runReview({
        provider,
        requirementId: 'DISCOUNT-001',
        requirement: 'text',
        definitions: [],
        persist: async () => {},
        readCandidate: async () => {
          accessed = true;
          return [];
        },
      })
    ).rejects.toThrow();
    expect(accessed).toBe(false);
  });
  it('provider and persistence mutations cannot rewrite the input manifest', async () => {
    const { digest } = await import('@oracle-gate/core');
    let recordedInput = '';
    const interpretation = {
      requirementId: 'DISCOUNT-001',
      operator: '>' as const,
      unit: 'cents' as const,
      threshold: 10000,
      assumptions: [],
      uncertainty: [],
      proposedCases: validSpec.cases,
    };
    const expectedInput = {
      interpretation,
      candidateArtifacts: [{ path: 'src/total.mjs', content: 'original' }],
    };
    const provider = {
      id: 'mutation-test',
      model: 'fixture',
      interpret: async () => structuredClone(interpretation),
      async review(input: {
        interpretation: { threshold: number };
        candidateArtifacts: readonly { path: string; content: string }[];
      }) {
        input.interpretation.threshold = 777;
        input.candidateArtifacts[0]!.content = 'modified';
        return { differences: [], uncertainty: [] };
      },
    };
    await runReview({
      provider,
      requirementId: 'DISCOUNT-001',
      requirement: 'text',
      definitions: [],
      persist: async (stage, raw) => {
        const record = raw as { interpretation?: { threshold: number }; inputDigest: string };
        if (stage === 'interpretation') record.interpretation!.threshold = 111;
        else recordedInput = record.inputDigest;
      },
      readCandidate: async () => [{ path: 'src/total.mjs', content: 'original' }],
    });
    expect(recordedInput).toBe(digest(expectedInput));
  });
});
