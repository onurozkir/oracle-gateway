import { digest } from './identity.js';
import { PolicyInputSchema, type Decision, type CheckEvidence } from './schemas.js';

/** Accepts only gateway-assembled evidence. This pure function is not an authentication boundary. */
export function evaluate(raw: unknown): Decision {
  const input = PolicyInputSchema.parse(raw);
  const requiredChecks: CheckEvidence['kind'][] = ['SELF_TESTS', 'ORACLE'];
  if (input.policy.requireReview) requiredChecks.push('REVIEW');
  const answer = (verdict: Decision['verdict'], ...reasons: string[]): Decision => ({
    verdict,
    reasons,
    requiredChecks,
  });
  const required = input.evidence.filter((e) => requiredChecks.includes(e.kind));
  if (required.some((e) => e.status === 'ERROR'))
    return answer('INFRASTRUCTURE_ERROR', 'REQUIRED_CHECK_ERROR');
  if (input.trust === 'unapproved') return answer('INCONCLUSIVE', 'ORACLE_NOT_APPROVED');
  if (input.candidate.dirty) return answer('INCONCLUSIVE', 'DIRTY_CANDIDATE');
  const now = Date.parse(input.now);
  for (const e of input.evidence) {
    if (
      digest(e.candidate) !== digest(input.candidate) ||
      e.specSha256 !== input.specSha256 ||
      e.oracleSha256 !== input.oracleSha256 ||
      e.policySha256 !== input.policySha256 ||
      e.provenance.executor !== input.assurance
    )
      return answer('INCONCLUSIVE', 'IDENTITY_MISMATCH');
    if (
      Date.parse(e.finishedAt) < Date.parse(e.startedAt) ||
      Date.parse(e.finishedAt) > now ||
      now - Date.parse(e.startedAt) > input.policy.maxEvidenceAgeMs
    )
      return answer('INCONCLUSIVE', 'STALE_EVIDENCE');
  }
  if (new Set(input.evidence.map((e) => e.kind)).size !== input.evidence.length)
    return answer('INCONCLUSIVE', 'DUPLICATE_EVIDENCE');
  // Validate observation consistency, not just an arbitrary PASS field.
  for (const e of required) {
    if (e.status !== 'PASS') continue;
    if (
      (e.kind === 'SELF_TESTS' && e.observations.exitCode !== 0) ||
      (e.kind === 'ORACLE' &&
        e.observations.cases.some((c) => c.status !== 'PASS' || c.actual !== c.expected)) ||
      (e.kind === 'REVIEW' &&
        (!e.observations.independent ||
          !e.observations.stage1Digest ||
          !e.observations.stage2Digest ||
          e.observations.disagreements.length > 0))
    )
      return answer('INCONCLUSIVE', 'INCONSISTENT_OBSERVATIONS');
  }
  if (required.some((e) => e.status === 'FAIL'))
    return answer(
      'REJECT',
      ...required.filter((e) => e.status === 'FAIL').map((e) => e.kind + '_FAILED')
    );
  if (input.disagreements.length) return answer('INCONCLUSIVE', 'SEMANTIC_DISAGREEMENT');
  if (
    (input.purpose === 'release' || input.policy.profile === 'critical') &&
    (input.trust !== 'protected' || input.assurance !== 'protected-ci')
  )
    return answer('INCONCLUSIVE', 'PROTECTED_AUTHORITY_REQUIRED');
  const missing = requiredChecks.filter(
    (kind) => !required.some((e) => e.kind === kind && e.status === 'PASS')
  );
  if (missing.length)
    return answer('INCONCLUSIVE', ...missing.map((kind) => kind + '_MISSING_OR_INSUFFICIENT'));
  return answer('ACCEPT');
}
export const exitCodes = {
  ACCEPT: 0,
  REJECT: 2,
  INCONCLUSIVE: 3,
  INFRASTRUCTURE_ERROR: 4,
} as const;
