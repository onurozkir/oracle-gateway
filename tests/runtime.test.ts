import { afterEach, describe, expect, it } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LocalExecutor,
  captureCandidate,
  withSnapshot,
  compareJsonLine,
  loadBundle,
} from '@oracle-gate/runtime';
import { createFixture } from './fixture.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('bounded local executor', () => {
  it('passes literal shell metacharacters and strips secrets', async () => {
    const exec = new LocalExecutor();
    process.env['ORACLE_GATE_TEST_SECRET'] = 'must-never-leak';
    const result = await exec.run({
      executable: process.execPath,
      args: [
        '-e',
        'console.log(JSON.stringify([process.argv[1],process.env.ORACLE_GATE_TEST_SECRET,process.env.NODE_OPTIONS]))',
        'a; & echo injected',
      ],
      cwd: process.cwd(),
    });
    delete process.env['ORACLE_GATE_TEST_SECRET'];
    expect(result.error).toBeNull();
    expect(JSON.parse(result.stdout)).toEqual(['a; & echo injected', null, null]);
  });
  it('kills a timed-out process', async () => {
    const result = await new LocalExecutor().run({
      executable: process.execPath,
      args: ['-e', 'setInterval(()=>{},1000)'],
      cwd: process.cwd(),
      timeoutMs: 100,
    });
    expect(result.error).toBe('TIMEOUT');
  });
  it('bounds combined output', async () => {
    const result = await new LocalExecutor().run({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(100000))'],
      cwd: process.cwd(),
      maxOutputBytes: 100,
    });
    expect(result.error).toBe('OUTPUT_LIMIT');
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(
      100
    );
  });
  it('reports missing binaries explicitly', async () => {
    const result = await new LocalExecutor().run({
      executable: 'oracle-gate-does-not-exist',
      args: [],
      cwd: process.cwd(),
    });
    expect(result.error).toBe('SPAWN_ERROR');
  });
  it('cleans descendants after a successful parent exits', async () => {
    const f = await createFixture();
    cleanups.push(f.dispose);
    const marker = join(f.root, 'descendant-pid');
    const payload = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:${process.platform === 'win32'}}); require('node:fs').writeFileSync(${JSON.stringify(marker)},String(c.pid)); c.unref();`;
    const result = await new LocalExecutor().run({
      executable: process.execPath,
      args: ['-e', payload],
      cwd: f.root,
    });
    expect(result.exitCode).toBe(0);
    const pid = Number(await readFile(marker, 'utf8'));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (alive) {
      process.kill(pid);
    } // Ensure the RED regression run does not leave a process behind.
    expect(alive).toBe(false);
  });
});

describe('strict JSON-lines comparison', () => {
  it('detects the exact-threshold discrepancy', () => {
    expect(compareJsonLine('{"totalCents":9000}\n', 10000)).toEqual({
      actual: 9000,
      status: 'FAIL',
    });
  });
  it.each([
    '',
    '{}',
    '{"totalCents":1}\n{"totalCents":1}',
    '{"totalCents":1,"oraclePassed":true}',
    '{"totalCents":1.5}',
    '{"totalCents":-1}',
    'log\n{"totalCents":10000}',
    '{"totalCents":9007199254740992}',
  ])('rejects malformed protocol %s', (raw) => {
    expect(compareJsonLine(raw, 10000).status).toBe('ERROR');
  });
});

describe('real Git identity', () => {
  it('materializes the exact commit without modifying the user checkout', async () => {
    const fixture = await createFixture();
    cleanups.push(fixture.dispose);
    const original = await fixture.git('rev-parse', 'HEAD');
    const id = await captureCandidate(fixture.repo, fixture.wrong, false);
    await withSnapshot(fixture.repo, id, async (path) => {
      const result = await new LocalExecutor().run({
        executable: process.execPath,
        args: ['self.test.mjs'],
        cwd: path,
      });
      expect(result.exitCode).toBe(0);
    });
    expect(await fixture.git('rev-parse', 'HEAD')).toBe(original);
    expect(id.commitSha).toBe(fixture.wrong);
  });
  it('rejects dirty working tree by default and resolves refs safely', async () => {
    const f = await createFixture();
    cleanups.push(f.dispose);
    await writeFile(join(f.repo, 'untracked.txt'), 'changed');
    await expect(captureCandidate(f.repo, 'HEAD', false)).rejects.toThrow(/dirty/i);
    expect((await captureCandidate(f.repo, 'HEAD', true)).dirty).toBe(true);
    await expect(captureCandidate(f.repo, '--upload-pack=evil', true)).rejects.toThrow();
  });
  it('unavailable bundle cannot create approval', async () => {
    await expect(loadBundle('does-not-exist')).rejects.toThrow();
  });
});
