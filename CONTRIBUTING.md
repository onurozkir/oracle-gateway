# Contributing

Use Node.js 24 or later, npm, and Git.

Open a GitHub issue for a bug or feature proposal. For a bug, include your OS, Node.js version, the command you ran, and the expected and observed results. For a pull request, describe the behavior change and the checks you ran. See the [security policy](SECURITY.md) for sensitive reports.

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run demo:wrong
npm run demo:correct
npm run benchmark
npm run test:package
```

Write a regression test before behavior changes. Keep policy, process execution, trust and comparisons separate. Do not add candidate-controlled approval fields or use model confidence as authority. Commands must use explicit argv without a shell. Preserve cross-platform path behavior and finally cleanup. Reports must omit raw candidate output, credentials and private prompts.

Reviewer tests exercise local HTTP servers and command subprocesses. See the [reviewer guide](docs/reviewers.md) and [optional development simulation](postman/simulations/reviewer.context.md).
