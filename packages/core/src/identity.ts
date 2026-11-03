import { createHash } from 'node:crypto';

/** Sorted own object keys, ordered arrays, JSON primitives. No lossy values. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++)
      if (!Object.hasOwn(value, i)) throw new TypeError('Sparse arrays are not canonical JSON');
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (key) => JSON.stringify(key) + ':' + canonicalize((value as Record<string, unknown>)[key])
        )
        .join(',') +
      '}'
    );
  }
  throw new TypeError('Canonical identity requires finite JSON values');
}
export function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function digest(value: unknown): string {
  return sha256(canonicalize(value));
}

/** Half-up rounding of the final total. All multiplication occurs in BigInt. */
export function calculateTotal(
  amountCents: number,
  threshold = 10000,
  discountBasisPoints = 1000
): number {
  for (const n of [amountCents, threshold, discountBasisPoints]) {
    if (!Number.isSafeInteger(n) || n < 0)
      throw new RangeError('Expected nonnegative safe integer');
  }
  if (discountBasisPoints > 10000) throw new RangeError('Discount exceeds 100%');
  return amountCents > threshold
    ? Number((BigInt(amountCents) * BigInt(10000 - discountBasisPoints) + 5000n) / 10000n)
    : amountCents;
}
