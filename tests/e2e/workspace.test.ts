import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import {
  LocalExecutor,
  approveTask,
  reviewTask,
  reviseTask,
  startTask,
  verify,
} from '@oracle-gate/runtime';
import { writeBundle } from '../authority.js';
import { validSpec } from '../helpers.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'oracle-workspace-test-'));
  roots.push(root);
  const repo = join(root, 'project');
  const bundle = join(root, 'authority');
  await mkdir(repo);
  await writeFile(join(repo, 'self.test.mjs'), 'process.exit(0);');
  const bundleSha256 = await writeBundle(bundle);
  return { root, repo, bundle, bundleSha256, localDemo: true };
}

function entry(operator: string) {
  return `import { readFileSync } from 'node:fs';
const { amountCents } = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify({ totalCents: amountCents ${operator} 10000 ? amountCents * 0.9 : amountCents }));`;
}

async function taskInputs(options: Awaited<ReturnType<typeof setup>>) {
  const spec = { ...validSpec, source: { uri: validSpec.source.uri } };
  const requirement = join(options.bundle, 'requirement.md');
  const contract = join(options.root, 'contract.yaml');
  const policy = {
    schemaVersion: 1,
    profile: 'standard',
    requireReview: false,
    maxEvidenceAgeMs: 60_000,
  };
  await writeFile(contract, stringify({ spec, policy }));
  return { repo: options.repo, requirement, contract, spec, policy };
}

it('checks saved files without Git and rejects a wrong threshold despite green self-tests', async () => {
  const options = await setup();
  await writeFile(join(options.repo, 'run.mjs'), entry('>'));
  expect((await verify(options)).decision.verdict).toBe('ACCEPT');
  await writeFile(join(options.repo, 'run.mjs'), entry('>='));
  const report = await verify(options);
  expect(report.input.evidence[0]?.status).toBe('PASS');
  expect(report.decision.verdict).toBe('REJECT');
});

it('binds concurrent tasks to their own approvals and reports shared changes from their baseline', async () => {
  const { repo, ...options } = await setup();
  const draft = await taskInputs({ repo, ...options });
  await writeFile(join(repo, 'run.mjs'), entry('>='));
  await writeFile(join(repo, 'delete.txt'), 'original');
  await mkdir(join(repo, 'scratch'));
  await writeFile(join(repo, '.env'), 'LOCAL_KEY=hidden');
  const exclude = [process.platform === 'win32' ? 'SCRATCH' : 'scratch'];
  const [first, second] = await Promise.all([
    startTask({ ...draft, exclude }),
    startTask({ ...draft, exclude }),
  ]);
  expect(first.taskId).not.toBe(second.taskId);
  expect(first.baselineSha256).toBe(second.baselineSha256);
  expect(first.contractSha256).toBe(second.contractSha256);
  await Promise.all([first, second].map((t) => approveTask(repo, t.taskId, t.contractSha256)));
  await writeFile(
    draft.contract,
    stringify({ spec: draft.spec, policy: draft.policy, execution: { timeoutMs: 20000 } })
  );
  const revision = await reviseTask(repo, first.taskId, draft.contract);
  expect(revision.contractSha256).not.toBe(first.contractSha256);
  await expect(
    verify({ repo, task: first.taskId, contractSha256: revision.contractSha256 })
  ).rejects.toThrow('TASK_APPROVAL_REQUIRED');
  await writeFile(join(repo, 'run.mjs'), entry('>'));
  await writeFile(join(repo, 'added.txt'), 'new');
  await writeFile(join(repo, 'scratch', 'output.txt'), 'excluded');
  await writeFile(join(repo, '.env'), 'LOCAL_KEY=changed');
  await rm(join(repo, 'delete.txt'));
  const reports = await Promise.all(
    [first, second, first].map((t) =>
      verify({ repo, task: t.taskId, contractSha256: t.contractSha256 })
    )
  );
  expect(new Set(reports.map((r) => r.runId)).size).toBe(3);
  for (const [index, report] of reports.entries()) {
    const t = index === 1 ? second : first;
    expect(report.decision.verdict).toBe('ACCEPT');
    expect(report.workspace).toEqual({
      freshness: 'CURRENT',
      task: {
        id: t.taskId,
        contractSha256: t.contractSha256,
        baselineSha256: t.baselineSha256,
        changes: { added: ['added.txt'], modified: ['run.mjs'], deleted: ['delete.txt'] },
      },
    });
    const saved = join(repo, '.oracle', 'tasks', t.taskId, 'runs', report.runId + '.json');
    expect(JSON.parse(await readFile(saved, 'utf8'))).toEqual(report);
  }
  expect(await readdir(join(repo, '.oracle', 'tasks', first.taskId, 'runs'))).toHaveLength(2);
  expect(await readdir(join(repo, '.oracle', 'tasks', second.taskId, 'runs'))).toHaveLength(1);
  const baseline = join(repo, '.oracle', 'snapshots', first.baselineSha256);
  await writeFile(join(baseline, 'files', 'run.mjs'), entry('>'));
  await expect(
    verify({ repo, task: first.taskId, contractSha256: first.contractSha256 })
  ).rejects.toThrow('content hash mismatch');
  await rm(join(baseline, 'manifest.json'));
  await expect(
    verify({ repo, task: first.taskId, contractSha256: first.contractSha256 })
  ).rejects.toThrow('WORKSPACE_BASELINE_MISSING');
});

it('reviews only the draft before approval and sees frozen code in every final check', async () => {
  const options = await setup();
  const draft = await taskInputs(options);
  const original = entry('>');
  await writeFile(join(options.repo, 'run.mjs'), original);
  const task = await startTask(draft);
  const interpretation = {
    requirementId: validSpec.requirementId,
    operator: '>',
    unit: 'cents',
    threshold: 10000,
    assumptions: [],
    uncertainty: [],
    proposedCases: validSpec.cases,
  };
  const provider = {
    id: 'test',
    model: 'in-process',
    async interpret() {
      return interpretation;
    },
    async review() {
      return { differences: [], uncertainty: [] };
    },
  };
  const draftReview = await reviewTask(options.repo, task.taskId, task.contractSha256, provider);
  expect(draftReview.audit.artifactManifest.map((file) => file.path)).toEqual(['contract.yaml']);
  await expect(
    verify({ repo: options.repo, task: task.taskId, contractSha256: task.contractSha256 })
  ).rejects.toThrow('TASK_APPROVAL_REQUIRED');
  await approveTask(options.repo, task.taskId, task.contractSha256);
  const report = await verify({
    repo: options.repo,
    task: task.taskId,
    contractSha256: task.contractSha256,
    reviewer: {
      ...provider,
      async interpret(input) {
        expect(Object.keys(input).sort()).toEqual(['definitions', 'requirement', 'requirementId']);
        await writeFile(join(options.repo, 'run.mjs'), entry('>='));
        return interpretation;
      },
      async review(input) {
        expect(input.candidateArtifacts.find((file) => file.path === 'run.mjs')?.content).toBe(
          original
        );
        return { differences: [], uncertainty: [] };
      },
    },
  });
  expect(report.review?.status).toBe('COMPLETE');
  expect(report.decision.verdict).toBe('ACCEPT');
  expect(report.workspace?.freshness).toBe('CHANGED');
  expect(report.workspace?.task?.changes.modified).toEqual([]);
});

it('rejects in-scope directory links', async () => {
  const options = await setup();
  await symlink(options.bundle, join(options.repo, 'linked'), 'junction');
  await expect(verify(options)).rejects.toThrow('Unsupported workspace entry');
});

it('drives task start, revise, approve, verify and report through the CLI', async () => {
  const options = await setup();
  const draft = await taskInputs(options);
  const executor = new LocalExecutor();
  const call = (...args: string[]) =>
    executor.run({
      executable: process.execPath,
      args: [resolve('bin/oracle-gate.js'), ...args],
      cwd: options.repo,
      timeoutMs: 30000,
    });
  await writeFile(join(options.repo, 'custom.mjs'), entry('>'));
  await writeFile(
    draft.contract,
    stringify({ spec: draft.spec, policy: draft.policy, execution: { entry: 'custom.mjs' } })
  );
  const started = await call(
    'task',
    'start',
    '--requirement',
    draft.requirement,
    '--contract',
    draft.contract
  );
  expect(started.exitCode, started.stderr).toBe(0);
  const { taskId, contractSha256 } = JSON.parse(started.stdout);
  const selected = ['--task', taskId, '--contract-sha256', contractSha256];
  const revised = await call('task', 'revise', '--task', taskId, '--contract', draft.contract);
  expect(revised.exitCode, revised.stderr).toBe(0);
  expect(JSON.parse(revised.stdout).contractSha256).toBe(contractSha256);
  expect((await call('verify', ...selected)).exitCode).toBe(1);
  expect((await call('task', 'approve', ...selected)).exitCode).toBe(0);
  expect((await call('verify', ...selected, '--entry', 'custom.mjs')).exitCode).toBe(1);
  expect((await call('verify', ...selected, '--candidate', 'HEAD')).exitCode).toBe(1);
  const verified = await call('verify', ...selected);
  expect(verified.exitCode, verified.stderr).toBe(0);
  expect(verified.stdout).toContain('Workspace snapshot');
  const runs = join(options.repo, '.oracle', 'tasks', taskId, 'runs');
  const [run] = await readdir(runs);
  const historical = await call('report', '--input', join(runs, run!));
  expect(historical.exitCode, historical.stderr).toBe(0);
  expect(historical.stdout).toContain('HISTORICAL RECORD');
  expect(historical.stdout).toContain(contractSha256);
}, 30000);
