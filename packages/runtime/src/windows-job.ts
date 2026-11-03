import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
let host: Promise<string> | undefined;
/** Build once per gateway process with the Windows inbox .NET Framework compiler. */
export function windowsJobHost(env: Record<string, string>): Promise<string> {
  return (host ??= (async () => {
    const source = fileURLToPath(new URL('./windows-job-host.cs', import.meta.url));
    await readFile(source); // Missing installed helper fails closed before candidate execution.
    const directory = await mkdtemp(join(tmpdir(), 'oracle-gate-job-'));
    const output = join(directory, 'job-host.exe');
    try {
      const compiler = join(
        process.env['SystemRoot'] ?? 'C:\\Windows',
        'Microsoft.NET',
        'Framework64',
        'v4.0.30319',
        'csc.exe'
      );
      await promisify(execFile)(
        compiler,
        ['/nologo', '/optimize+', '/target:exe', '/out:' + output, source],
        { env, windowsHide: true, timeout: 15000, maxBuffer: 65536 }
      );
      process.once('exit', () => {
        try {
          rmSync(directory, { recursive: true, force: true });
        } catch {
          /* OS may retain a running executable until exit */
        }
      });
      return output;
    } catch {
      await rm(directory, { recursive: true, force: true });
      throw new Error('Windows job ownership unavailable');
    }
  })());
}
