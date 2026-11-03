import { z } from 'zod';
const argument = z
  .string()
  .max(8192)
  .refine((value) => !value.includes('\0'), 'NUL is not allowed');
const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const common = {
  timeoutMs: z.number().int().min(10).max(300000).default(30000),
  maxInputBytes: z.number().int().min(32).max(4194304).default(524288),
  maxOutputBytes: z.number().int().min(32).max(4194304).default(262144),
};
export const HttpReviewerConfigSchema = z.strictObject({
  ...common,
  type: z.literal('openai-compatible'),
  model: argument.min(1).max(256),
  baseUrl: z.url().refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  }, 'HTTPS required except loopback; URL credentials and queries are forbidden'),
  apiKeyEnv: envName.optional(),
  responseFormat: z.enum(['json', 'text']).default('json'),
});
export const CommandReviewerConfigSchema = z.strictObject({
  ...common,
  type: z.literal('command'),
  executable: argument.min(1),
  args: z.array(argument).max(100).default([]),
  model: argument.min(1).max(256).default('configured-local-agent'),
  passEnv: z.array(envName).max(30).default([]),
  inputFormat: z.enum(['json', 'prompt']).default('json'),
  responsePath: z.array(z.string().min(1).max(100)).max(10).default([]),
});
export const ReviewerConfigSchema = z.discriminatedUnion('type', [
  HttpReviewerConfigSchema,
  CommandReviewerConfigSchema,
]);
export type HttpReviewerConfig = z.infer<typeof HttpReviewerConfigSchema>;
export type CommandReviewerConfig = z.infer<typeof CommandReviewerConfigSchema>;
export type ReviewerConfig = z.infer<typeof ReviewerConfigSchema>;
