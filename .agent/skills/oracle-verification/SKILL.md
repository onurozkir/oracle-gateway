---
name: oracle-verification
description: Use when an agent needs to prepare, review, approve, or verify an Oracle Gateway task in a local project, or explain the outcome of an Oracle run.
---

# Oracle verification

Run these commands from the Oracle Gateway checkout with Node.js 24. Use `npm run build` if the CLI bundle is missing or its source has changed. When using an installed package, replace `npm start --` with `npx --no-install oracle-gate`. Set `PROJECT` to the candidate project directory. Saved files are the default candidate, including new files. Git is optional.

## Start and approve

1. Check that the installed protocol can express the acceptance criteria. The current `json-stdio-v1` contract compares `amountCents` inputs with `totalCents` outputs. Exact DOM text, arbitrary JSON types and list fields belong to the planned general protocol. If a criterion is unsupported, identify it as outside Oracle coverage and keep any separate test results distinct.
2. Before editing candidate files, save the user's original request verbatim as UTF-8 and draft the YAML with `spec`, `policy` and optional `execution`. Keep both inputs outside `PROJECT`. Run start and retain the returned task ID and baseline and contract hashes. Give a separate request its own task. If the work already started without a baseline, disclose which state a new baseline would capture and agree on how to proceed.

   ```sh
   npm start -- task start --repo PROJECT --requirement REQUEST --contract CONTRACT
   ```

3. If the user configured a reviewer, run the draft review with the exact hash. Keep the reviewer configuration outside `PROJECT`. It can point to an OpenAI-compatible HTTP endpoint or a local command.

   ```sh
   npm start -- task review --repo PROJECT --task TASK --contract-sha256 HASH --reviewer-config CONFIG
   ```

4. Present the concrete expected results, execution settings, hash and any reviewer findings or errors. Ask for explicit approval of that hash before implementing. Record approval only after the user approves. A draft review supplies feedback.

   ```sh
   npm start -- task approve --repo PROJECT --task TASK --contract-sha256 HASH
   ```

5. When the acceptance criteria, policy or execution settings change, run `npm start -- task revise --repo PROJECT --task TASK --contract CONTRACT`. The task keeps its baseline. Repeat draft review when configured and obtain approval for the new hash before relying on it.

## Verify and report

After saving the work, run verification with the approved task ID and hash. Use a unique `RUN_JSON` path outside the project to read the exact `runId`, even during concurrent runs. If the user configured a reviewer, add `--reviewer-config CONFIG` for the separate review of the captured code. Task verification takes execution settings from the approved contract.

```sh
npm start -- verify --repo PROJECT --task TASK --contract-sha256 HASH --report-json RUN_JSON
```

Report the Oracle verdict, failing cases with expected and observed results, snapshot hash, freshness and the path `.oracle/tasks/TASK/runs/RUN_ID.json` under the candidate project. Report command errors separately when no report was generated. A green project test suite is self-test evidence. An Oracle verdict comes from `verify`. With `CHANGED` or `UNKNOWN` freshness, report the result for the captured snapshot and verify again if the latest files need a verdict. Local `ACCEPT` applies to the configured local policy and carries `UNPROTECTED` assurance.

Use the [project README](../../../README.md) for contract inputs, CLI options and exit codes. Use [reviewer configuration](../../../docs/reviewers.md) when setting up a provider.
