import { expect, it, vi } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureWorkspace } from '../packages/runtime/src/workspace.js';

const fixture = vi.hoisted(() => ({ root: '', scans: 0 }));

vi.mock(import('node:fs/promises'), async (original) => {
  const fs = await original();
  const readdir: typeof fs.readdir = new Proxy(fs.readdir, {
    async apply(target, receiver, args) {
      if (args[0] === fixture.root) {
        fixture.scans++;
        await fs.writeFile(join(fixture.root, 'run.mjs'), String(fixture.scans));
      }
      return Reflect.apply(target, receiver, args);
    },
  });
  return { ...fs, readdir };
});

it('retries a changing capture three times and publishes no snapshot', async () => {
  fixture.root = await mkdtemp(join(await realpath(tmpdir()), 'oracle-unstable-test-'));
  try {
    await expect(captureWorkspace(fixture.root, [])).rejects.toThrow('WORKSPACE_UNSTABLE');
    expect(fixture.scans).toBe(6);
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(join(fixture.root, '.oracle', 'snapshots'))).toEqual([]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
