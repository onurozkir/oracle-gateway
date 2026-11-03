import type { ReviewerProvider } from '@oracle-gate/core';
import { HttpReviewerConfigSchema, type HttpReviewerConfig } from './config.js';
import {
  makeRequest,
  parseReviewOutput,
  reviewerInstruction,
  reviewerPromptDigest,
  ReviewerError,
  type ReviewStage,
} from './protocol.js';
export class OpenAICompatibleReviewer implements ReviewerProvider {
  readonly id = 'openai-compatible';
  readonly model: string;
  private readonly config: HttpReviewerConfig;
  constructor(
    config: unknown,
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env
  ) {
    this.config = HttpReviewerConfigSchema.parse(config);
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
      transport: 'chat-completions',
      responseFormat: this.config.responseFormat,
    });
  }
  private async call(stage: ReviewStage, input: unknown): Promise<unknown> {
    const config = this.config;
    const key = config.apiKeyEnv ? this.environment[config.apiKeyEnv] : undefined;
    if (config.apiKeyEnv && !key) throw new ReviewerError('MISSING_CREDENTIAL');
    const request = {
      model: this.model,
      stream: false,
      messages: [
        { role: 'system', content: reviewerInstruction },
        { role: 'user', content: JSON.stringify(makeRequest(stage, input)) },
      ],
      ...(config.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
    };
    const body = JSON.stringify(request);
    if (Buffer.byteLength(body) > config.maxInputBytes) throw new ReviewerError('INPUT_LIMIT');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const url = new URL(config.baseUrl);
      url.pathname = url.pathname.replace(/\/?$/, '/') + 'chat/completions';
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(key ? { authorization: 'Bearer ' + key } : {}),
        },
        body,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ReviewerError('HTTP_ERROR');
      }
      if (Number(response.headers.get('content-length')) > config.maxOutputBytes) {
        await response.body?.cancel();
        throw new ReviewerError('OUTPUT_LIMIT');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ReviewerError('INVALID_RESPONSE');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > config.maxOutputBytes) {
          await reader.cancel();
          throw new ReviewerError('OUTPUT_LIMIT');
        }
        chunks.push(next.value);
      }
      let envelope: unknown;
      try {
        envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new ReviewerError('INVALID_RESPONSE');
      }
      const first = (
        envelope as {
          choices?: {
            finish_reason?: unknown;
            message?: { content?: unknown; refusal?: unknown; tool_calls?: unknown };
          }[];
        }
      )?.choices?.[0];
      if (
        first?.finish_reason !== 'stop' ||
        typeof first.message?.content !== 'string' ||
        first.message.refusal ||
        first.message.tool_calls
      )
        throw new ReviewerError('INVALID_RESPONSE');
      return parseReviewOutput(first.message.content, stage, key ? [key] : []);
    } catch (error) {
      if (error instanceof ReviewerError) throw error;
      if (controller.signal.aborted) throw new ReviewerError('TIMEOUT');
      throw new ReviewerError('HTTP_ERROR');
    } finally {
      clearTimeout(timer);
    }
  }
}
