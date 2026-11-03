# Architecture decision record — 2026-11-03

Status: implemented local vertical slice; protected production gate is unavailable.

The gateway answers whether observed behavior agrees with independently supplied expectations. It separates candidate self-test results from independent oracle correctness. Its evidence and exit codes form a standalone component contract.

## Decisions

1. CLI first, Node 24+, strict TypeScript/ESM and four npm workspaces. No hosted API or agent orchestration service. Node 24 was executed locally; Node 26 is an additional CI lane, not a locally verified version. The [Node release schedule](https://github.com/nodejs/Release/blob/main/schedule.json) lists both supported LTS lines on the implementation date.
2. The core owns strict Zod schemas, sorted-key canonical JSON, SHA-256, BigInt currency arithmetic, policy and ports. Runtime owns Git, processes, bundles, comparisons and orchestration. The adapter workspace contains optional reviewer sequencing. The shipped CLI/core bundles resolve no private workspace packages at runtime.
3. Candidate modules are never imported into the gateway. A candidate Node executable receives one JSON line per fresh process; the parent validates and compares one response to the oracle.
4. Exact commits are cloned into independent temporary repositories without hardlinks. Symlinks and submodules are rejected before checkout. The source checkout is never reset or reverted. Dirty source requires an explicit option and cannot be accepted.
   Self-tests and each individual oracle case use separate fresh clones so ignored/generated test artifacts cannot change acceptance behavior.
5. Local bundle files live outside the candidate repository. The caller explicitly pins the manifest digest for a demonstration. This identifies bytes; it is not authenticated approval. Protected mode refuses to execute until a protected executor and authority source exist.
6. Source-revert sensitivity and completion-authority admission belong to the wider system. This package has no adapter, runtime obligation, installation step or test dependency for those tools. It exposes deterministic JSON and exit codes for composition by external callers.
7. A core reviewer coordinator gives Stage 1 only requirement text, ID and definitions, validates and persists the interpretation, then reads candidate artifacts for Stage 2. Configurable OpenAI-compatible HTTP and local command transports use fresh requests/processes. Structured findings and prompt/input/response hashes are audited. This cooperative boundary is not OS confinement or release-grade independence; no independent reviewer PASS is fabricated.

## Canonical identities

Objects serialize with recursively sorted own keys; arrays retain order. Values are finite JSON primitives, arrays or plain objects. Undefined, BigInt, nonfinite numbers and special objects are rejected. UTF-8 canonical bytes are SHA-256 hashed. This is a project-specific contract, not a claim of full RFC 8785 compliance. Requirement markdown uses its raw UTF-8 byte digest. Git commit and tree SHAs are recorded separately.

A local bundle contains fixed files: `requirement.md`, `spec.yaml`, `policy.yaml`, `manifest.json`. The manifest has `schemaVersion`, `specSha256`, `oracleSha256` (cases), `policySha256`, `requirementSha256`. Its canonical digest is the explicit local pin. No `approved` field is accepted. YAML duplicate keys, unknown tags and aliases are rejected.

## Decision precedence

| Priority | Condition | Result |
| --- | --- | --- |
| Input | Malformed schema/configuration | CLI exit 1; no invented verdict |
| 1 | Required process/protocol ERROR | INFRASTRUCTURE_ERROR |
| 2 | Unapproved input, dirty identity, stale/mismatched/duplicate evidence | INCONCLUSIVE |
| 3 | Eligible required FAIL | REJECT |
| 4 | Disagreement, missing required check, insufficient protected assurance | INCONCLUSIVE |
| 5 | Every applicable obligation satisfied | ACCEPT |

An oracle failure can reject the wrong critical candidate even when the reviewer is unavailable. A correct local critical candidate stays inconclusive. Local standard ACCEPT is explicitly a demonstration, never a production release authorization. The pure policy function assumes its caller assembled authenticated/eligible evidence; exporting this function cannot authenticate arbitrary third-party JSON.

## Protected executor contract (design only)

A future separately maintained CI controller must fetch a pinned gateway image from a protected release, an authenticated approved bundle from a protected ref/artifact, and an exact candidate SHA. It must run the candidate in a separate container/VM with no credentials, no network, read-only candidate and authority mounts, writable scratch only, a non-root UID, dropped capabilities, CPU/memory/PID/time limits and process-tree cleanup. The trusted parent owns evidence and comparison. Reviewer provider credentials and release-authority credentials stay in a separate trusted process. Policy cannot be overridden from the candidate. See [threat-model.md](threat-model.md). The current CI workflow runs trusted cooperative fixtures and is not this controller.
