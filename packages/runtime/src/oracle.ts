import { z } from 'zod';
import { Cents } from '@oracle-gate/core';
const ResponseSchema = z.strictObject({ totalCents: Cents });
export function compareJsonLine(
  stdout: string,
  expected: number
): { actual: number | null; status: 'PASS' | 'FAIL' | 'ERROR' } {
  const lines = stdout.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== 1 || !lines[0]) return { actual: null, status: 'ERROR' };
  try {
    const { totalCents } = ResponseSchema.parse(JSON.parse(lines[0]));
    return { actual: totalCents, status: totalCents === expected ? 'PASS' : 'FAIL' };
  } catch {
    return { actual: null, status: 'ERROR' };
  }
}
