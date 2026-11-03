# Execution ledger — standalone oracle component

Scope clarified on 2026-11-03. The repository implements one independent oracle step of a broader verification design.

## Changes under the clarified scope

- Removed external-tool implementations, public adapter interfaces, schema kinds, policy obligations and CLI options.
- Removed tool-specific test cases, candidate configuration and source provisioning scripts. Remaining tests do not skip for absent third-party verifiers.
- Removed Python setup and external tool provisioning from CI. Verification requires a candidate commit, not a source-revert baseline.
- Kept exact Git identity, one fresh snapshot per oracle case, strict JSONL comparison, bounded local execution, typed evidence and deterministic policy.
- Kept the optional two-stage reviewer context contract. No configured provider means no fabricated independent-review evidence.
- Added compiled standalone CLI/core bundles, a package export map, declarations and an explicit published-file allowlist.
- Added a real tarball install check in an empty consumer project: public API, CLI and wrong/correct Git fixtures run from the installed package.

## Verification

- `npm test`: 8 files, 72 tests passed with no external tool setup and after removing the downloaded source checkouts. Required-check policy matrix covers 216 combinations of the three component-owned obligations.
- `npm ci`, `npm run lint`, `npm run typecheck`: passed; installation audit reported zero vulnerabilities.
- Wrong candidate: self-tests PASS, oracle FAIL, REJECT. Correct standard candidate: oracle PASS, ACCEPT. Critical comparison: INCONCLUSIVE as expected.
- `npm run test:package`: the actual 12-file archive was installed into an empty consumer project; public API, CLI and real wrong/correct Git candidates passed. Normal packing executes prepack to rebuild current source.
- Final focused code review found no removal-related trust regressions. Fixed the report-default issue with a failing two-consecutive-verifications regression test: JSON files are now written only when explicitly requested. Added prepack build so ordinary packing cannot rely on stale root bundles.

## Preserved decisions

The owner chose in-place development and confirmed removal of the legacy scaffold. Their earlier edits to .editorconfig, .env.example and .prettierrc remain unchanged. License stays UNLICENSED/private until the owner decides otherwise. No branch switch, commit, publication or deployment was performed.

Local execution is still UNPROTECTED. Content hashes are not approval authentication. Protected release authority, an independent provider where required, hosted CI execution and real model benchmarks remain separate release tasks; external verification tools are not blockers for completing this component.

## Dual reviewer providers — 2026-11-03

Implemented both owner-selected connection modes under ReviewerProvider: configurable OpenAI-compatible Chat Completions and local command/agent stdin transport. Added --reviewer-config outside the candidate repository, environment-only credential references, fresh stage requests/processes, bounded artifacts, persisted Stage 1 interpretation, prompt/input/response/receipt hashes, structured findings and proposed-case audit. No runtime SDK or external verifier dependencies were added.

The actual local environment cannot prove protected review independence. Completed review is auditable, but REVIEW stays UNKNOWN/INDEPENDENCE_UNVERIFIED and required independent review remains inconclusive. Disagreements block acceptance even when Stage 2 fails; oracle failure remains authoritative.

Latest verification: npm run lint, npm run typecheck and npm test all passed (97 tests in 10 files). npm run test:package passed with the installed 22-file archive, public reviewer export, external TypeScript consumer and actual command-backed installed CLI. Postman local simulation exercised the real HTTP client against success, 401/403/429/500 and timeout; no live paid model or vendor CLI preset was run. The simulation was stopped.

Read-only review corrections were proven with failing regressions first: retained Stage 1 uncertainty/boundary/proposed-case conflicts on later errors, bounded disagreement references for maximum-length findings, and real prompt/schema/transport fingerprints instead of fixed-label hashes. The normal full suite is green after fixes.

Postman CLI 1.76.0 lacks the skill-documented status command; whoami was used, and the API-engineer skill-authorized feedback channel received only the generic version/command mismatch. No project data or credentials were included.
