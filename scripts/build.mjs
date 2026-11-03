import { build } from 'esbuild';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({
  entryPoints: {
    cli: 'packages/cli/src/index.ts',
    index: 'packages/core/src/index.ts',
    reviewers: 'packages/adapters/src/index.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  packages: 'external',
  alias: {
    '@oracle-gate/core': './packages/core/src/index.ts',
    '@oracle-gate/runtime': './packages/runtime/src/index.ts',
    '@oracle-gate/adapters': './packages/adapters/src/index.ts',
  },
});
for (const directory of ['dist', 'packages/runtime/dist']) {
  await copyFile('packages/runtime/src/windows-job-host.cs', `${directory}/windows-job-host.cs`);
}
for (const name of await readdir('packages/adapters/dist')) {
  if (!name.endsWith('.d.ts')) continue;
  const path = 'packages/adapters/dist/' + name;
  await writeFile(
    path,
    (await readFile(path, 'utf8'))
      .replaceAll("'@oracle-gate/core'", "'../../core/dist/index.js'")
      .replaceAll('"@oracle-gate/core"', '"../../core/dist/index.js"')
  );
}
await writeFile('dist/reviewers.d.ts', "export * from '../packages/adapters/dist/index.js';\n");
