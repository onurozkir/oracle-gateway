import { afterEach, expect, it } from 'vitest';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Policy } from '@oracle-gate/core';
import { verify, loadBundle } from '@oracle-gate/runtime';
import { createFixture } from '../fixture.js';
import { writeBundle } from '../authority.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanups.splice(0)) await f();
});
async function setup(policy?: Policy) {
  const f = await createFixture();
  cleanups.push(f.dispose);
  const bundle = join(f.root, 'authority');
  const bundleSha256 = await writeBundle(bundle, policy);
  return { ...f, bundle, bundleSha256 };
}
it('E2E-001: real wrong commit has green self-tests but exact threshold is REJECT', async () => {
  const f = await setup();
  const report = await verify({
    repo: f.repo,
    candidate: f.wrong,
    bundle: f.bundle,
    bundleSha256: f.bundleSha256,
    localDemo: true,
  });
  expect(report.input.evidence.find((e) => e.kind === 'SELF_TESTS')?.status).toBe('PASS');
  expect(report.input.evidence.find((e) => e.kind === 'ORACLE')?.observations).toMatchObject({
    cases: expect.arrayContaining([
      { id: 'exact-threshold', input: 10000, expected: 10000, actual: 9000, status: 'FAIL' },
    ]),
  });
  expect(report.decision.verdict).toBe('REJECT');
});
it('E2E-002: correct commit satisfies every obligation in local standard policy', async () => {
  const f = await setup();
  const report = await verify({
    repo: f.repo,
    candidate: f.correct,
    bundle: f.bundle,
    bundleSha256: f.bundleSha256,
    localDemo: true,
  });
  expect(report.decision.verdict).toBe('ACCEPT');
  expect(report.input.assurance).toBe('local-unprotected');
  expect(report.input.purpose).toBe('demonstration');
});
it('verifies a Git commit when the temporary directory is an alias', async () => {
  const f = await setup();
  const target = join(f.root, 'actual-temp');
  const alias = join(f.root, 'temp-alias');
  await mkdir(target);
  await symlink(target, alias, 'junction');
  const key = process.platform === 'win32' ? 'TEMP' : 'TMPDIR';
  const original = process.env[key];
  process.env[key] = alias;
  try {
    const report = await verify({ ...f, candidate: f.correct, localDemo: true });
    expect(report.decision.verdict).toBe('ACCEPT');
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});
it('checks saved edits and an untracked import even when HEAD contains different code', async () => {
  const f = await setup();
  await writeFile(join(f.repo, 'src', 'untracked.mjs'), 'export const ready = true;');
  await writeFile(
    join(f.repo, 'run.mjs'),
    "import { ready } from './src/untracked.mjs';\nif (ready) process.exit(27);"
  );
  const report = await verify({
    repo: f.repo,
    bundle: f.bundle,
    bundleSha256: f.bundleSha256,
    localDemo: true,
  });
  expect(report.input.candidate).toMatchObject({ source: 'workspace', dirty: false });
  expect(report.decision.verdict).toBe('INFRASTRUCTURE_ERROR');
  expect(report.workspace?.freshness).toBe('CURRENT');
  await writeFile(
    join(f.repo, 'src', 'untracked.mjs'),
    "import { readFileSync } from 'node:fs';\n" +
      "const { amountCents } = JSON.parse(readFileSync(0, 'utf8'));\n" +
      'console.log(JSON.stringify({ totalCents: amountCents > 10000 ? amountCents * 0.9 : amountCents }));'
  );
  await writeFile(join(f.repo, 'run.mjs'), "import './src/untracked.mjs';");
  expect((await verify({ ...f, localDemo: true })).decision.verdict).toBe('ACCEPT');
});
it('can verify an explicit commit after a workspace run creates untracked Oracle records', async () => {
  const f = await setup();
  expect((await verify({ ...f, localDemo: true })).decision.verdict).toBe('ACCEPT');
  expect(await f.git('status', '--porcelain')).toContain('?? .oracle/');
  const git = await verify({ ...f, candidate: f.correct, localDemo: true });
  expect(git.input.candidate).toMatchObject({ commitSha: f.correct, dirty: false });
  expect(git.decision.verdict).toBe('ACCEPT');
  await writeFile(join(f.repo, 'untracked.txt'), 'real untracked project data');
  await expect(verify({ ...f, candidate: f.correct, localDemo: true })).rejects.toThrow('dirty');
});
it('E2E-006/014: no acknowledgement or arbitrary pin cannot manufacture trust', async () => {
  const f = await setup();
  const opts = { repo: f.repo, candidate: f.correct, bundle: f.bundle };
  expect((await verify(opts)).decision.verdict).toBe('INCONCLUSIVE');
  expect(
    (await verify({ ...opts, localDemo: true, bundleSha256: 'f'.repeat(64) })).decision.verdict
  ).toBe('INCONCLUSIVE');
});
it('E2E-007/008: tampered approval or policy cannot pass the pinned bundle', async () => {
  const f = await setup();
  await writeFile(join(f.bundle, 'policy.yaml'), 'schemaVersion: 1\napproved: true\n');
  await expect(loadBundle(f.bundle)).rejects.toThrow();
});
it('E2E-012: candidate verifier crash is an infrastructure error', async () => {
  const f = await setup();
  await writeFile(join(f.repo, 'run.mjs'), 'process.exit(27);');
  const candidate = await f.commit('crashing executable');
  const report = await verify({
    repo: f.repo,
    candidate,
    bundle: f.bundle,
    bundleSha256: f.bundleSha256,
    localDemo: true,
  });
  expect(report.decision.verdict).toBe('INFRASTRUCTURE_ERROR');
});
it('critical correct candidate is INCONCLUSIVE without protected review', async () => {
  const f = await setup({
    schemaVersion: 1,
    profile: 'critical',
    requireReview: true,
    maxEvidenceAgeMs: 60000,
  });
  const report = await verify({
    repo: f.repo,
    candidate: f.correct,
    bundle: f.bundle,
    bundleSha256: f.bundleSha256,
    localDemo: true,
  });
  expect(report.decision.verdict).toBe('INCONCLUSIVE');
});
it('protected mode fails closed before executing candidate code', async () => {
  const f = await setup();
  await expect(
    verify({
      repo: f.repo,
      candidate: f.correct,
      bundle: f.bundle,
      protectedMode: true,
    })
  ).rejects.toThrow(/protected.*unavailable/i);
});
