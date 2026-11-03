# Reviewer providers

Both transports implement the same `ReviewerProvider` contract and are usable through `verify --reviewer-config` or the `oracle-gateway/reviewers` npm export. Configuration does not select a vendor or model automatically. No external verification tool or provider SDK is installed.

## OpenAI-compatible HTTP

```json
{
  "type": "openai-compatible",
  "baseUrl": "https://your-provider.example/v1",
  "model": "your-model-id",
  "apiKeyEnv": "ORACLE_REVIEWER_API_KEY",
  "responseFormat": "json",
  "timeoutMs": 30000
}
```

The configured base URL includes the provider's version prefix; the transport appends `/chat/completions`. It sends two separate stateless POST requests with `model`, `stream: false`, a system message and a user JSON envelope. JSON mode adds `response_format: {type: "json_object"}`. Use `responseFormat: "text"` to omit that field for providers that do not support it; valid structured JSON is still required in the response.

This subset follows the official [Chat Completions contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and [structured output guidance](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat). Compatibility means this subset, not every endpoint, provider option or authentication variant. A complete response must have `choices[0].finish_reason: "stop"` and a string `message.content` containing the schema-valid JSON object. Refusal, tool calls, truncation and malformed JSON are not success.

The API key is read from the named process environment variable, used only as a Bearer header and never sent to candidate processes or included in prompts. No `.env` file is automatically loaded. Omit `apiKeyEnv` for a keyless local server. HTTPS is required except for `localhost`, `127.0.0.1` and `::1`. URL credentials/query strings are rejected, redirects are not followed, and there are no automatic retries or silent format downgrades. Every stage has its own complete request/body timeout and byte limits.

## Local agent or command

```json
{
  "type": "command",
  "executable": "your-agent-command",
  "args": [],
  "model": "configured-model-label",
  "inputFormat": "prompt",
  "responsePath": [],
  "passEnv": ["AGENT_API_KEY"],
  "timeoutMs": 60000
}
```

The command runs without a shell in a new empty temporary working directory for each stage. `executable` must be absolute or available on PATH; use absolute paths for script arguments. Supply the actual agent's documented noninteractive/fresh-session/read-only flags through `args`. No vendor-specific flags or conversation-resume behavior are guessed.

`inputFormat: "json"` sends one JSON envelope to stdin:

```json
{
  "schemaVersion": 1,
  "stage": "interpretation",
  "instruction": "...trusted reviewer instruction...",
  "input": {"requirementId": "DISCOUNT-001", "requirement": "...", "definitions": []},
  "responseSchema": {"...": "JSON Schema for this stage"}
}
```

`inputFormat: "prompt"` sends the instruction plus the envelope as a prompt, suitable for agents that accept prompts on stdin. Stdout must contain a single JSON value. Progress/debug logs belong on stderr. If the CLI emits a wrapper such as `{"result":"{...model JSON...}"}`, set `responsePath: ["result"]`; nested paths are also supported. Unstructured text, Markdown code fences and multiple JSON values are rejected. A thin user-controlled wrapper can bridge another native format without changing the gateway.

Only a small OS environment allowlist is inherited. Add required credential/config variable **names** to `passEnv`; never put keys in arguments or configuration values. For an agent using stored login state, explicitly allow its required home/config variables. Credentials selected here are available to the reviewer command, which must therefore be trusted. Do not launch candidate-authored code as that privileged command. The candidate executor never receives this reviewer allowlist.

## Run verification

Place the reviewer configuration outside the candidate repository, edit the example's endpoint/model or command, then run:

```sh
node bin/oracle-gate.js verify --repo /candidate --candidate HEAD --bundle /separate-bundle --bundle-sha256 EXPECTED_HASH --local-demo --reviewer-config /separate-config/reviewer.json --report-json /reports/latest.json
```

PowerShell API-key setup uses `$env:ORACLE_REVIEWER_API_KEY = 'your-key'` in the caller's shell. Do not commit the value. The command above retains the existing commit-based candidate selection; workspace-default snapshots and a general oracle protocol are separate pending changes.

Programmatic access:

```js
import { createReviewerProvider } from 'oracle-gateway/reviewers';
const reviewer = createReviewerProvider({
  type: 'openai-compatible',
  baseUrl: 'https://your-provider.example/v1',
  model: 'your-model-id',
  apiKeyEnv: 'ORACLE_REVIEWER_API_KEY'
});
```

## Evidence and policy

Stage 1 sees only the authoritative requirement and definitions. Its schema-valid interpretation is persisted before candidate artifacts are read. Stage 2 receives that fixed interpretation and bounded text artifacts from the exact candidate. API calls and command processes are fresh per stage. The current interpretation schema still describes the discount fixture; arbitrary business-domain interpretation is part of the separately planned protocol generalization.

The reader includes up to 100 supported tracked text files, maximum 512 KiB total. It excludes generated/dependency directories, common lockfiles and secret-like filenames. Content in normal source files may still contain private data; configure a trusted endpoint/command accordingly. The report lists every included artifact and hash. Excess context fails explicitly; it is never silently truncated.

Reports contain the configured provider/model identifier, template IDs, real transport prompt/schema digests, input/response/receipt digests, interpretation/proposed cases, file manifest, findings, uncertainty and safe failure codes. Custom providers without a prompt fingerprint report a template ID instead of inventing a prompt-content hash. Raw prompts, candidate stdout/stderr and provider error bodies are not included. Configured credential values echoed in structured responses are redacted.

Proposed cases are suggestions and are never approved or added to the trusted bundle automatically. Semantic conflicts and uncertainty block completion, including if Stage 2 subsequently fails. Full findings are retained while bounded hash references identify disagreements. Oracle FAIL cannot be overridden by a positive model review.

Both transports currently run in a cooperative local environment. They do not establish OS-enforced reviewer independence. REVIEW is therefore UNKNOWN with `INDEPENDENCE_UNVERIFIED` even when the structured review completed. `requireReview: true` remains INCONCLUSIVE until independent evidence can actually be established; optional review is useful for findings and does not manufacture production approval. HTTP/command failure is reported separately and never fabricated as PASS.

## Tests and compatibility limits

`npm test` exercises real local HTTP servers and actual command subprocesses: success, authentication/rate-limit/server errors, redirects, missing keys, timeouts, byte limits, malformed/unfinished responses, CLI envelopes, literal argv, environment isolation and two-stage provenance. `npm run test:package` installs the real tarball into an empty consumer, checks the reviewer export/declarations and executes the installed CLI with a real command fixture.

An optional development-only Postman simulation is under `postman/`. It is not needed by the package or ordinary tests:

```sh
postman simulation run postman/simulations/reviewer.sim.yaml --port 47831 --no-history --output ndjson
node scripts/test-reviewer-simulation.mjs
```

These tests establish behavior against the documented subset and local fixtures. No paid live-model request, native vendor CLI preset, model-quality comparison or production isolation is claimed.
