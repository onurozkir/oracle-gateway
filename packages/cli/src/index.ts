import { Command, CommanderError } from 'commander';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { SpecSchema, ReportSchema, exitCodes, digest } from '@oracle-gate/core';
import {
  verify,
  renderReport,
  readBounded,
  parseYaml,
  LocalExecutor,
  isWithin,
} from '@oracle-gate/runtime';
import { loadReviewer, registerTasks } from './task.js';

async function resolveOutput(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    return join(await resolveOutput(dirname(path)), basename(path));
  }
}

export async function runCLI(argv = process.argv): Promise<void> {
  const program = new Command()
    .name('oracle-gate')
    .description('Independent oracle verification of saved workspace files or explicit Git commits')
    .version('0.1.0', '-v, --version')
    .exitOverride();
  program
    .command('init')
    .description('Write a local example configuration; grants no approval')
    .action(async () => {
      await writeFile(
        resolve('oracle-gate.config.json'),
        JSON.stringify(
          {
            schemaVersion: 1,
            entry: 'run.mjs',
            selfTest: 'self.test.mjs',
            trust: 'UNAPPROVED',
            instructions:
              'Choose a separately controlled bundle; use explicit CLI options. This example file is not loaded as release authority.',
          },
          null,
          2
        ) + '\n',
        { flag: 'wx' }
      );
      console.log('Created oracle-gate.config.json. Oracle remains UNAPPROVED.');
    });
  registerTasks(program);
  const spec = program.command('spec').description('Requirement schema utilities');
  spec
    .command('validate')
    .requiredOption('--spec <path>', 'Spec YAML or JSON file')
    .action(async (options: { spec: string }) => {
      const parsed = SpecSchema.parse(parseYaml(await readBounded(options.spec)));
      console.log(
        `Schema: VALID\nRequirement: ${parsed.requirementId}\nDigest: ${digest(parsed)}\nApproval: NOT_EVALUATED (schema validity grants no approval)`
      );
    });
  program
    .command('verify')
    .description('Run constrained local checks; release acceptance requires a protected executor')
    .option('--repo <path>', 'Project directory', '.')
    .option('--candidate <ref>', 'Verify a Git commit instead of saved workspace files')
    .option('--task <id>', 'Use the approved local task contract')
    .option('--contract-sha256 <hash>', 'Exact approved task contract hash')
    .option(
      '--bundle <directory>',
      'Separate bundle with manifest.json, spec.yaml, policy.yaml and requirement.md'
    )
    .option('--spec <path>', 'spec.yaml inside the separate bundle')
    .option('--policy <path>', 'policy.yaml inside the same bundle')
    .option(
      '--bundle-sha256 <hash>',
      'Expected canonical bundle manifest digest from the local operator'
    )
    .option(
      '--local-demo',
      'Acknowledge cooperative UNPROTECTED demonstration; never a release approval'
    )
    .option('--protected', 'Require protected execution (currently unavailable; fails closed)')
    .option(
      '--allow-dirty',
      'Inspect committed snapshot of a dirty checkout; acceptance remains blocked'
    )
    .option('--entry <file>', 'Relative Node JSONL entry (default run.mjs)')
    .option('--self-test <file>', 'Relative Node self-test entry (default self.test.mjs)')
    .option('--timeout-ms <integer>', 'Per-process time budget (default 10000)')
    .option(
      '--reviewer-config <path>',
      'User-controlled HTTP or command reviewer configuration outside candidate'
    )
    .option('--report-json <path>', 'Write JSON report to an explicit path')
    .action(
      async (options: {
        repo: string;
        candidate?: string;
        task?: string;
        contractSha256?: string;
        bundle?: string;
        spec?: string;
        policy?: string;
        bundleSha256?: string;
        localDemo?: boolean;
        protected?: boolean;
        allowDirty?: boolean;
        entry?: string;
        selfTest?: string;
        timeoutMs?: string;
        reviewerConfig?: string;
        reportJson?: string;
      }) => {
        const bundle =
          options.bundle ?? (options.spec ? dirname(resolve(options.spec)) : undefined);
        if (options.spec && resolve(options.spec) !== resolve(bundle!, 'spec.yaml'))
          throw new Error('--spec must be the bundle spec.yaml');
        if (
          options.policy &&
          (!bundle || resolve(options.policy) !== resolve(bundle, 'policy.yaml'))
        )
          throw new Error('--policy must be the same bundle policy.yaml');
        if (options.timeoutMs !== undefined && !/^\d+$/.test(options.timeoutMs))
          throw new Error('Invalid timeout');
        const output = options.reportJson && (await resolveOutput(resolve(options.reportJson)));
        if (output) {
          const repo = await realpath(options.repo);
          if (isWithin(resolve(repo, '.oracle'), output))
            throw new Error(
              'Report destination cannot overwrite the Oracle task or snapshot store'
            );
        }
        const reviewer = options.reviewerConfig
          ? await loadReviewer(options.repo, options.reviewerConfig)
          : undefined;
        const report = await verify({
          repo: options.repo,
          ...(options.candidate !== undefined ? { candidate: options.candidate } : {}),
          ...(options.task !== undefined ? { task: options.task } : {}),
          ...(options.contractSha256 !== undefined
            ? { contractSha256: options.contractSha256 }
            : {}),
          ...(bundle !== undefined ? { bundle } : {}),
          ...(options.entry !== undefined ? { entry: options.entry } : {}),
          ...(options.selfTest !== undefined ? { selfTest: options.selfTest } : {}),
          ...(options.timeoutMs !== undefined ? { timeoutMs: Number(options.timeoutMs) } : {}),
          ...(options.bundleSha256 !== undefined ? { bundleSha256: options.bundleSha256 } : {}),
          ...(options.localDemo ? { localDemo: true } : {}),
          ...(options.protected ? { protectedMode: true } : {}),
          ...(options.allowDirty ? { allowDirty: true } : {}),
          ...(reviewer ? { reviewer } : {}),
        });
        if (output) {
          await mkdir(dirname(output), { recursive: true });
          await writeFile(output, JSON.stringify(report, null, 2) + '\n');
        }
        console.log(renderReport(report));
        process.exitCode = exitCodes[report.decision.verdict];
      }
    );
  program
    .command('report')
    .description('Inspect a historical report; does not grant fresh release authority')
    .requiredOption('--input <path>', 'Report JSON')
    .action(async (options: { input: string }) => {
      const report = ReportSchema.parse(
        JSON.parse(await readBounded(options.input, 96 * 1024 * 1024))
      );
      console.log(
        'HISTORICAL RECORD — not authenticated, no candidate re-execution or current freshness check.'
      );
      console.log(renderReport(report));
    });
  program
    .command('doctor')
    .description('Inspect local capabilities and assurance')
    .action(async () => {
      console.log(
        `node: ${process.version}\nexecutor: UNPROTECTED (no OS filesystem/network confinement)\nprotected-ci: UNAVAILABLE\nreviewer: UNAVAILABLE`
      );
      const executor = new LocalExecutor();
      for (const [name, args] of [['git', ['--version']]] as const) {
        const r = await executor.run({
          executable: name,
          args: [...args],
          cwd: process.cwd(),
          timeoutMs: 2000,
        });
        console.log(`${name}: ${r.error || r.exitCode !== 0 ? 'UNAVAILABLE' : r.stdout.trim()}`);
      }
    });
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return;
    // Never print candidate stdout, raw prompts, environment or schema input values.
    if (error instanceof CommanderError) process.exitCode = 1;
    else {
      const message =
        error instanceof Error && !('issues' in error) ? error.message : 'Invalid input schema';
      console.error('oracle-gate: ' + message);
      process.exitCode = /protected.*unavailable/i.test(message) ? 4 : 1;
    }
  }
}
