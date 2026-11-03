import { digest } from './identity.js';
import { InterpretationSchema, ReviewResultSchema } from './schemas.js';
import type { ReviewerProvider, ReviewReceipt } from './ports.js';
export async function runReview(options: {
  provider: ReviewerProvider;
  requirementId: string;
  requirement: string;
  definitions: string[];
  persist(stage: 'interpretation' | 'review', record: unknown): Promise<void>;
  readCandidate(): Promise<readonly { path: string; content: string }[]>;
}): Promise<ReviewReceipt> {
  const stage1Input = Object.freeze({
    requirementId: options.requirementId,
    requirement: options.requirement,
    definitions: Object.freeze([...options.definitions]),
  });
  const interpretation = InterpretationSchema.parse(await options.provider.interpret(stage1Input));
  if (interpretation.requirementId !== options.requirementId)
    throw new Error('Reviewer requirement identity mismatch');
  const stage1Prompt = options.provider.promptDigest?.('interpretation');
  const stage1Digest = digest({
    template: 'blind-interpretation-v1',
    input: stage1Input,
    interpretation,
    provider: options.provider.id,
    model: options.provider.model,
    prompt: stage1Prompt ?? null,
  });
  // The parent persists the immutable interpretation before even reading candidate bytes.
  await options.persist('interpretation', {
    stage1Digest,
    interpretation: structuredClone(interpretation),
    inputDigest: digest(stage1Input),
    templateId: 'blind-interpretation-v1',
    ...(stage1Prompt ? { promptDigest: stage1Prompt } : {}),
    responseDigest: digest(interpretation),
  });
  const stage2Input = structuredClone({
    interpretation,
    candidateArtifacts: await options.readCandidate(),
  });
  const stage2InputDigest = digest(stage2Input);
  const result = ReviewResultSchema.parse(
    await options.provider.review(structuredClone(stage2Input))
  );
  if (result.differences.some((d) => d.requirementId !== options.requirementId))
    throw new Error('Review references an unknown requirement');
  const stage2Prompt = options.provider.promptDigest?.('review');
  const stage2Digest = digest({
    template: 'candidate-comparison-v1',
    stage1Digest,
    input: stage2Input,
    result,
    prompt: stage2Prompt ?? null,
  });
  await options.persist('review', {
    stage1Digest,
    stage2Digest,
    result: structuredClone(result),
    inputDigest: stage2InputDigest,
    templateId: 'candidate-comparison-v1',
    ...(stage2Prompt ? { promptDigest: stage2Prompt } : {}),
    responseDigest: digest(result),
  });
  // A cooperative in-process provider cannot prove OS-level independence.
  // This receipt intentionally has no final-verdict or independent-approval field.
  return {
    interpretation,
    result,
    stage1Digest,
    stage2Digest,
    provider: options.provider.id,
    model: options.provider.model,
  };
}
