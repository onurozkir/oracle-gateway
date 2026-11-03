import { expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { LocalExecutor } from '@oracle-gate/runtime';
import { createFixture } from '../fixture.js';
import { writeBundle } from '../authority.js';
it('two consecutive verifications from a generic candidate checkout do not dirty it', async () => {
  const f = await createFixture();
  try {
    const bundle = join(f.root, 'authority');
    const pin = await writeBundle(bundle);
    const bin = resolve('bin/oracle-gate.js');
    const executor = new LocalExecutor();
    for (let run = 0; run < 2; run++) {
      const result = await executor.run({
        executable: process.execPath,
        args: [
          bin,
          'verify',
          '--candidate',
          f.correct,
          '--bundle',
          bundle,
          '--bundle-sha256',
          pin,
          '--local-demo',
        ],
        cwd: f.repo,
        timeoutMs: 30000,
      });
      expect(result.exitCode).toBe(0);
      expect(await f.git('status', '--porcelain')).toBe('');
    }
  } finally {
    await f.dispose();
  }
});
it('CLI uses actual verdict exit codes, omits raw candidate logs and reads reports without execution', async () => {
  const f = await createFixture();
  try {
    const bundle = join(f.root, 'authority');
    const pin = await writeBundle(bundle);
    const output = join(f.root, 'result.json');
    const executor = new LocalExecutor();
    const call = (...args: string[]) =>
      executor.run({
        executable: process.execPath,
        args: [resolve('bin/oracle-gate.js'), ...args],
        cwd: process.cwd(),
        timeoutMs: 30000,
      });
    const args = ['verify', '--repo', f.repo, '--bundle', bundle, '--report-json', output];
    expect(
      (await call(...args, '--candidate', f.wrong, '--bundle-sha256', pin, '--local-demo')).exitCode
    ).toBe(2);
    expect(
      (await call(...args, '--candidate', f.correct, '--bundle-sha256', pin, '--local-demo'))
        .exitCode
    ).toBe(0);
    expect((await call(...args, '--candidate', f.correct)).exitCode).toBe(3);
    expect((await call(...args, '--candidate', f.correct, '--protected')).exitCode).toBe(4);
    await writeFile(
      join(f.repo, 'self.test.mjs'),
      (await readFile(join(f.repo, 'self.test.mjs'), 'utf8')) +
        '\nconsole.log("private-candidate-output");\n'
    );
    const sha = await f.commit('candidate logs are not evidence');
    expect(
      (await call(...args, '--candidate', sha, '--bundle-sha256', pin, '--local-demo')).exitCode
    ).toBe(0);
    expect(await readFile(output, 'utf8')).not.toContain('private-candidate-output');
    const read = await call('report', '--input', output);
    expect(read.exitCode).toBe(0);
    expect(read.stdout).toContain('HISTORICAL RECORD');
  } finally {
    await f.dispose();
  }
}, 60000);
