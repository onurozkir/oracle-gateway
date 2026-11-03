# Threat model

## What the working local demo addresses

An agent misunderstands an exclusive threshold and writes both implementation and tests using an inclusive threshold. Those tests pass. Separately supplied exact-threshold expectations still reject the implementation. The real Git fixture proves this accidental common-mode failure without claiming objective correctness for arbitrary requirements.

## Assets and boundaries

The original requirement, oracle cases, policy, candidate SHA/tree, reviewer context and final evidence must retain their identities. Candidate code, tests, comments, config and stdout are untrusted. A candidate-owned approval flag or report is never loaded as oracle authority. Oracle responses are parsed as numeric output, never as executable code or verifier attestations.

The local operator can pin a separate bundle. This is a declared cooperative assumption, not author authentication. A process with the same Windows/Linux identity can read or modify that bundle, source repo, gateway, Git metadata or logs. It can use the network or read host files. Environment filtering and temporary clones do not prevent this. `--protected` fails closed, and `critical` policy never accepts this environment.

## Implemented controls and limits

| Risk | Implemented control | Remaining limit |
| --- | --- | --- |
| Shared wrong business assumption | Independent expected outputs; real exact-threshold case | Oracle author can still misunderstand the requirement |
| Self-consistent wrong tests | Independent expected outputs compared by the parent | Test sensitivity is outside this component |
| Shell injection | Explicit argv and shell false | Candidate program itself can spawn arbitrary commands locally |
| Stale code/evidence | SHA/tree binding, time checks, snapshot and source recheck | Same-user transient tampering is not prevented |
| Local approval tampering | Strict fixed bundle + externally supplied local pin + recheck | Pin is not authenticated release authority |
| Secrets in environment/output | Small environment allowlist; reports omit raw stdout/stderr | Candidate can read host filesystem in local mode |
| Timeout/output exhaustion | Per-process timeout, combined bounded capture, process-tree kill attempt | No hard OS CPU/PID/disk quota |
| Path traversal/symlinks | Snapshot entry containment; reject symlink and submodule Git modes | Local malicious process can race filesystem operations |
| Reviewer prompt injection | Narrow typed inputs, candidate delayed until Stage 1 persisted | No real independent provider/executor implemented |
| Report forgery | Strict schema and decision recomputation for historical display | JSON report is unsigned; never a fresh release check |

## Protected authority source (future requirement)

Maintainers must place approved requirement/oracle/policy in a separate protected Git ref or separately controlled CI artifact. The trusted CI job must authenticate that source, pin the gateway/verifier implementation independently of the PR, and bind its check status to the exact candidate commit. The PR must not modify that job or acquire its credentials. Merely setting `CI=true`, a SHA argument, `authorityId`, or an environment variable does not meet this requirement.

No production credentials or model keys are needed by the current demo. Do not use local mode to execute a hostile third-party repository. Material requirement disputes require the domain owner; model majority voting is not an authority mechanism.
