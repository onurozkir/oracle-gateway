import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { digest, sha256, type Policy } from '@oracle-gate/core';
import { validSpec } from './helpers.js';
export async function writeBundle(directory: string, policy?: Policy): Promise<string> {
  const requirement = '100 TL üzerindeki siparişlere %10 indirim uygulanacak.\n';
  const spec = { ...validSpec, source: { uri: 'requirement.md', sha256: sha256(requirement) } };
  const releasePolicy = policy ?? {
    schemaVersion: 1,
    profile: 'standard',
    requireReview: false,
    maxEvidenceAgeMs: 60000,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'requirement.md'), requirement);
  await writeFile(join(directory, 'spec.yaml'), stringify(spec));
  await writeFile(join(directory, 'policy.yaml'), stringify(releasePolicy));
  const manifest = {
    schemaVersion: 1,
    specSha256: digest(spec),
    oracleSha256: digest(spec.cases),
    policySha256: digest(releasePolicy),
    requirementSha256: sha256(requirement),
  };
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  return digest(manifest);
}
