import { z } from 'zod';

export const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const GitSha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const Cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = z.string().min(1).max(4096);
export const VerdictSchema = z.enum(['ACCEPT', 'REJECT', 'INCONCLUSIVE', 'INFRASTRUCTURE_ERROR']);
export const StatusSchema = z.enum(['PASS', 'FAIL', 'UNKNOWN', 'SKIPPED', 'ERROR']);
export const GitCandidateSchema = z.strictObject({
  commitSha: GitSha,
  treeSha: GitSha,
  dirty: z.boolean(),
});
export const CandidateSchema = z.union([
  GitCandidateSchema,
  z.strictObject({
    source: z.literal('workspace'),
    snapshotSha256: Hash,
    dirty: z.boolean(),
  }),
]);
export const TaskId = z.string().regex(/^[a-f0-9]{32}$/);
export const OracleCaseSchema = z.strictObject({
  id: text,
  input: z.strictObject({ amountCents: Cents }),
  expected: z.strictObject({ totalCents: Cents }),
});
export const SpecSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    requirementId: text,
    source: z.strictObject({ uri: text, sha256: Hash }),
    rule: z.strictObject({
      description: text,
      boundary: z.strictObject({
        operator: z.enum(['>', '>=', '<', '<=', '==']),
        amountCents: Cents,
      }),
      discountBasisPoints: z.number().int().min(0).max(10000),
    }),
    adapter: z.strictObject({
      id: z.literal('json-stdio-v1'),
      inputField: z.literal('amountCents'),
      outputField: z.literal('totalCents'),
    }),
    cases: z.array(OracleCaseSchema).min(1).max(10000),
  })
  .refine(
    (s) => new Set(s.cases.map((c) => c.id)).size === s.cases.length,
    'Duplicate oracle case ID'
  );
export const PolicySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    profile: z.enum(['standard', 'critical']),
    requireReview: z.boolean(),
    maxEvidenceAgeMs: z.number().int().min(1).max(86400000),
  })
  .refine(
    (p) => p.profile !== 'critical' || p.requireReview,
    'Critical policy requires independent review'
  );
export const InterpretationSchema = z.strictObject({
  requirementId: text,
  operator: z.enum(['>', '>=', '<', '<=', '==']),
  unit: z.literal('cents'),
  threshold: Cents,
  assumptions: z.array(text),
  uncertainty: z.array(text),
  proposedCases: z.array(OracleCaseSchema).min(1),
});
export const ReviewResultSchema = z.strictObject({
  differences: z.array(z.strictObject({ requirementId: text, location: text, description: text })),
  uncertainty: z.array(text),
});
const observations = {
  SELF_TESTS: z.strictObject({ exitCode: z.number().int().nullable() }),
  ORACLE: z.strictObject({
    cases: z
      .array(
        z.strictObject({
          id: text,
          input: Cents,
          expected: Cents,
          actual: Cents.nullable(),
          status: StatusSchema,
        })
      )
      .min(1),
  }),
  REVIEW: z.strictObject({
    independent: z.boolean(),
    stage1Digest: Hash.optional(),
    stage2Digest: Hash.optional(),
    provider: text,
    model: text,
    disagreements: z.array(text),
    reasonCode: text.optional(),
  }),
  PROVENANCE: z.strictObject({ exitCode: z.number().int().nullable() }),
};
const common = {
  status: StatusSchema,
  candidate: CandidateSchema,
  specSha256: Hash,
  oracleSha256: Hash,
  policySha256: Hash,
  verifierId: text,
  verifierVersion: text,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  provenance: z.strictObject({
    commandArgv: z.array(z.string()).optional(),
    executor: z.enum(['local-unprotected', 'protected-ci']),
    inputDigests: z.record(z.string(), Hash),
  }),
};
export const EvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...common,
    kind: z.literal('SELF_TESTS'),
    observations: observations.SELF_TESTS,
  }),
  z.strictObject({ ...common, kind: z.literal('ORACLE'), observations: observations.ORACLE }),
  z.strictObject({ ...common, kind: z.literal('REVIEW'), observations: observations.REVIEW }),
  z.strictObject({
    ...common,
    kind: z.literal('PROVENANCE'),
    observations: observations.PROVENANCE,
  }),
]);
export const PolicyInputSchema = z.strictObject({
  candidate: CandidateSchema,
  specSha256: Hash,
  oracleSha256: Hash,
  policySha256: Hash,
  policy: PolicySchema,
  trust: z.enum(['unapproved', 'local-pinned', 'protected']),
  assurance: z.enum(['local-unprotected', 'protected-ci']),
  purpose: z.enum(['demonstration', 'release']),
  now: z.iso.datetime(),
  evidence: z.array(EvidenceSchema),
  disagreements: z.array(text),
});
export const DecisionSchema = z.strictObject({
  verdict: VerdictSchema,
  reasons: z.array(text),
  requiredChecks: z.array(z.enum(['SELF_TESTS', 'ORACLE', 'REVIEW', 'PROVENANCE'])),
});
export const ReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.uuid(),
  timestamp: z.iso.datetime(),
  input: PolicyInputSchema,
  decision: DecisionSchema,
  approval: z.strictObject({
    status: z.enum(['unapproved', 'local-pinned', 'protected']),
    source: text,
    bundleSha256: Hash,
    authorityId: text.nullable(),
    approvalRecordId: text.nullable(),
  }),
  tools: z.record(z.string(), z.string()),
  limitations: z.array(text),
  workspace: z
    .strictObject({
      freshness: z.enum(['CURRENT', 'CHANGED', 'UNKNOWN']),
      task: z
        .strictObject({
          id: TaskId,
          contractSha256: Hash,
          baselineSha256: Hash,
          changes: z.strictObject({
            added: z.array(text),
            modified: z.array(text),
            deleted: z.array(text),
          }),
        })
        .optional(),
    })
    .optional(),
  review: z
    .strictObject({
      provider: text,
      model: text,
      status: z.enum(['COMPLETE', 'ERROR']),
      reasonCode: text,
      contextAssurance: z.literal('cooperative-local'),
      stages: z.array(
        z.strictObject({
          stage: z.enum(['interpretation', 'review']),
          inputDigest: Hash,
          templateId: text,
          promptDigest: Hash.optional(),
          responseDigest: Hash,
          receiptDigest: Hash,
        })
      ),
      artifactManifest: z.array(z.strictObject({ path: text, sha256: Hash })),
      findings: z.array(z.strictObject({ requirementId: text, location: text, description: text })),
      uncertainty: z.array(text),
      interpretation: InterpretationSchema.optional(),
    })
    .optional(),
});
export type Verdict = z.infer<typeof VerdictSchema>;
export type CandidateIdentity = z.infer<typeof CandidateSchema>;
export type GitCandidateIdentity = z.infer<typeof GitCandidateSchema>;
export type Spec = z.infer<typeof SpecSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type CheckEvidence = z.infer<typeof EvidenceSchema>;
export type PolicyInput = z.infer<typeof PolicyInputSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Report = z.infer<typeof ReportSchema>;
export type Interpretation = z.infer<typeof InterpretationSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
