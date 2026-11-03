import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  digest,
  evaluate,
  ReportSchema,
  type CheckEvidence,
  type CandidateIdentity,
  type Report,
  type ReviewerProvider,
} from '@oracle-gate/core';
import { LocalExecutor } from './executor.js';
import { captureCandidate, withSnapshot, isWithin, git } from './git.js';
import { compareJsonLine } from './oracle.js';
import { loadBundle } from './source.js';
import { readReviewArtifacts, runCandidateReview } from './review.js';
import {
  captureWorkspace,
  requireWorkspaceBaseline,
  withWorkspaceSnapshot,
  workspaceChanges,
  workspaceMatches,
} from './workspace.js';
import {
  executionDefaults,
  loadTaskVersion,
  requireTaskApproval,
  saveTaskReport,
} from './tasks.js';

export interface VerifyOptions {
  repo: string;
  candidate?: string;
  bundle?: string;
  task?: string;
  contractSha256?: string;
  bundleSha256?: string;
  localDemo?: boolean;
  protectedMode?: boolean;
  allowDirty?: boolean;
  entry?: string;
  selfTest?: string;
  timeoutMs?: number;
  reviewer?: ReviewerProvider;
}
async function prepareCandidate(
  repo: string,
  options: VerifyOptions,
  task?: Awaited<ReturnType<typeof loadTaskVersion>>
) {
  if (options.candidate !== undefined) {
    const ref = options.candidate;
    const candidate = await captureCandidate(repo, ref, options.allowDirty, true);
    const check = async (path: string, ref: string, ignoreOracleStore = false) => {
      const after = await captureCandidate(path, ref, true, ignoreOracleStore);
      if (
        after.dirty ||
        after.commitSha !== candidate.commitSha ||
        after.treeSha !== candidate.treeSha
      )
        candidate.dirty = true;
    };
    return {
      candidate,
      checkedSnapshot: <T>(work: (path: string) => Promise<T>) =>
        withSnapshot(repo, candidate, async (path) => {
          const result = await work(path);
          await check(path, 'HEAD');
          return result;
        }),
      readArtifacts: () =>
        withSnapshot(repo, candidate, async (path) => {
          const files = (await git(path, ['ls-files', '-z'])).split('\0').filter(Boolean).sort();
          return readReviewArtifacts(path, files);
        }),
      finish: async () => {
        await check(repo, ref, true);
        return undefined;
      },
    };
  }

  const scope = task?.metadata.exclude ?? [];
  const baseline = task && (await requireWorkspaceBaseline(repo, task.metadata.baselineSha256));
  const snapshot = await captureWorkspace(repo, scope);
  const candidate: CandidateIdentity = {
    source: 'workspace',
    snapshotSha256: snapshot.sha256,
    dirty: false,
  };
  const matches = (path: string, scope?: string[]) =>
    workspaceMatches(path, snapshot, scope).catch(() => undefined);
  return {
    candidate,
    checkedSnapshot: <T>(work: (path: string) => Promise<T>) =>
      withWorkspaceSnapshot(snapshot, async (path) => {
        const result = await work(path);
        if (!(await matches(path))) candidate.dirty = true;
        return result;
      }),
    readArtifacts: () =>
      withWorkspaceSnapshot(snapshot, (path) =>
        readReviewArtifacts(
          path,
          snapshot.manifest.map((file) => file.path)
        )
      ),
    finish: async (): Promise<Report['workspace']> => {
      const current = await matches(repo, scope);
      return {
        freshness: current === undefined ? 'UNKNOWN' : current ? 'CURRENT' : 'CHANGED',
        ...(task && baseline
          ? {
              task: {
                id: task.metadata.id,
                contractSha256: task.contractSha256,
                baselineSha256: baseline.sha256,
                changes: workspaceChanges(baseline, snapshot),
              },
            }
          : {}),
      };
    },
  };
}

export async function verify(options: VerifyOptions): Promise<Report> {
  if (options.protectedMode)
    throw new Error(
      'Protected executor/authority authentication unavailable; no candidate was executed'
    );
  const repo = await realpath(options.repo);
  if ((options.task === undefined) !== (options.contractSha256 === undefined))
    throw new Error('Provide --task and --contract-sha256 together');
  if (
    options.task !== undefined &&
    [
      options.candidate,
      options.bundle,
      options.bundleSha256,
      options.localDemo,
      options.allowDirty,
      options.entry,
      options.selfTest,
      options.timeoutMs,
    ].some((value) => value !== undefined)
  )
    throw new Error('Task verification cannot be combined with bundle, Git or execution overrides');
  if (options.candidate === undefined && options.allowDirty)
    throw new Error('--allow-dirty requires --candidate');
  const task =
    options.task !== undefined
      ? await loadTaskVersion(repo, options.task, options.contractSha256!)
      : undefined;
  const approval = task && (await requireTaskApproval(task));
  if (!task && !options.bundle) throw new Error('Provide --bundle or --spec inside a bundle');
  const bundle = task?.bundle ?? (await loadBundle(options.bundle!));
  if (!task && isWithin(repo, bundle.source))
    throw new Error('Oracle bundle must be outside candidate repository');
  const { candidate, checkedSnapshot, readArtifacts, finish } = await prepareCandidate(
    repo,
    options,
    task
  );
  const entry = task?.execution.entry ?? options.entry ?? executionDefaults.entry;
  const selfTest = task?.execution.selfTest ?? options.selfTest ?? executionDefaults.selfTest;
  const timeoutMs = task?.execution.timeoutMs ?? options.timeoutMs ?? executionDefaults.timeoutMs;
  const executor = new LocalExecutor();
  const evidence: CheckEvidence[] = [];
  let review: Report['review'];
  const disagreements: string[] = [];
  const record = (
    kind: CheckEvidence['kind'],
    status: CheckEvidence['status'],
    observations: unknown,
    startedAt: string,
    commandArgv?: string[]
  ) => {
    evidence.push({
      kind,
      status,
      observations,
      candidate: { ...candidate },
      specSha256: bundle.specSha256,
      oracleSha256: bundle.oracleSha256,
      policySha256: bundle.policySha256,
      verifierId: 'oracle-gate:' + kind.toLowerCase(),
      verifierVersion: '0.1.0',
      startedAt,
      finishedAt: new Date().toISOString(),
      provenance: {
        executor: executor.assurance,
        inputDigests: { bundle: bundle.bundleSha256 },
        ...(commandArgv ? { commandArgv } : {}),
      },
    } as CheckEvidence);
  };
  if (options.reviewer) {
    const startedAt = new Date().toISOString();
    const result = await runCandidateReview({
      readArtifacts,
      bundle,
      provider: options.reviewer,
    });
    review = result.audit;
    disagreements.push(...result.disagreements);
    record('REVIEW', 'UNKNOWN', result.observations, startedAt);
  }
  const safeFile = async (snapshot: string, name: string) => {
    const path = await realpath(resolve(snapshot, name));
    if (!isWithin(snapshot, path)) throw new Error('Candidate entry escapes snapshot');
    return path;
  };
  await checkedSnapshot(async (snapshot) => {
    const command = [
      process.execPath,
      '--max-old-space-size=128',
      await safeFile(snapshot, selfTest),
    ];
    const startedAt = new Date().toISOString();
    const self = await executor.run({
      executable: command[0]!,
      args: command.slice(1),
      cwd: snapshot,
      timeoutMs,
    });
    record(
      'SELF_TESTS',
      self.error || self.exitCode === null ? 'ERROR' : self.exitCode === 0 ? 'PASS' : 'FAIL',
      { exitCode: self.exitCode },
      startedAt,
      command
    );
  });
  const cases: Extract<CheckEvidence, { kind: 'ORACLE' }>['observations']['cases'] = [];
  const startedAt = new Date().toISOString();
  let oracleCommand: string[] = [];
  for (const c of bundle.spec.cases) {
    // Each case starts from the captured bytes in a fresh copy.
    await checkedSnapshot(async (snapshot) => {
      oracleCommand = [
        process.execPath,
        '--max-old-space-size=128',
        await safeFile(snapshot, entry),
      ];
      const r = await executor.run({
        executable: oracleCommand[0]!,
        args: oracleCommand.slice(1),
        cwd: snapshot,
        stdin: JSON.stringify(c.input) + '\n',
        timeoutMs,
      });
      const comparison =
        r.error || r.exitCode !== 0
          ? { actual: null, status: 'ERROR' as const }
          : compareJsonLine(r.stdout, c.expected.totalCents);
      cases.push({
        id: c.id,
        input: c.input.amountCents,
        expected: c.expected.totalCents,
        ...comparison,
      });
    });
  }
  record(
    'ORACLE',
    cases.some((c) => c.status === 'ERROR')
      ? 'ERROR'
      : cases.some((c) => c.status === 'FAIL')
        ? 'FAIL'
        : 'PASS',
    { cases },
    startedAt,
    oracleCommand
  );
  let pinned: boolean;
  if (task) {
    const selected = await loadTaskVersion(repo, task.metadata.id, task.contractSha256);
    pinned = digest(await requireTaskApproval(selected)) === digest(approval);
  } else {
    const afterBundle = await loadBundle(options.bundle!);
    pinned =
      !!options.localDemo &&
      options.bundleSha256 === bundle.bundleSha256 &&
      afterBundle.bundleSha256 === bundle.bundleSha256;
  }
  const workspace = await finish();
  const trust = pinned ? 'local-pinned' : 'unapproved';
  const input = {
    candidate,
    specSha256: bundle.specSha256,
    oracleSha256: bundle.oracleSha256,
    policySha256: bundle.policySha256,
    policy: bundle.policy,
    trust,
    assurance: executor.assurance,
    purpose: task || options.localDemo ? 'demonstration' : 'release',
    now: new Date().toISOString(),
    evidence,
    disagreements,
  };
  const report = ReportSchema.parse({
    schemaVersion: 1,
    runId: randomUUID(),
    timestamp: input.now,
    input,
    decision: evaluate(input),
    approval: {
      status: trust,
      source: bundle.source,
      bundleSha256: bundle.bundleSha256,
      authorityId: null,
      approvalRecordId: approval ? digest(approval) : null,
    },
    tools: {
      node: process.version,
      gateway: '0.1.0',
      ...(options.reviewer ? { reviewer: options.reviewer.id + '/' + options.reviewer.model } : {}),
    },
    limitations: [
      'UNPROTECTED: cooperative local execution; same-user filesystem and network access are not confined.',
      task
        ? 'Task approval is a local agent-mediated record.'
        : 'Bundle pin is a local byte identity.',
      options.reviewer
        ? 'Reviewer transports are cooperative local execution; protected independence is unverified.'
        : 'Independent reviewer unavailable; required review remains inconclusive.',
      'Protected CI execution is unavailable.',
    ],
    ...(review ? { review } : {}),
    ...(workspace ? { workspace } : {}),
  });
  if (task) await saveTaskReport(task, report);
  return report;
}

export function renderReport(raw: unknown): string {
  const report = ReportSchema.parse(raw);
  const decision = evaluate(report.input);
  if (digest(decision) !== digest(report.decision))
    throw new Error('Report decision does not match evidence');
  const candidate = report.input.candidate;
  const lines = [
    `Oracle Gate ${report.tools['gateway']} — UNPROTECTED / ${report.input.purpose}`,
    'source' in candidate
      ? `Workspace snapshot ${candidate.snapshotSha256}`
      : `Candidate ${candidate.commitSha} tree ${candidate.treeSha}`,
    `Oracle approval: ${report.approval.status} (no authenticated release authority)`,
  ];
  if (report.workspace) {
    lines.push(`Workspace freshness: ${report.workspace.freshness}`);
    const task = report.workspace.task;
    if (task) {
      lines.push(
        `Task ${task.id} contract ${task.contractSha256}`,
        `Baseline ${task.baselineSha256}`
      );
      for (const [kind, paths] of Object.entries(task.changes))
        for (const path of paths) lines.push(`  ${kind} ${path}`);
    }
  }
  for (const e of report.input.evidence) {
    lines.push(`${e.kind.padEnd(20)} ${e.status}`);
    if (e.kind === 'ORACLE')
      for (const c of e.observations.cases.filter((c) => c.status !== 'PASS'))
        lines.push(
          `  ${c.id}: input ${c.input}, expected ${c.expected}, actual ${c.actual ?? 'unavailable'}`
        );
  }
  if (report.review) {
    lines.push(
      `Reviewer: ${report.review.provider} / ${report.review.model} — ${report.review.status} (${report.review.reasonCode})`
    );
    for (const finding of report.review.findings)
      lines.push(`  ${finding.requirementId} ${finding.location}: ${finding.description}`);
  }
  for (const missing of decision.requiredChecks.filter(
    (k) => !report.input.evidence.some((e) => e.kind === k)
  ))
    lines.push(`${missing.padEnd(20)} UNAVAILABLE`);
  lines.push(`Verdict: ${decision.verdict}`, ...decision.reasons.map((r) => '  ' + r));
  return lines.join('\n');
}
