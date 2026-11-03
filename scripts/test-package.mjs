import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createFixture } from '../tests/fixture.ts';
import { writeBundle } from '../tests/authority.ts';
const exec = promisify(execFile);
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run this check through npm run test:package');
const directory = await mkdtemp(join(tmpdir(), 'oracle-gate-package-'));
const rel = relative(tmpdir(), directory);
assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel));
let fixture;
try {
  const packed = JSON.parse(
    (
      await exec(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', directory], {
        cwd: process.cwd(),
      })
    ).stdout
  )[0];
  assert.equal(packed.name, '@onurozkir/oracle-gateway');
  const files = packed.files.map((file) => file.path);
  assert.ok(files.includes('dist/cli.js'));
  assert.ok(files.includes('dist/index.js'));
  assert.ok(files.includes('dist/reviewers.js'));
  assert.ok(files.includes('dist/reviewers.d.ts'));
  assert.ok(files.includes('dist/windows-job-host.cs'));
  assert.ok(files.includes('packages/core/dist/index.d.ts'));
  assert.ok(files.includes('.agent/skills/oracle-verification/SKILL.md'));
  const releaseFile =
    /^(?:package\.json|README\.md|SECURITY\.md|LICENSE(?:\.md|\.txt)?|bin\/oracle-gate\.js|dist\/[^/]+|packages\/(?:core|adapters)\/dist\/[^/]+\.d\.ts|\.agent\/skills\/oracle-verification\/SKILL\.md)$/;
  assert.deepEqual(
    files.filter((file) => !releaseFile.test(file)),
    []
  );
  const installed = join(directory, 'consumer');
  await mkdir(installed);
  await exec(
    process.execPath,
    [
      npmCli,
      'install',
      join(directory, packed.filename),
      '--prefer-offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    { cwd: installed }
  );
  const packageDirectory = join(installed, 'node_modules', packed.name);
  const bin = join(packageDirectory, 'bin', 'oracle-gate.js');
  const help = (await exec(process.execPath, [bin, '--help'], { cwd: installed })).stdout;
  assert.match(help, /oracle-gate/);
  await exec(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'import { calculateTotal } from "@onurozkir/oracle-gateway"; if(calculateTotal(10000)!==10000) process.exit(1);',
    ],
    { cwd: installed }
  );
  await exec(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'import { createReviewerProvider } from "@onurozkir/oracle-gateway/reviewers"; const p=createReviewerProvider({type:"command",executable:process.execPath}); if(p.id!=="command")process.exit(1);',
    ],
    { cwd: installed }
  );
  await writeFile(
    join(installed, 'consumer.mts'),
    'import { createReviewerProvider } from "@onurozkir/oracle-gateway/reviewers"; import type { ReviewerProvider } from "@onurozkir/oracle-gateway"; const p: ReviewerProvider = createReviewerProvider({type:"command",executable:"node"}); void p;\n'
  );
  await exec(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      '--strict',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2023',
      '--noEmit',
      'consumer.mts',
    ],
    { cwd: installed }
  );
  const cli = await readFile(join(packageDirectory, 'dist', 'cli.js'), 'utf8');
  assert.doesNotMatch(cli, /from ["']@oracle-gate\//);
  fixture = await createFixture();
  const bundle = join(fixture.root, 'authority');
  const pin = await writeBundle(bundle);
  const workspace = join(directory, 'git-free-workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'self.test.mjs'), 'process.exit(0);');
  await writeFile(
    join(workspace, 'run.mjs'),
    `import { readFileSync } from 'node:fs';
const { amountCents } = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify({ totalCents: amountCents > 10000 ? amountCents * 0.9 : amountCents }));`
  );
  const local = await exec(
    process.execPath,
    [bin, 'verify', '--bundle', bundle, '--bundle-sha256', pin, '--local-demo'],
    { cwd: workspace }
  );
  assert.match(local.stdout, /Workspace snapshot [a-f0-9]{64}/);
  assert.match(local.stdout, /Verdict: ACCEPT/);
  const agent = join(directory, 'review-agent.mjs');
  await writeFile(
    agent,
    `import {readFileSync} from 'node:fs';const r=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(r.stage==='interpretation'?{requirementId:r.input.requirementId,operator:'>',unit:'cents',threshold:10000,assumptions:[],uncertainty:[],proposedCases:[{id:'boundary',input:{amountCents:10000},expected:{totalCents:10000}}]}:{differences:[],uncertainty:[]}));`
  );
  const reviewerConfig = join(directory, 'reviewer.json');
  await writeFile(
    reviewerConfig,
    JSON.stringify({
      type: 'command',
      executable: process.execPath,
      args: [agent],
      model: 'package-fixture',
    })
  );
  for (const [kind, expectedExit] of [
    ['wrong', 2],
    ['correct', 0],
  ]) {
    let exit = 0;
    try {
      await exec(
        process.execPath,
        [
          bin,
          'verify',
          '--repo',
          fixture.repo,
          '--candidate',
          fixture[kind],
          '--bundle',
          bundle,
          '--bundle-sha256',
          pin,
          '--local-demo',
          '--reviewer-config',
          reviewerConfig,
          '--report-json',
          join(directory, `${kind}.json`),
        ],
        { cwd: installed, timeout: 60000 }
      );
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      exit = error.code;
    }
    assert.equal(exit, expectedExit, `Installed ${kind} candidate verdict`);
    const report = JSON.parse(await readFile(join(directory, `${kind}.json`), 'utf8'));
    assert.equal(report.review.status, 'COMPLETE');
    assert.equal(report.review.stages.length, 2);
  }
  console.log(
    `Standalone tarball verified: ${files.length} files; empty-consumer install, public API, CLI and real wrong/correct Git candidates passed.`
  );
} finally {
  if (fixture) await fixture.dispose();
  await rm(directory, { recursive: true, force: true, maxRetries: 3 });
}
