import { describe, expect, it } from 'vitest';
import { LocalExecutor } from '@oracle-gate/runtime';
import { resolve } from 'node:path';
const bin = resolve('bin/oracle-gate.js');
const execute = (...args: string[]) =>
  new LocalExecutor().run({
    executable: process.execPath,
    args: [bin, ...args],
    cwd: process.cwd(),
  });
describe('CLI contract', () => {
  it('lists the public commands', async () => {
    const result = await execute('--help');
    expect(result.exitCode).toBe(0);
    for (const command of ['init', 'spec', 'task', 'verify', 'report', 'doctor'])
      expect(result.stdout).toContain(command);
  });
  it('invalid flags and missing required inputs exit 1', async () => {
    expect((await execute('verify', '--unknown')).exitCode).toBe(1);
    expect((await execute('verify')).exitCode).toBe(1);
  });
  it('doctor reports capability and local trust independently', async () => {
    const result = await execute('doctor');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('UNPROTECTED');
    expect(result.stdout).toContain('protected-ci: UNAVAILABLE');
  });
  it('documents supported verification inputs', async () => {
    const help = await execute('verify', '--help');
    expect(help.exitCode).toBe(0);
    for (const flag of ['--repo', '--candidate', '--bundle', '--task', '--contract-sha256'])
      expect(help.stdout).toContain(flag);
  });
});
