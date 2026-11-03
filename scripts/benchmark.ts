import { mkdir, writeFile } from 'node:fs/promises';
import { runSeededBenchmark } from './benchmark-cases.js';
const result = runSeededBenchmark();
await mkdir('.oracle-gate/runs', { recursive: true });
await writeFile('.oracle-gate/runs/benchmark.json', JSON.stringify(result, null, 2) + '\n');
console.log(
  `${result.count} synthetic seeds: ${result.detected} rejected, ${result.inconclusive} inconclusive, ${result.falseAccepts} false accepts; ${result.positiveControlsPassed} corrected controls pass. Model comparison NOT_RUN.`
);
