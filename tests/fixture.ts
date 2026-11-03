import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
const exec = promisify(execFile);
export async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'oracle-gate-'));
  const repo = join(root, 'candidate with spaces & chars');
  await mkdir(join(repo, 'src'), { recursive: true });
  const git = async (...args: string[]) =>
    (
      await exec(
        'git',
        [
          '-c',
          'core.autocrlf=false',
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          ...args,
        ],
        { cwd: repo }
      )
    ).stdout.trim();
  const commit = async (message: string) => {
    await git('add', '.');
    await git('commit', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  await git('init', '--initial-branch=fixture');
  await writeFile(join(repo, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(repo, 'src/total.mjs'), 'export const calculateTotal = n => n;\n');
  await writeFile(
    join(repo, 'run.mjs'),
    `import { calculateTotal } from './src/total.mjs';
import { createInterface } from 'node:readline';
for await (const line of createInterface({input:process.stdin})) {
  const { amountCents } = JSON.parse(line);
  console.log(JSON.stringify({totalCents:calculateTotal(amountCents)}));
}\n`
  );
  await writeFile(
    join(repo, 'self.test.mjs'),
    `import assert from 'node:assert/strict';
import { calculateTotal } from './src/total.mjs';
assert.equal(calculateTotal(9900), 9900);\n`
  );
  const base = await commit('baseline without discount');
  const code = (op: string) =>
    `export const calculateTotal = n => n ${op} 10000 ? Number((BigInt(n)*9000n+5000n)/10000n) : n;\n`;
  const tests = (thresholdTotal: number) => `import assert from 'node:assert/strict';
import { calculateTotal } from './src/total.mjs';
assert.equal(calculateTotal(9900), 9900);
assert.equal(calculateTotal(10000), ${thresholdTotal});
assert.equal(calculateTotal(10100), 9090);\n`;
  await writeFile(join(repo, 'src/total.mjs'), code('>='));
  await writeFile(join(repo, 'self.test.mjs'), tests(9000));
  const wrong = await commit('wrong inclusive threshold with green tests');
  await git('checkout', '--detach', base);
  await writeFile(join(repo, 'src/total.mjs'), code('>'));
  await writeFile(join(repo, 'self.test.mjs'), tests(10000));
  const correct = await commit('correct exclusive threshold');
  return {
    root,
    repo,
    base,
    wrong,
    correct,
    git,
    commit,
    async dispose() {
      const rel = relative(tmpdir(), root);
      if (!rel || rel.startsWith('..') || isAbsolute(rel))
        throw new Error('Unsafe fixture cleanup');
      await rm(root, { recursive: true, force: true });
    },
  };
}
