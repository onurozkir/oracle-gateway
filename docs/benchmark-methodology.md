# Benchmark methodology and scope

Run `npm run benchmark`. It emits `.oracle-gate/runs/benchmark.json` with every input, expected and incorrect output, result, corrected control, latency, escalation count and a `modelComparison: NOT_RUN` marker.

The deterministic 42-case seed corpus covers seven categories, six cases each: boundaries, rounding, role access, tenant isolation, exclusions, null/default behavior and contradictory specs. The first 36 intentionally wrong outputs have matching corrected controls. Six contradictory cases escalate without choosing an interpretation. This is an in-process comparator smoke benchmark, deliberately separate from the real Git discount E2E tests. These seeded functions do not exercise the full executor or measure adversarial robustness.

Expected smoke outcome: 36 rejections, six inconclusive cases, zero accepted wrong outputs, 36 corrected controls accepted. This result follows from the deliberately constructed corpus; it is not evidence of a population-level detection rate or superiority over model review. LLM token cost is null, not zero measured expenditure.

The planned comparison of self-review, fresh same-model, cross-model and approved-oracle gate remains NOT_RUN. A future experiment must pre-register requirements and independent approval, isolate reviewer contexts, fix model/provider/prompt versions, include known-good controls, randomize cases, publish raw sanitized receipts, and separately count false negatives, false positives, inconclusive cases, human escalations, cost and latency. Human resolution is required for contradictory requirements. No blog or paper claims precede that experiment.
