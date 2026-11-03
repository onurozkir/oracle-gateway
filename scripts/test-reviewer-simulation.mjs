import assert from 'node:assert/strict';
import { createReviewerProvider } from '../dist/reviewers.js';
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:47831/reviewer-chat/v1';
const reviewer = createReviewerProvider({
  type: 'openai-compatible',
  baseUrl,
  model: 'sim-success',
});
const interpretation = await reviewer.interpret({
  requirementId: 'DISCOUNT-001',
  requirement: 'Discount only above 10000 cents',
  definitions: [],
});
const result = await reviewer.review({ interpretation, candidateArtifacts: [] });
assert.deepEqual(result, { differences: [], uncertainty: [] });
for (const status of [401, 403, 429, 500])
  await assert.rejects(
    () =>
      createReviewerProvider({
        type: 'openai-compatible',
        baseUrl,
        model: 'sim-' + status,
      }).interpret({ requirementId: 'DISCOUNT-001', requirement: 'test', definitions: [] }),
    (error) => error.code === 'HTTP_ERROR'
  );
await assert.rejects(
  () =>
    createReviewerProvider({
      type: 'openai-compatible',
      baseUrl,
      model: 'sim-timeout',
      timeoutMs: 100,
    }).interpret({ requirementId: 'DISCOUNT-001', requirement: 'test', definitions: [] }),
  (error) => error.code === 'TIMEOUT'
);
console.log(
  'Postman local simulation verified: interpretation, review, 401/403/429/500 and timeout. No live model calls.'
);
