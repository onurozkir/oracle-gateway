import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { verify, renderReport } from '@oracle-gate/runtime';
import { createFixture } from '../tests/fixture.js';
import { writeBundle } from '../tests/authority.js';
const kind = process.argv[2];
if (kind !== 'wrong' && kind !== 'correct') throw new Error('Usage: demo.ts wrong|correct');
const fixture = await createFixture();
try {
  const bundle = join(fixture.root, 'authority');
  const bundleSha256 = await writeBundle(bundle);
  const options = {
    repo: fixture.repo,
    candidate: fixture[kind],
    bundle,
    bundleSha256,
    localDemo: true,
  };
  const report = await verify(options);
  const output = resolve('.oracle-gate/runs');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, `demo-${kind}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(renderReport(report));
  const expected = kind === 'wrong' ? 'REJECT' : 'ACCEPT';
  if (report.decision.verdict !== expected)
    throw new Error(`Expected ${expected}; got ${report.decision.verdict}`);
  if (kind === 'correct') {
    const criticalBundle = join(fixture.root, 'critical-authority');
    const criticalPin = await writeBundle(criticalBundle, {
      schemaVersion: 1,
      profile: 'critical',
      requireReview: true,
      maxEvidenceAgeMs: 60000,
    });
    const critical = await verify({
      ...options,
      bundle: criticalBundle,
      bundleSha256: criticalPin,
    });
    await writeFile(
      join(output, 'demo-correct-critical.json'),
      JSON.stringify(critical, null, 2) + '\n'
    );
    console.log(
      '\nCritical release comparison (independent review and protection required):\n' +
        renderReport(critical)
    );
    if (critical.decision.verdict !== 'INCONCLUSIVE')
      throw new Error('Critical local execution cannot authorize release');
  }
  console.log(`\nReport: ${join(output, `demo-${kind}.json`)}\nDemo expectation verified.`);
} finally {
  await fixture.dispose();
}
