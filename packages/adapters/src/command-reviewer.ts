import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import type { Executor, ReviewerProvider } from '@oracle-gate/core';
import { LocalExecutor } from '@oracle-gate/runtime';
import { CommandReviewerConfigSchema, type CommandReviewerConfig } from './config.js';
import {
  makeRequest,
  parseReviewOutput,
  reviewerInstruction,
  reviewerPromptDigest,
  ReviewerError,
  type ReviewStage,
} from './protocol.js';
export class CommandReviewer implements ReviewerProvider {
  readonly id = 'command';
  readonly model: string;
  private readonly config: CommandReviewerConfig;
  constructor(
    config: unknown,
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly executor: Executor = new LocalExecutor()
  ) {
    this.config = CommandReviewerConfigSchema.parse(config);
    this.model = this.config.model;
  }
  interpret(input: Parameters<ReviewerProvider['interpret']>[0]): Promise<unknown> {
    return this.call('interpretation', input);
  }
  review(input: Parameters<ReviewerProvider['review']>[0]): Promise<unknown> {
    return this.call('review', input);
  }
  promptDigest(stage: ReviewStage): string {
    return reviewerPromptDigest(stage, {
      transport: 'command',
      inputFormat: this.config.inputFormat,
      responsePath: this.config.responsePath,
    });
  }
  private async call(stage: ReviewStage, input: unknown): Promise<unknown> {
    const config = this.config;
    const env: Record<string, string> = {};
    for (const name of config.passEnv) {
      const value = this.environment[name];
      if (value !== undefined) env[name] = value;
    }
    const request = JSON.stringify(makeRequest(stage, input));
    const stdin =
      (config.inputFormat === 'json'
        ? request
        : reviewerInstruction + '\nRequest JSON:\n' + request) + '\n';
    if (Buffer.byteLength(stdin) > config.maxInputBytes) throw new ReviewerError('INPUT_LIMIT');
    const cwd = await mkdtemp(join(tmpdir(), 'oracle-gate-reviewer-'));
    const rel = relative(tmpdir(), cwd);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Unsafe reviewer cleanup');
    try {
      const result = await this.executor.run({
        executable: config.executable,
        args: [...config.args],
        cwd,
        stdin,
        env,
        timeoutMs: config.timeoutMs,
        maxOutputBytes: config.maxOutputBytes,
      });
      if (result.error)
        throw new ReviewerError(result.error === 'SPAWN_ERROR' ? 'UNAVAILABLE' : result.error);
      if (result.exitCode !== 0) throw new ReviewerError('COMMAND_FAILED');
      let output = result.stdout;
      if (config.responsePath.length) {
        try {
          let value: unknown = JSON.parse(output);
          for (const key of config.responsePath) {
            if (!value || typeof value !== 'object' || !Object.hasOwn(value, key))
              throw new Error();
            value = (value as Record<string, unknown>)[key];
          }
          output = typeof value === 'string' ? value : JSON.stringify(value);
        } catch {
          throw new ReviewerError('INVALID_RESPONSE');
        }
      }
      return parseReviewOutput(output, stage, Object.values(env));
    } finally {
      await rm(cwd, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}
