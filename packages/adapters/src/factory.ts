import type { ReviewerProvider } from '@oracle-gate/core';
import { ReviewerConfigSchema } from './config.js';
import { OpenAICompatibleReviewer } from './http-reviewer.js';
import { CommandReviewer } from './command-reviewer.js';
export function createReviewerProvider(
  raw: unknown,
  options: { environment?: Readonly<Record<string, string | undefined>> } = {}
): ReviewerProvider {
  const config = ReviewerConfigSchema.parse(raw);
  return config.type === 'openai-compatible'
    ? new OpenAICompatibleReviewer(config, options.environment)
    : new CommandReviewer(config, options.environment);
}
