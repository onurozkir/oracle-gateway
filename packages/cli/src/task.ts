import type { Command } from 'commander';
import { realpath } from 'node:fs/promises';
import {
  approveTask,
  isWithin,
  parseYaml,
  readBounded,
  reviewTask,
  reviseTask,
  startTask,
} from '@oracle-gate/runtime';
import { createReviewerProvider } from '@oracle-gate/adapters';

export async function loadReviewer(repo: string, path: string) {
  const configPath = await realpath(path);
  if (isWithin(await realpath(repo), configPath))
    throw new Error('Reviewer configuration must be outside candidate repository');
  return createReviewerProvider(parseYaml(await readBounded(configPath)));
}

export function registerTasks(program: Command): void {
  const task = program
    .command('task')
    .description('Manage local verification tasks and approved contracts');
  const command = (name: string, description: string) =>
    task.command(name).description(description).option('--repo <path>', 'Project directory', '.');
  const taskCommand = (name: string, description: string) =>
    command(name, description).requiredOption('--task <id>', 'Task ID');
  const versionCommand = (name: string, description: string) =>
    taskCommand(name, description).requiredOption(
      '--contract-sha256 <hash>',
      'Exact contract hash'
    );

  command('start', 'Capture the baseline and record the first contract draft')
    .requiredOption('--requirement <path>', 'Original UTF-8 requirement file')
    .requiredOption('--contract <path>', 'YAML contract draft')
    .option('--exclude <path...>', 'Additional project-relative files or directory prefixes')
    .action(async (options: Parameters<typeof startTask>[0]) => {
      console.log(JSON.stringify(await startTask(options), null, 2));
    });

  taskCommand('revise', 'Save a new contract version against the original baseline')
    .requiredOption('--contract <path>', 'YAML contract draft')
    .action(async (options: { repo: string; task: string; contract: string }) => {
      console.log(
        JSON.stringify(await reviseTask(options.repo, options.task, options.contract), null, 2)
      );
    });

  versionCommand('approve', 'Record the operator approval for this exact contract').action(
    async (options: { repo: string; task: string; contractSha256: string }) => {
      console.log(
        JSON.stringify(
          await approveTask(options.repo, options.task, options.contractSha256),
          null,
          2
        )
      );
    }
  );

  versionCommand('review', 'Review a draft without sharing candidate files')
    .requiredOption('--reviewer-config <path>', 'External HTTP or command reviewer configuration')
    .action(
      async (options: {
        repo: string;
        task: string;
        contractSha256: string;
        reviewerConfig: string;
      }) => {
        const provider = await loadReviewer(options.repo, options.reviewerConfig);
        const review = await reviewTask(
          options.repo,
          options.task,
          options.contractSha256,
          provider
        );
        console.log(JSON.stringify(review, null, 2));
        if (review.audit.status === 'ERROR') process.exitCode = 4;
      }
    );
}
