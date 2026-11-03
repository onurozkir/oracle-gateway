import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute, sep } from 'node:path';
import { GitCandidateSchema, type GitCandidateIdentity } from '@oracle-gate/core';
import { LocalExecutor } from './executor.js';
const executor = new LocalExecutor();
export async function git(repo: string, args: string[], maxOutputBytes = 1048576): Promise<string> {
  const r = await executor.run({
    executable: 'git',
    args: [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.autocrlf=false',
      '-c',
      'core.fsmonitor=false',
      ...args,
    ],
    cwd: repo,
    maxOutputBytes,
    timeoutMs: 30000,
  });
  if (r.error || r.exitCode !== 0) throw new Error('Git operation failed: ' + args[0]);
  return r.stdout.trimEnd();
}
export async function resolveCommit(repo: string, ref: string): Promise<string> {
  if (!ref || ref.startsWith('-') || ref.includes('\0') || ref.length > 256)
    throw new Error('Invalid Git ref');
  const sha = await git(repo, ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) throw new Error('Invalid Git commit');
  return sha;
}
export async function captureCandidate(
  repo: string,
  ref: string,
  allowDirty = false,
  ignoreOracleStore = false
): Promise<GitCandidateIdentity> {
  const commitSha = await resolveCommit(repo, ref);
  const treeSha = await git(repo, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    commitSha + '^{tree}',
  ]);
  const untracked = ignoreOracleStore ? 'normal' : 'all';
  const status = await git(repo, ['status', '--porcelain', '--untracked-files=' + untracked, '-z']);
  const dirty = status
    .split('\0')
    .some((entry) => entry && (!ignoreOracleStore || !entry.startsWith('?? .oracle/')));
  if (dirty && !allowDirty)
    throw new Error(
      'Candidate working tree is dirty; use explicit local --allow-dirty (never release acceptance)'
    );
  return GitCandidateSchema.parse({ commitSha, treeSha, dirty });
}
export function isWithin(parent: string, path: string): boolean {
  const rel = relative(parent, path);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}
export async function withSnapshot<T>(
  repo: string,
  identity: GitCandidateIdentity,
  work: (path: string) => Promise<T>
): Promise<T> {
  // Inspect before checkout: no symlinks, submodules or unusual modes are supported.
  const entries = await git(repo, ['ls-tree', '-rz', identity.commitSha]);
  for (const entry of entries.split('\0').filter(Boolean)) {
    if (!/^(100644|100755) blob [a-f0-9]+\t/.test(entry))
      throw new Error('Unsupported snapshot entry (symlink/submodule)');
  }
  const root = await mkdtemp(join(tmpdir(), 'oracle-gate-snapshot-'));
  if (!isWithin(tmpdir(), root) || root === tmpdir()) throw new Error('Unsafe snapshot cleanup');
  try {
    const path = join(root, 'candidate');
    await git(root, [
      'clone',
      '--local',
      '--no-hardlinks',
      '--no-checkout',
      '--',
      await realpath(repo),
      path,
    ]);
    await git(path, ['checkout', '--detach', identity.commitSha, '--']);
    const observed = await captureCandidate(path, identity.commitSha);
    if (observed.treeSha !== identity.treeSha) throw new Error('Snapshot identity mismatch');
    return await work(path);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
}
