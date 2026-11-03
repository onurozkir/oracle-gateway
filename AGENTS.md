# AGENTS.md

## Project scope

Independent Oracle Gateway is a Node.js CLI and ESM package. It runs candidate self-tests and separately supplied oracle cases, then applies a deterministic policy to the evidence. The current candidate protocol is JSON Lines with `amountCents` input and `totalCents` output. The default source is saved workspace files. `--candidate REF` selects a Git commit.

## Where to make changes

| Area                              | Responsibility                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| [Core](packages/core/src)         | Schemas, canonical hashes, reviewer ports, and verdict policy                      |
| [Runtime](packages/runtime/src)   | Task records, snapshots, process execution, oracle comparison, and report assembly |
| [CLI](packages/cli/src)           | Command options, input validation, report rendering calls, and exit codes          |
| [Adapters](packages/adapters/src) | OpenAI-compatible HTTP and local command reviewer transports                       |
| [Tests](tests)                    | Policy and protocol tests, temporary project fixtures, and CLI integration tests   |

Edit the TypeScript sources. Build artifacts come from `npm run build`. Preserve compatibility for existing bundles, approved task records, historical reports, CLI exit codes, and public exports when changing their corresponding interfaces.

## Verification invariants

- Keep expected results in the approved contract and observed results in the candidate execution path. Test a known wrong candidate alongside its corrected counterpart when changing comparison or verdict logic.
- Bind task approval to the exact contract hash. Give each check a fresh copy of the captured candidate. Report live workspace freshness separately from the verdict for that snapshot.
- Persist the reviewer's first interpretation before supplying draft or candidate artifacts. Keep credentials in the reviewer transport and keep raw prompts and process output out of public reports.
- Treat local execution as `UNPROTECTED`. Keep protected mode fail-closed and require the configured assurance for a release verdict. Run only trusted candidates locally.
- Use explicit argument arrays for subprocesses and preserve timeouts, output limits, and temporary-directory cleanup across Windows and Unix.

## Development checks

Use Node.js 24 or later and npm. Git is required for the commit fixtures and demos. On Windows, the process cleanup helper uses the system .NET Framework compiler.

```sh
npm ci
npm run lint
npm run typecheck
npm test
```

For a focused CLI test, rebuild with `npm run build`, then run `npx vitest run tests/cli.test.ts`. Use `npm run demo:wrong` and `npm run demo:correct` when touching the verification flow. Run `npm run test:package` when changing CLI packaging, public exports, or distributed files. Exercise reviewer transports with local fixtures.

## Further guidance

- [README](README.md) for setup and user-facing commands
- [Contributing](CONTRIBUTING.md) for change and pull request guidance
- [Architecture](docs/architecture.md), [threat model](docs/threat-model.md), and [known limitations](docs/known-limitations.md) for trust and execution boundaries
- [Oracle verification skill](.agent/skills/oracle-verification/SKILL.md) for agents operating the task workflow
