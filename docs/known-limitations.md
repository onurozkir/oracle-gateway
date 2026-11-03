# Implemented scope and remaining work

This is a functioning cooperative local verification tool with a real Git/subprocess demonstration. It is not a completed protected release gate.

- All candidate runs are UNPROTECTED. No authenticated OracleSource or protected executor exists. `--protected` returns infrastructure exit 4 before candidate execution. Local critical policy stays inconclusive on otherwise correct code.
- The current verifier protocol is intentionally numeric discount JSONL, not a generic arbitrary-language/business-rule engine. Node executable entries are supported. Candidate dependencies are not installed into snapshots.
- OpenAI-compatible HTTP and local command reviewer transports are implemented and wired to verification. No paid live provider or particular vendor CLI preset has been executed. Context separation is cooperative, not OS-isolated; required independent review remains INCONCLUSIVE. Context is limited to 100 supported tracked text files and 512 KiB; unsupported/secret-like/generated files are excluded and included files have an explicit manifest. See reviewers.md.
- Local timeouts, captured output limits and process-tree cleanup do not establish hard memory, CPU, network, filesystem or PID isolation. Windows uses a native suspended-start, kill-on-close Job Object helper (requires the inbox .NET Framework compiler); Unix cleans the process group but a deliberately detached session can escape it. The child Node heap limit does not bound native buffers.
- JSON reports are historical unsigned observations, not attestations. `report` recomputes their decision but does not rerun code or prove current freshness, author identity or approval.
- The 42 seeded benchmark cases are synthetic comparison smoke tests. Same-model/cross-model/self-review experiments, token costs, real-world false-positive/negative rates and protected CI experiments have NOT been run.
- The workflow is ordinary trusted-fixture CI, not a protected controller that safely runs arbitrary PR code. Hosted CI matrix results are unverified until actually run there.
- The package is marked `private` and `UNLICENSED`.

See the [architecture decisions](architecture.md) and [implementation history](implementation-progress.md).
