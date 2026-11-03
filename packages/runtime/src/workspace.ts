import { lstat, mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Hash, digest, sha256 } from '@oracle-gate/core';
import { z } from 'zod';
import {
  checkedDirectory,
  hasCode,
  isProjectPath,
  oracleStore,
  readRegular,
  withStaging,
  withTemporary,
} from './storage.js';

const excluded = new Set([
  '.oracle',
  '.oracle-gate',
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  'out',
]);
const maxFile = 16 * 1024 * 1024;
const maxTotal = 256 * 1024 * 1024;
const maxFiles = 20_000;
const pathSchema = z.string().refine(isProjectPath);
export const WorkspaceScope = z.array(pathSchema).max(256);
const manifestSchema = z.array(z.strictObject({ path: pathSchema, sha256: Hash })).max(maxFiles);
type Manifest = z.infer<typeof manifestSchema>;
export interface WorkspaceSnapshot {
  sha256: string;
  manifest: Manifest;
  directory: string;
}

export function workspaceScope(paths: string[]): string[] {
  return [...new Set(WorkspaceScope.parse(paths.map((path) => path.replaceAll('\\', '/'))))].sort();
}

async function scan(root: string, scope?: string[], destination?: string): Promise<Manifest> {
  const files: Manifest = [];
  const exclusionKey = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);
  const pathsToExclude = scope?.map(exclusionKey);
  let total = 0;
  async function walk(directory: string, prefix: string): Promise<void> {
    await checkedDirectory(directory);
    for (const name of await readdir(directory)) {
      const path = prefix + name;
      const scopePath = exclusionKey(path);
      if (
        pathsToExclude &&
        (excluded.has(name.toLowerCase()) ||
          /^(\.env.*|\.npmrc|\.netrc|\.pypirc|id_(rsa|ed25519|ecdsa|dsa)(?:\.pub)?|.*(?:credentials|secrets).*\.(?:json|ya?ml|toml|txt)|.*\.(?:pem|key|p12|pfx))$/i.test(
            name
          ) ||
          pathsToExclude.some((item) => scopePath === item || scopePath.startsWith(item + '/')))
      )
        continue;
      pathSchema.parse(path);
      const source = join(directory, name);
      const info = await lstat(source);
      if (info.isDirectory()) {
        await walk(source, path + '/');
        continue;
      }
      if (!info.isFile())
        throw new Error('Unsupported workspace entry (symlink, junction or special file)');
      if (files.length >= maxFiles || total + info.size > maxTotal)
        throw new Error('Workspace snapshot exceeds size or file-count limit');
      const bytes = await readRegular(source, maxFile);
      total += bytes.length;
      if (total > maxTotal) throw new Error('Workspace snapshot exceeds size limit');
      files.push({ path, sha256: sha256(bytes) });
      if (destination) {
        const target = join(destination, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes, { flag: 'wx' });
      }
    }
  }
  await walk(root, '');
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function loadWorkspaceSnapshot(
  store: string,
  hash: string
): Promise<WorkspaceSnapshot> {
  const directory = await checkedDirectory(join(store, Hash.parse(hash)));
  const bytes = await readRegular(join(directory, 'manifest.json'), 32 * 1024 * 1024);
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (digest(manifest) !== hash) throw new Error('Workspace snapshot manifest hash mismatch');
  return { sha256: hash, manifest, directory };
}

async function copySnapshot(snapshot: WorkspaceSnapshot, destination?: string): Promise<void> {
  await checkedDirectory(snapshot.directory);
  const observed = await scan(join(snapshot.directory, 'files'), undefined, destination);
  if (digest(observed) !== snapshot.sha256)
    throw new Error('Workspace snapshot content hash mismatch');
}

export async function captureWorkspace(repo: string, scope: string[]): Promise<WorkspaceSnapshot> {
  const store = await oracleStore(repo, 'snapshots');
  for (let attempt = 0; attempt < 3; attempt++) {
    const captured = await withStaging(store, async (directory) => {
      const files = join(directory, 'files');
      await mkdir(files);
      let manifest: Manifest;
      let hash: string;
      try {
        manifest = await scan(repo, scope, files);
        hash = digest(manifest);
        if (digest(await scan(repo, scope)) !== hash) return undefined;
      } catch (error) {
        if (hasCode(error, 'ENOENT', 'ENOTDIR', 'EBUSY')) return undefined;
        throw error;
      }
      await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
      try {
        await rename(directory, join(store, hash));
      } catch (error) {
        if (!hasCode(error, 'EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES')) throw error;
        const existing = await loadWorkspaceSnapshot(store, hash).catch((lookupError: unknown) => {
          if (hasCode(lookupError, 'ENOENT')) throw error;
          throw lookupError;
        });
        await copySnapshot(existing);
        return existing;
      }
      return { sha256: hash, manifest, directory: join(store, hash) };
    });
    if (captured) return captured;
  }
  throw new Error('WORKSPACE_UNSTABLE: could not capture stable saved files after three attempts');
}

export async function withWorkspaceSnapshot<T>(
  snapshot: WorkspaceSnapshot,
  work: (path: string) => Promise<T>
): Promise<T> {
  return withTemporary(async (directory) => {
    await copySnapshot(snapshot, directory);
    return work(directory);
  });
}

export async function workspaceMatches(
  directory: string,
  snapshot: WorkspaceSnapshot,
  scope?: string[]
): Promise<boolean> {
  return digest(await scan(directory, scope)) === snapshot.sha256;
}

export async function requireWorkspaceBaseline(
  repo: string,
  hash: string
): Promise<WorkspaceSnapshot> {
  try {
    const snapshot = await loadWorkspaceSnapshot(await oracleStore(repo, 'snapshots'), hash);
    await copySnapshot(snapshot);
    return snapshot;
  } catch (error) {
    if (hasCode(error, 'ENOENT', 'ENOTDIR'))
      throw new Error('WORKSPACE_BASELINE_MISSING', { cause: error });
    throw error;
  }
}

export function workspaceChanges(before: WorkspaceSnapshot, after: WorkspaceSnapshot) {
  const previous = new Map(before.manifest.map((file) => [file.path, file.sha256]));
  const current = new Set<string>();
  const added: string[] = [];
  const modified: string[] = [];
  for (const file of after.manifest) {
    current.add(file.path);
    const old = previous.get(file.path);
    if (old === undefined) added.push(file.path);
    else if (old !== file.sha256) modified.push(file.path);
  }
  return { added, modified, deleted: [...previous.keys()].filter((path) => !current.has(path)) };
}
