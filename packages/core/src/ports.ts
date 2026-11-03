import type { Interpretation, Policy, ReviewResult, Spec } from './schemas.js';
export interface ProcessRequest {
  executable: string;
  args: string[];
  cwd: string;
  stdin?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string>;
}
export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error: 'TIMEOUT' | 'OUTPUT_LIMIT' | 'SPAWN_ERROR' | null;
}
export interface Executor {
  readonly assurance: 'local-unprotected' | 'protected-ci';
  run(request: ProcessRequest): Promise<ProcessResult>;
}
export interface OracleBundle {
  spec: Spec;
  policy: Policy;
  requirement: string;
  specSha256: string;
  oracleSha256: string;
  policySha256: string;
  bundleSha256: string;
  source: string;
}
export interface OracleSource {
  load(): Promise<OracleBundle>;
}
/** Separate provider calls; no candidate access is supplied to Stage 1. */
export interface ReviewerProvider {
  readonly id: string;
  readonly model: string;
  promptDigest?(stage: 'interpretation' | 'review'): string;
  interpret(
    input: Readonly<{ requirementId: string; requirement: string; definitions: readonly string[] }>
  ): Promise<unknown>;
  review(
    input: Readonly<{
      interpretation: Interpretation;
      candidateArtifacts: readonly { path: string; content: string }[];
    }>
  ): Promise<unknown>;
}
export interface ReviewReceipt {
  interpretation: Interpretation;
  result: ReviewResult;
  stage1Digest: string;
  stage2Digest: string;
  provider: string;
  model: string;
}
