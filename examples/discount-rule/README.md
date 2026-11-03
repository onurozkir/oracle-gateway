# Independent discount oracle

```sh
npm ci
npm run demo:wrong
npm run demo:correct
```

The fixture generator builds real baseline, wrong and correct Git commits. Wrong uses `>= 10000` and matching green tests; correct uses `> 10000`. No developer checkout is reverted. A separately pinned bundle contains the authoritative requirement and acceptance cases. Self-tests and every oracle case run in separate fresh clones.

Wrong outcome: self-tests PASS, oracle FAIL at `10000` (expected `10000`, actual `9000`), final REJECT. Correct outcome: self-tests PASS, oracle PASS, local standard ACCEPT. A separate critical comparison stays INCONCLUSIVE because independent review and protected authority are unavailable.

No external verifier is installed or called. `scripts/demo.ts` saves reports under `.oracle-gate/runs/` and removes all temporary repositories in `finally`. It exits zero when the expected verdict is observed; the actual verify CLI uses exits 0/1/2/3/4. The real installed npm tarball is checked by `npm run test:package`.
