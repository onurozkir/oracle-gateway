# Independent Oracle Gateway

**Read the article behind this project** · [When All AI Agents Agree on an Error, Who Verifies the Truth?](https://onurozkir.com/en/ai-native-swe/when-all-ai-agents-agree-on-an-error)

Independent Oracle Gateway is a TypeScript CLI that checks AI-generated code against separately approved acceptance cases. It runs the project's own tests and the oracle cases against the same captured version of the code, then records the evidence and verdict in a JSON report.

```sh
npm install @onurozkir/oracle-gateway
```

[Architecture](docs/architecture.md) · [Releases](https://github.com/onurozkir/oracle-gateway/releases) · [CI](https://github.com/onurozkir/oracle-gateway/actions/workflows/ci.yml) · [Package workflow](https://github.com/onurozkir/oracle-gateway/actions/workflows/publish-package.yml)

A pricing agent can implement and test a 10% discount for orders of **100 TL or more** even though the requirement says **over 100 TL**. Its tests pass. The oracle checks exactly 100 TL, expects 100 TL, observes 90 TL, and returns `REJECT`.

## Run the demos from source

Use Node.js 24 or later and npm. Git is required for the bundled demos and explicit commit verification. Local workspace verification also works in directories without Git. On Windows, the process cleanup helper uses the system .NET Framework compiler.

From a checkout of this repository:

```sh
npm ci
npm run demo:wrong
npm run demo:correct
```

| Demo                              | Candidate tests | Oracle          | Verdict        |
| --------------------------------- | --------------- | --------------- | -------------- |
| Wrong boundary, standard policy   | Pass            | Fails at 100 TL | `REJECT`       |
| Correct boundary, standard policy | Pass            | Passes          | `ACCEPT`       |
| Correct boundary, critical policy | Pass            | Passes          | `INCONCLUSIVE` |

The demos use temporary Git repositories and write reports under `.oracle-gate/runs/`. Each demo script exits successfully when it observes the expected verdict. To read the wrong candidate's report:

```sh
npm start -- report --input .oracle-gate/runs/demo-wrong.json
```

## Verify a local task

1. Save the original request as UTF-8 and draft a YAML contract outside the candidate project. Include `spec`, `policy`, and optionally `execution`. The [demo bundle generator](tests/authority.ts) and [acceptance cases](tests/helpers.ts) show the current input format.
2. Start the task before editing. Keep the task ID and contract hash printed by the CLI.
3. Optionally review the draft. Record approval after the user confirms the exact contract hash.
4. Save the implementation and verify the approved task.

Replace the uppercase placeholders with paths and the values returned by `task start`. When using the installed package, skip the build and replace `npm start --` with `npx --no-install oracle-gate`.

```sh
npm run build
npm start -- task start --repo PROJECT --requirement REQUEST --contract CONTRACT
npm start -- task approve --repo PROJECT --task TASK --contract-sha256 HASH
npm start -- verify --repo PROJECT --task TASK --contract-sha256 HASH
```

The default candidate includes saved edits and new files. Reports under `.oracle/tasks/TASK/runs/` identify the final snapshot and list files added, modified, or deleted since the task began. In a shared workspace, that diff can include changes from other agents. `CHANGED` means the live workspace changed after capture. The verdict still applies to the recorded snapshot.

Use `task revise` when acceptance criteria or execution settings change, then obtain approval for the new hash. The default execution settings are `run.mjs`, `self.test.mjs`, and a 10-second timeout per process. `task start --exclude` accepts additional project-relative files and directories to omit from both snapshots. Git projects can add `.oracle/` to `.gitignore`.

Use the [agent workflow skill](.agent/skills/oracle-verification/SKILL.md) to guide an agent through this sequence.

### Use an external bundle or a Git commit

An external bundle lives outside the candidate directory and contains `requirement.md`, `spec.yaml`, `policy.yaml`, and `manifest.json`. Supply the expected manifest digest to pin the bundle for a local demonstration.

```sh
npm start -- verify --repo PROJECT --bundle BUNDLE --bundle-sha256 HASH --local-demo --report-json REPORT
```

Add `--candidate REF` to verify a Git commit. Run `npm start -- verify --help` for all options. See [Architecture](docs/architecture.md) for bundle identities and the policy's decision order.

### Connect a reviewer

The CLI supports OpenAI-compatible HTTP endpoints and local agent commands. Pass `--reviewer-config CONFIG` to `task review` for draft review and to `verify` for a separate review of the captured implementation. The first stage receives the original requirement. The second stage receives the draft contract or candidate artifacts. Keep the configuration outside the candidate directory. [Reviewer setup and examples](docs/reviewers.md)

### Exit codes

| Code | Meaning                |
| ---- | ---------------------- |
| `0`  | `ACCEPT`               |
| `1`  | Invalid input or usage |
| `2`  | `REJECT`               |
| `3`  | `INCONCLUSIVE`         |
| `4`  | `INFRASTRUCTURE_ERROR` |

## Scope and security

The current JSON Lines protocol uses `amountCents` inputs and `totalCents` outputs. Candidate entry points run in Node.js. Snapshot execution skips dependency installation.

Local execution is **UNPROTECTED**. Candidate code runs with the current OS user's filesystem and network access. A local `ACCEPT` applies to the selected snapshot and policy. Critical or release acceptance requires protected execution and authority. [Threat model](docs/threat-model.md) · [Known limitations](docs/known-limitations.md) · [Security reporting](SECURITY.md)

## Contributing

```sh
npm run lint
npm run typecheck
npm test
npm run test:package
```

The package check builds a real tarball, installs it into a clean consumer project, and exercises the CLI and public ESM exports. See the [contribution guide](CONTRIBUTING.md) for development checks and [benchmark methodology](docs/benchmark-methodology.md) for evaluation scope. Maintained by Onur Özkır.

Maintainers can dispatch [Publish npm package](.github/workflows/publish-package.yml) on `main` with the version from `package.json`. The workflow runs the test matrix and verifies a clean install after publishing.

## License

Licensed under the [MIT License](LICENSE).
