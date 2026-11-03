import { expect, it } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest, evaluate, ReportSchema } from '@oracle-gate/core';
import {
  parseYaml,
  verify,
  renderReport,
  captureCandidate,
  withSnapshot,
} from '@oracle-gate/runtime';
import { createFixture } from './fixture.js';
import { writeBundle } from './authority.js';
import { validInput } from './helpers.js';
it('rejects YAML duplicate keys, custom tags and aliases', () => {
  for (const raw of ['a: 1\na: 2', 'a: !approved true', 'a: &x {value: 1}\nb: *x'])
    expect(() => parseYaml(raw)).toThrow();
});
it('cannot reuse stale oracle or policy evidence', () => {
  for (const field of ['oracleSha256', 'policySha256', 'specSha256'] as const) {
    const input = validInput();
    input.evidence[0]![field] = 'f'.repeat(64);
    expect(evaluate(input).verdict).toBe('INCONCLUSIVE');
  }
  const input = validInput();
  input.now = '2026-11-04T00:00:00.000Z';
  expect(evaluate(input).reasons).toContain('STALE_EVIDENCE');
});
it('changed source checkout during verification invalidates evidence', async () => {
  const f = await createFixture();
  try {
    const bundle = join(f.root, 'authority');
    const pin = await writeBundle(bundle);
    await writeFile(
      join(f.repo, 'run.mjs'),
      (await readFile(join(f.repo, 'run.mjs'), 'utf8')) +
        `\nimport {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(f.repo, 'changed.txt'))}, 'stale');\n`
    );
    const candidate = await f.commit('changes original checkout during execution');
    const report = await verify({
      repo: f.repo,
      candidate,
      bundle,
      bundleSha256: pin,
      localDemo: true,
    });
    expect(report.decision.verdict).toBe('INCONCLUSIVE');
  } finally {
    await f.dispose();
  }
});
it('self-test generated ignored files cannot contaminate the oracle environment', async () => {
  const f = await createFixture();
  try {
    await f.git('checkout', '--detach', f.wrong);
    const bundle = join(f.root, 'authority');
    const pin = await writeBundle(bundle);
    await writeFile(join(f.repo, '.gitignore'), '.test-mode\n');
    await writeFile(
      join(f.repo, 'self.test.mjs'),
      (await readFile(join(f.repo, 'self.test.mjs'), 'utf8')) +
        `\nimport {writeFileSync} from 'node:fs'; writeFileSync('.test-mode','yes');\n`
    );
    await writeFile(
      join(f.repo, 'run.mjs'),
      `import {calculateTotal} from './src/total.mjs'; import {existsSync} from 'node:fs'; import {createInterface} from 'node:readline'; for await(const line of createInterface({input:process.stdin})) { const {amountCents}=JSON.parse(line); console.log(JSON.stringify({totalCents:amountCents===10000&&existsSync('.test-mode')?10000:calculateTotal(amountCents)})); }`
    );
    const candidate = await f.commit('self-test contaminates ignored runtime state');
    const report = await verify({
      repo: f.repo,
      candidate,
      bundle,
      bundleSha256: pin,
      localDemo: true,
    });
    expect(report.decision.verdict).toBe('REJECT');
  } finally {
    await f.dispose();
  }
});
it('entry traversal cannot execute code outside the snapshot', async () => {
  const f = await createFixture();
  try {
    const bundle = join(f.root, 'authority');
    const pin = await writeBundle(bundle);
    await expect(
      verify({
        repo: f.repo,
        candidate: f.correct,
        bundle,
        bundleSha256: pin,
        localDemo: true,
        entry: process.execPath,
      })
    ).rejects.toThrow(/escapes/);
  } finally {
    await f.dispose();
  }
});
it('rejects symlink Git entries before checkout', async () => {
  const f = await createFixture();
  try {
    const blob = await f.git('rev-parse', 'HEAD:src/total.mjs');
    await f.git('update-index', '--add', '--cacheinfo', `120000,${blob},link.mjs`);
    await f.git('commit', '-m', 'symlink entry');
    const candidate = await captureCandidate(f.repo, 'HEAD', true);
    await expect(withSnapshot(f.repo, candidate, async () => {})).rejects.toThrow(/symlink/);
  } finally {
    await f.dispose();
  }
});
it('historical report rejects a modified verdict and never reruns code', () => {
  const input = validInput();
  const report = {
    schemaVersion: 1,
    runId: '00000000-0000-4000-8000-000000000000',
    timestamp: input.now,
    input,
    decision: { ...evaluate(input), verdict: 'REJECT' },
    approval: {
      status: 'local-pinned',
      source: 'fixture',
      bundleSha256: digest('fixture'),
      authorityId: null,
      approvalRecordId: null,
    },
    tools: { gateway: '0.1.0' },
    limitations: [],
  };
  expect(ReportSchema.safeParse(report).success).toBe(true);
  expect(() => renderReport(report)).toThrow(/decision/);
});
