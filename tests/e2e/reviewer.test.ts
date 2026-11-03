import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createReviewerProvider, ReviewerError } from '@oracle-gate/adapters';
import { verify } from '@oracle-gate/runtime';
import { createFixture } from '../fixture.js';
import { writeBundle } from '../authority.js';
import { validSpec } from '../helpers.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanups.splice(0)) await f();
  delete process.env.ORACLE_GATE_REVIEW_TEST_KEY;
});
async function setup(fail = false) {
  const f = await createFixture();
  cleanups.push(f.dispose);
  const bundle = join(f.root, 'authority');
  const pin = await writeBundle(bundle, {
    schemaVersion: 1,
    profile: 'standard',
    requireReview: true,
    maxEvidenceAgeMs: 60000,
  });
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    if (fail) {
      res.statusCode = 429;
      res.end('sensitive-body');
      return;
    }
    let body = '';
    for await (const chunk of req) body += String(chunk);
    const request = JSON.parse(body);
    const envelope = JSON.parse(request.messages[1].content);
    requests.push(envelope);
    const result =
      envelope.stage === 'interpretation'
        ? {
            requirementId: 'DISCOUNT-001',
            operator: '>',
            unit: 'cents',
            threshold: 10000,
            assumptions: [],
            uncertainty: [],
            proposedCases: validSpec.cases,
          }
        : { differences: [], uncertainty: [] };
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }],
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error();
  const reviewer = createReviewerProvider({
    type: 'openai-compatible',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: 'test-model',
    apiKeyEnv: 'ORACLE_GATE_REVIEW_TEST_KEY',
  });
  process.env.ORACLE_GATE_REVIEW_TEST_KEY = 'integration-private-key';
  return { ...f, bundle, pin, reviewer, requests };
}
it('runs both reviewer stages, audits hashes and never promotes cooperative review to protected evidence', async () => {
  const f = await setup();
  await writeFile(
    join(f.repo, 'self.test.mjs'),
    (await readFile(join(f.repo, 'self.test.mjs'), 'utf8')) +
      `\nif(process.env.ORACLE_GATE_REVIEW_TEST_KEY)throw new Error('reviewer secret reached candidate');\n`
  );
  await writeFile(
    join(f.repo, 'src/total.mjs'),
    (await readFile(join(f.repo, 'src/total.mjs'), 'utf8')) + '\n// PRIVATE_CANDIDATE_MARKER\n'
  );
  const candidate = await f.commit('reviewed candidate');
  const report = await verify({
    repo: f.repo,
    candidate,
    bundle: f.bundle,
    bundleSha256: f.pin,
    localDemo: true,
    reviewer: f.reviewer,
  });
  expect(f.requests.map((r) => r.stage)).toEqual(['interpretation', 'review']);
  expect(JSON.stringify(f.requests[0])).not.toContain('PRIVATE_CANDIDATE_MARKER');
  expect(JSON.stringify(f.requests[1])).toContain('PRIVATE_CANDIDATE_MARKER');
  expect(report.input.evidence.find((e) => e.kind === 'SELF_TESTS')?.status).toBe('PASS');
  expect(report.review?.stages).toHaveLength(2);
  expect(report.review?.stages[0]?.responseDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(report.review?.artifactManifest.some((a) => a.path === 'src/total.mjs')).toBe(true);
  expect(report.decision.verdict).toBe('INCONCLUSIVE');
  expect(JSON.stringify(report)).not.toContain('integration-private-key');
});
it('keeps reviewer failures inconclusive and authoritative oracle failures rejected', async () => {
  const f = await setup(true);
  const report = await verify({
    repo: f.repo,
    candidate: f.correct,
    bundle: f.bundle,
    bundleSha256: f.pin,
    localDemo: true,
    reviewer: f.reviewer,
  });
  expect(report.decision.verdict).toBe('INCONCLUSIVE');
  expect(report.review?.reasonCode).toBe('HTTP_ERROR');
  expect(JSON.stringify(report)).not.toContain('sensitive-body');
  const wrong = await verify({
    repo: f.repo,
    candidate: f.wrong,
    bundle: f.bundle,
    bundleSha256: f.pin,
    localDemo: true,
    reviewer: f.reviewer,
  });
  expect(wrong.decision.verdict).toBe('REJECT');
});
it('fails closed rather than silently truncating reviewer context', async () => {
  const f = await setup();
  await writeFile(join(f.repo, 'large.ts'), 'x'.repeat(600000));
  const candidate = await f.commit('oversized reviewer context');
  const report = await verify({
    repo: f.repo,
    candidate,
    bundle: f.bundle,
    bundleSha256: f.pin,
    localDemo: true,
    reviewer: f.reviewer,
  });
  expect(report.review?.reasonCode).toBe('CONTEXT_LIMIT');
  expect(report.decision.verdict).toBe('INCONCLUSIVE');
  expect(f.requests).toHaveLength(1);
});
it.each(['uncertainty', 'boundary', 'proposed-case'] as const)(
  'retains stage-one %s when stage two fails',
  async (conflict) => {
    const f = await setup();
    const pin = await writeBundle(f.bundle, {
      schemaVersion: 1,
      profile: 'standard',
      requireReview: false,
      maxEvidenceAgeMs: 60000,
    });
    const reviewer = {
      id: 'stage-failure-fixture',
      model: 'fixture',
      interpret: async () => ({
        requirementId: 'DISCOUNT-001',
        operator: conflict === 'boundary' ? '>=' : '>',
        unit: 'cents',
        threshold: 10000,
        assumptions: [],
        uncertainty: conflict === 'uncertainty' ? ['Threshold wording needs resolution'] : [],
        proposedCases: validSpec.cases.map((c) =>
          conflict === 'proposed-case' && c.id === 'exact-threshold'
            ? { ...c, expected: { totalCents: 9000 } }
            : c
        ),
      }),
      review: async () => {
        throw new ReviewerError('TIMEOUT');
      },
    };
    const report = await verify({
      repo: f.repo,
      candidate: f.correct,
      bundle: f.bundle,
      bundleSha256: pin,
      localDemo: true,
      reviewer,
    });
    expect(report.input.disagreements.length).toBeGreaterThan(0);
    expect(report.review?.interpretation).toBeDefined();
    expect(report.decision.verdict).toBe('INCONCLUSIVE');
  }
);
it('keeps maximum-length structured findings valid and preserves oracle rejection', async () => {
  const f = await setup();
  const pin = await writeBundle(f.bundle, {
    schemaVersion: 1,
    profile: 'standard',
    requireReview: false,
    maxEvidenceAgeMs: 60000,
  });
  const reviewer = {
    id: 'long-finding',
    model: 'fixture',
    interpret: async () => ({
      requirementId: 'DISCOUNT-001',
      operator: '>',
      unit: 'cents',
      threshold: 10000,
      assumptions: [],
      uncertainty: [],
      proposedCases: validSpec.cases,
    }),
    review: async () => ({
      differences: [
        { requirementId: 'DISCOUNT-001', location: 'file:1', description: 'x'.repeat(4096) },
      ],
      uncertainty: [],
    }),
  };
  const report = await verify({
    repo: f.repo,
    candidate: f.wrong,
    bundle: f.bundle,
    bundleSha256: pin,
    localDemo: true,
    reviewer,
  });
  expect(report.decision.verdict).toBe('REJECT');
  expect(report.review?.findings[0]?.description).toHaveLength(4096);
});
