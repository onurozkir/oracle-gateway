import { readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import {
  SpecSchema,
  PolicySchema,
  Hash,
  digest,
  sha256,
  type OracleBundle,
} from '@oracle-gate/core';
export async function readBounded(path: string, limit = 1048576): Promise<string> {
  if ((await stat(path)).size > limit) throw new Error('Input file exceeds size limit');
  return readFile(path, 'utf8');
}
export function parseYaml(text: string): unknown {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length || doc.warnings.length) throw new Error('Invalid YAML document');
  return doc.toJS({ maxAliasCount: 0 });
}
export const ManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  specSha256: Hash,
  oracleSha256: Hash,
  policySha256: Hash,
  requirementSha256: Hash,
});
export async function loadBundle(directory: string): Promise<OracleBundle> {
  const source = await realpath(directory);
  const [specText, policyText, requirement, manifestText] = await Promise.all(
    ['spec.yaml', 'policy.yaml', 'requirement.md', 'manifest.json'].map(async (name) => {
      const path = join(source, name);
      if ((await realpath(path)) !== path) throw new Error('Bundle symlinks are unsupported');
      return readBounded(path);
    })
  );
  const spec = SpecSchema.parse(parseYaml(specText!));
  const policy = PolicySchema.parse(parseYaml(policyText!));
  const manifest = ManifestSchema.parse(JSON.parse(manifestText!));
  const expected = {
    schemaVersion: 1,
    specSha256: digest(spec),
    oracleSha256: digest(spec.cases),
    policySha256: digest(policy),
    requirementSha256: sha256(requirement!),
  };
  if (digest(manifest) !== digest(expected) || spec.source.sha256 !== expected.requirementSha256)
    throw new Error('Bundle digest mismatch: spec, oracle, requirement or policy changed');
  return {
    spec,
    policy,
    requirement: requirement!,
    ...manifest,
    bundleSha256: digest(manifest),
    source,
  };
}
