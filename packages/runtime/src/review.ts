import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import {
  digest,
  runReview,
  sha256,
  InterpretationSchema,
  type CheckEvidence,
  type OracleBundle,
  type Report,
  type ReviewerProvider,
} from '@oracle-gate/core';
import { isWithin } from './git.js';
type Audit = NonNullable<Report['review']>;
const codeSet = new Set([
  'MISSING_CREDENTIAL',
  'TIMEOUT',
  'INPUT_LIMIT',
  'OUTPUT_LIMIT',
  'HTTP_ERROR',
  'INVALID_RESPONSE',
  'UNAVAILABLE',
  'COMMAND_FAILED',
  'CONTEXT_LIMIT',
]);
export async function runCandidateReview(options: {
  readArtifacts(): Promise<readonly { path: string; content: string }[]>;
  bundle: OracleBundle;
  provider: ReviewerProvider;
}): Promise<{
  audit: Audit;
  observations: Extract<CheckEvidence, { kind: 'REVIEW' }>['observations'];
  disagreements: string[];
}> {
  const { bundle, provider } = options;
  const audit: Audit = {
    provider: provider.id,
    model: provider.model,
    status: 'ERROR',
    reasonCode: 'REVIEW_FAILED',
    contextAssurance: 'cooperative-local',
    stages: [],
    artifactManifest: [],
    findings: [],
    uncertainty: [],
  };
  const directory = await mkdtemp(join(tmpdir(), 'oracle-gate-review-audit-'));
  if (!isWithin(tmpdir(), directory) || directory === tmpdir())
    throw new Error('Unsafe review cleanup');
  const disagreements: string[] = [];
  try {
    let firstReceipt = '';
    const receipt = await runReview({
      provider,
      requirementId: bundle.spec.requirementId,
      requirement: bundle.requirement,
      definitions: [],
      persist: async (stage, raw) => {
        const record = raw as {
          inputDigest: string;
          templateId: string;
          promptDigest?: string;
          responseDigest: string;
          interpretation?: unknown;
        };
        if (stage === 'interpretation') {
          const interpretation = InterpretationSchema.parse(record.interpretation);
          audit.interpretation = interpretation;
          audit.uncertainty = [...interpretation.uncertainty];
          if (
            interpretation.operator !== bundle.spec.rule.boundary.operator ||
            interpretation.threshold !== bundle.spec.rule.boundary.amountCents
          )
            disagreements.push('REVIEW_RULE_CONFLICT');
          for (const proposed of interpretation.proposedCases) {
            const approved = bundle.spec.cases.find(
              (c) => digest(c.input) === digest(proposed.input)
            );
            if (approved && digest(approved.expected) !== digest(proposed.expected))
              disagreements.push(
                'REVIEW_CASE_CONFLICT:' + digest({ id: approved.id, input: approved.input })
              );
          }
          disagreements.push(
            ...interpretation.uncertainty.map((value) => 'REVIEW_UNCERTAINTY:' + digest(value))
          );
        }
        const receiptDigest = digest(raw);
        await writeFile(join(directory, stage + '.json'), JSON.stringify(raw), { flag: 'wx' });
        if (stage === 'interpretation') firstReceipt = receiptDigest;
        audit.stages.push({
          stage,
          inputDigest: record.inputDigest,
          templateId: record.templateId,
          ...(record.promptDigest ? { promptDigest: record.promptDigest } : {}),
          responseDigest: record.responseDigest,
          receiptDigest,
        });
      },
      readCandidate: async () => {
        if (
          !firstReceipt ||
          digest(JSON.parse(await readFile(join(directory, 'interpretation.json'), 'utf8'))) !==
            firstReceipt
        )
          throw new Error('Stage 1 receipt changed');
        const artifacts = await options.readArtifacts();
        audit.artifactManifest = artifacts.map(({ path, content }) => ({
          path,
          sha256: sha256(content),
        }));
        return artifacts;
      },
    });
    audit.status = 'COMPLETE';
    audit.interpretation = receipt.interpretation;
    audit.reasonCode = 'INDEPENDENCE_UNVERIFIED';
    audit.findings = receipt.result.differences;
    audit.uncertainty = [...receipt.interpretation.uncertainty, ...receipt.result.uncertainty];
    disagreements.push(
      ...receipt.result.differences.map((d) => 'REVIEW_DIFFERENCE:' + digest(d)),
      ...receipt.result.uncertainty.map((value) => 'REVIEW_UNCERTAINTY:' + digest(value))
    );
    return {
      audit,
      disagreements,
      observations: {
        independent: false,
        stage1Digest: receipt.stage1Digest,
        stage2Digest: receipt.stage2Digest,
        provider: provider.id,
        model: provider.model,
        disagreements,
        reasonCode: audit.reasonCode,
      },
    };
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error ? String(error.code) : 'REVIEW_FAILED';
    audit.reasonCode = codeSet.has(code) ? code : 'REVIEW_FAILED';
    return {
      audit,
      disagreements,
      observations: {
        independent: false,
        provider: provider.id,
        model: provider.model,
        disagreements,
        reasonCode: audit.reasonCode,
      },
    };
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}

export async function readReviewArtifacts(snapshot: string, files: string[]) {
  const artifacts: { path: string; content: string }[] = [];
  let total = 0;
  const supported = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.py',
    '.go',
    '.rs',
    '.java',
    '.cs',
    '.json',
    '.yaml',
    '.yml',
    '.md',
    '.sql',
    '.txt',
  ]);
  for (const path of files) {
    if (
      !supported.has(extname(path).toLowerCase()) ||
      /(^|\/)(node_modules|dist|build|coverage|vendor|\.git)(\/|$)/i.test(path) ||
      /(^|\/)(\.env.*|.*credentials.*|.*secrets.*|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i.test(
        path
      )
    )
      continue;
    const location = join(snapshot, path);
    const size = (await stat(location)).size;
    if (artifacts.length >= 100 || total + size > 524288)
      throw Object.assign(new Error('Reviewer context exceeds bound'), {
        code: 'CONTEXT_LIMIT',
      });
    const bytes = await readFile(location);
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw Object.assign(new Error('Non-text reviewer artifact'), {
        code: 'CONTEXT_LIMIT',
      });
    }
    total += bytes.length;
    artifacts.push({ path, content });
  }
  if (!artifacts.length)
    throw Object.assign(new Error('Empty reviewer context'), { code: 'CONTEXT_LIMIT' });
  return artifacts;
}
