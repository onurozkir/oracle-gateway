# Simulation context — reviewer provider HTTP subset

This is a development-only stand-in for the OpenAI-compatible non-streaming Chat Completions dependency. It is not shipped in the npm package, is not a runtime dependency and is not required by npm test.

## Source and assumptions

The local OpenAPI subset in ../contracts/reviewer-chat.openapi.yaml was checked against official OpenAI Chat Completions and structured-output documentation. Orbit discovery/integration independently confirmed the path, Bearer auth and choices/message response shape. No signed-in Postman account was available, so owner-workspace mock search was skipped. The local generated mock was refined to validate the request shape and return stage-specific schema-valid fixture responses.

This simulates transport behavior, not a live model's quality, model identity, tool permissions or independence. Fixture interpretation remains the discount example. A selected model name sim-401/403/429/500 injects those HTTP statuses; sim-timeout leaves the response open. Unknown paths return 501. One-port routing does not forward these tests to a real provider.

## Reproduction

1. npm run build
2. postman simulation run postman/simulations/reviewer.sim.yaml --port 47831 --no-history --output ndjson
3. node scripts/test-reviewer-simulation.mjs
4. Stop the simulation with Ctrl+C.

The provider base is http://127.0.0.1:47831/reviewer-chat/v1. The client appends /chat/completions. No production key or repository source is sent. Do not add verbose/body logging for real credentials.

## Observed verification — 2026-11-03

The actual built reviewer transport made two successful stage requests and received the configured 401,403,429,500 errors. Six request events in the simulation log confirmed the expected endpoint/status paths. A seventh request intentionally hung and the client returned TIMEOUT; it has no completed response event. The simulation was stopped and port 47831 was confirmed closed.

The first sandboxed launch failed while starting the Postman dataset daemon (Windows 0xc0000008). Running the same local simulation outside that sandbox succeeded. This is a host tooling constraint, not an API-provider observation. Normal Vitest tests independently exercise native HTTP servers and require no Postman daemon.

Live vendor compatibility, credentials, hosted mocks and model quality remain unverified. Nothing was pushed, deployed or published.
