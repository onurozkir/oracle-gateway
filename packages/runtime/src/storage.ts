import { link, lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function hasCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof Error && 'code' in error && codes.includes(String(error.code));
}

export function isProjectPath(value: string): boolean {
  return (
    value.length <= 1024 &&
    value
      .split('/')
      .every(
        (part) =>
          part !== '' &&
          part !== '.' &&
          part !== '..' &&
          !/[\\:]/.test(part) &&
          [...part].every((character) => character.charCodeAt(0) >= 32)
      )
  );
}

export async function checkedDirectory(path: string): Promise<string> {
  if (!(await lstat(path)).isDirectory() || (await realpath(path)) !== path)
    throw new Error('Unsupported directory or filesystem link');
  return path;
}

export async function makeDirectory(path: string): Promise<string> {
  try {
    await mkdir(path);
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error;
  }
  return checkedDirectory(path);
}

export async function oracleStore(repo: string, kind: 'tasks' | 'snapshots'): Promise<string> {
  return makeDirectory(join(await makeDirectory(join(repo, '.oracle')), kind));
}

export async function readRegular(path: string, limit: number): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || (await realpath(path)) !== path)
    throw new Error('Unsupported file or filesystem link');
  const file = await open(path, 'r');
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev)
      throw Object.assign(new Error('File changed before read'), { code: 'EBUSY' });
    if (opened.size > limit) throw new Error('File exceeds size limit');
    const bytes = Buffer.allocUnsafe(opened.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length !== opened.size)
      throw Object.assign(new Error('File size changed during read'), { code: 'EBUSY' });
    return bytes.subarray(0, length);
  } finally {
    await file.close();
  }
}

export async function withStaging<T>(
  parent: string,
  work: (directory: string) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(join(parent, 'oracle-stage-'));
  if (dirname(resolve(directory)) !== resolve(parent)) throw new Error('Unsafe staging cleanup');
  try {
    return await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}

export async function withTemporary<T>(work: (directory: string) => Promise<T>): Promise<T> {
  return withStaging(await realpath(tmpdir()), work);
}

// The link publishes a complete file and fails if another writer already claimed its name.
export async function publishFile(target: string, content: string | Buffer): Promise<boolean> {
  const staging = join(dirname(target), '.oracle-write-' + randomUUID());
  await writeFile(staging, content, { flag: 'wx' });
  try {
    await link(staging, target);
    return true;
  } catch (error) {
    if (hasCode(error, 'EEXIST')) return false;
    throw error;
  } finally {
    await rm(staging, { force: true });
  }
}
