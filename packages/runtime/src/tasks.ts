import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, realpath, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Hash,
  TaskId,
  SpecSchema,
  PolicySchema,
  digest,
  sha256,
  type ReviewerProvider,
  type Report,
} from '@oracle-gate/core';
import { stringify } from 'yaml';
import { z } from 'zod';
import { parseYaml, readBounded } from './source.js';
import { runCandidateReview } from './review.js';
import {
  checkedDirectory,
  hasCode,
  isProjectPath,
  oracleStore,
  publishFile,
  readRegular,
  withStaging,
} from './storage.js';
import { captureWorkspace, WorkspaceScope, workspaceScope } from './workspace.js';

const maxInput = 1024 * 1024;
export const executionDefaults = { entry: 'run.mjs', selfTest: 'self.test.mjs', timeoutMs: 10000 };
const entry = z.string().refine(isProjectPath);
const executionSchema = z.strictObject({
  entry: entry.default(executionDefaults.entry),
  selfTest: entry.default(executionDefaults.selfTest),
  timeoutMs: z.number().int().min(1).max(600_000).default(executionDefaults.timeoutMs),
});
const specDraft = z.strictObject({
  ...SpecSchema.shape,
  source: z.strictObject({ uri: z.string().min(1).max(4096), sha256: Hash.optional() }).optional(),
});
const contractDraft = z.strictObject({
  spec: specDraft,
  policy: PolicySchema,
  execution: executionSchema.default(executionDefaults),
});
const taskSchema = z.strictObject({
  id: TaskId,
  baselineSha256: Hash,
  requirementSha256: Hash,
  exclude: WorkspaceScope,
});
const approvalSchema = z.strictObject({
  taskId: TaskId,
  taskSha256: Hash,
  contractSha256: Hash,
  approvedAt: z.iso.datetime(),
});

function decodeRequirement(bytes: Buffer): string {
  const requirement = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!requirement.trim()) throw new Error('Original requirement is empty');
  return requirement;
}

function makeContract(text: string, requirementSha256: string) {
  const draft = contractDraft.parse(parseYaml(text));
  if (draft.spec.source?.sha256 && draft.spec.source.sha256 !== requirementSha256)
    throw new Error('Contract spec source does not match the original requirement');
  const spec = SpecSchema.parse({
    ...draft.spec,
    source: { uri: draft.spec.source?.uri ?? 'requirement.md', sha256: requirementSha256 },
  });
  const { execution, policy } = draft;
  const yaml = stringify({ spec, policy, execution }, { sortMapEntries: true, lineWidth: 0 });
  if (Buffer.byteLength(yaml) > maxInput) throw new Error('Canonical contract exceeds 1 MiB');
  return { yaml, contractSha256: sha256(yaml), spec, policy, execution };
}

async function readTask(repo: string, id: string) {
  const directory = await checkedDirectory(
    join(await oracleStore(repo, 'tasks'), TaskId.parse(id))
  );
  const metadata = taskSchema.parse(
    JSON.parse((await readRegular(join(directory, 'task.json'), maxInput)).toString('utf8'))
  );
  if (metadata.id !== id) throw new Error('Task identity mismatch');
  const bytes = await readRegular(join(directory, 'requirement.md'), maxInput);
  if (sha256(bytes) !== metadata.requirementSha256)
    throw new Error('Task requirement hash mismatch');
  return { directory, metadata, requirement: decodeRequirement(bytes) };
}

export async function startTask(options: {
  repo: string;
  requirement: string;
  contract: string;
  exclude?: string[];
}) {
  const repo = await realpath(options.repo);
  const requirement = await readRegular(await realpath(options.requirement), maxInput);
  decodeRequirement(requirement);
  const requirementSha256 = sha256(requirement);
  const { yaml, contractSha256 } = makeContract(
    await readBounded(options.contract),
    requirementSha256
  );
  const exclude = workspaceScope(options.exclude ?? []);
  const baseline = await captureWorkspace(repo, exclude);
  const id = randomBytes(16).toString('hex');
  const store = await oracleStore(repo, 'tasks');
  await withStaging(store, async (directory) => {
    const metadata = { id, baselineSha256: baseline.sha256, requirementSha256, exclude };
    for (const name of ['contracts', 'approvals', 'runs', 'reviews'])
      await mkdir(join(directory, name));
    await writeFile(join(directory, 'task.json'), JSON.stringify(metadata));
    await writeFile(join(directory, 'requirement.md'), requirement);
    await writeFile(join(directory, 'contracts', contractSha256 + '.yaml'), yaml);
    await rename(directory, join(store, id));
  });
  return { taskId: id, contractSha256, baselineSha256: baseline.sha256 };
}

export async function reviseTask(repo: string, id: string, path: string) {
  const { directory, metadata } = await readTask(await realpath(repo), id);
  const { yaml, contractSha256 } = makeContract(
    await readBounded(path),
    metadata.requirementSha256
  );
  const target = join(
    await checkedDirectory(join(directory, 'contracts')),
    contractSha256 + '.yaml'
  );
  if (
    !(await publishFile(target, yaml)) &&
    (await readRegular(target, maxInput)).toString('utf8') !== yaml
  )
    throw new Error('Stored contract hash mismatch');
  return { taskId: id, contractSha256 };
}

export async function loadTaskVersion(repo: string, id: string, hash: string) {
  Hash.parse(hash);
  const task = await readTask(repo, id);
  const path = join(await checkedDirectory(join(task.directory, 'contracts')), hash + '.yaml');
  const bytes = await readRegular(path, maxInput);
  const contract = makeContract(bytes.toString('utf8'), task.metadata.requirementSha256);
  if (sha256(bytes) !== hash || contract.contractSha256 !== hash)
    throw new Error('Stored contract hash mismatch');
  const { spec, policy } = contract;
  return {
    ...task,
    ...contract,
    bundle: {
      source: path,
      spec,
      policy,
      requirement: task.requirement,
      specSha256: digest(spec),
      oracleSha256: digest(spec.cases),
      policySha256: digest(policy),
      bundleSha256: hash,
    },
  };
}

type TaskVersion = Awaited<ReturnType<typeof loadTaskVersion>>;

async function approvalPath(task: TaskVersion) {
  return join(
    await checkedDirectory(join(task.directory, 'approvals')),
    task.contractSha256 + '.json'
  );
}

export async function requireTaskApproval(task: TaskVersion) {
  try {
    const approval = approvalSchema.parse(
      JSON.parse((await readRegular(await approvalPath(task), maxInput)).toString('utf8'))
    );
    if (
      approval.taskId !== task.metadata.id ||
      approval.taskSha256 !== digest(task.metadata) ||
      approval.contractSha256 !== task.contractSha256
    )
      throw new Error('Task approval does not match selected contract and baseline');
    return approval;
  } catch (error) {
    if (hasCode(error, 'ENOENT'))
      throw new Error('TASK_APPROVAL_REQUIRED: selected contract has no approval', {
        cause: error,
      });
    throw error;
  }
}

export async function approveTask(repo: string, id: string, hash: string) {
  const task = await loadTaskVersion(await realpath(repo), id, hash);
  await publishFile(
    await approvalPath(task),
    JSON.stringify({
      taskId: id,
      taskSha256: digest(task.metadata),
      contractSha256: hash,
      approvedAt: new Date().toISOString(),
    })
  );
  return requireTaskApproval(task);
}

export async function reviewTask(
  repo: string,
  id: string,
  hash: string,
  provider: ReviewerProvider
) {
  const task = await loadTaskVersion(await realpath(repo), id, hash);
  const result = await runCandidateReview({
    bundle: task.bundle,
    provider,
    readArtifacts: async () => [{ path: 'contract.yaml', content: task.yaml }],
  });
  const review = { taskId: id, contractSha256: hash, reviewId: randomUUID(), ...result };
  const directory = await checkedDirectory(join(task.directory, 'reviews'));
  if (
    !(await publishFile(
      join(directory, review.reviewId + '.json'),
      JSON.stringify(review, null, 2)
    ))
  )
    throw new Error('Draft review ID collision');
  return review;
}

export async function saveTaskReport(task: TaskVersion, report: Report) {
  const directory = await checkedDirectory(join(task.directory, 'runs'));
  if (
    !(await publishFile(
      join(directory, report.runId + '.json'),
      JSON.stringify(report, null, 2) + '\n'
    ))
  )
    throw new Error('Task run ID collision');
}
