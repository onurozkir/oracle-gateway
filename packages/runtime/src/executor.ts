import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Executor, ProcessRequest, ProcessResult } from '@oracle-gate/core';
import { windowsJobHost } from './windows-job.js';

export class LocalExecutor implements Executor {
  readonly assurance = 'local-unprotected' as const;
  async run(request: ProcessRequest): Promise<ProcessResult> {
    const timeout = request.timeoutMs ?? 10000;
    const limit = request.maxOutputBytes ?? 65536;
    if (
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 600000 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 16777216
    )
      throw new Error('Invalid process limits');
    const env: Record<string, string> = {};
    for (const key of [
      'PATH',
      'Path',
      'SystemRoot',
      'SYSTEMROOT',
      'WINDIR',
      'TEMP',
      'TMP',
      'TMPDIR',
    ]) {
      if (process.env[key]) env[key] = process.env[key];
    }
    Object.assign(
      env,
      {
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
      },
      request.env
    );
    let executable = request.executable;
    let args = request.args;
    if (process.platform === 'win32') {
      try {
        executable = await windowsJobHost(env);
        args = [request.executable, ...request.args];
      } catch {
        return { exitCode: null, stdout: '', stderr: '', error: 'SPAWN_ERROR' };
      }
    }
    return new Promise((resolve) => {
      let stdout = Buffer.alloc(0),
        stderr = Buffer.alloc(0);
      let error: ProcessResult['error'] = null;
      let settled = false;
      const child = spawn(executable, args, {
        cwd: request.cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(fallback);
        resolve({
          exitCode,
          stdout: stdout.toString('utf8'),
          stderr: stderr.toString('utf8'),
          error,
        });
      };
      let fallback: ReturnType<typeof setTimeout> | undefined;
      const terminate = () => {
        if (child.pid) {
          if (process.platform === 'win32') {
            const killer = spawn(
              join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
              ['/PID', String(child.pid), '/T', '/F'],
              { shell: false, windowsHide: true, stdio: 'ignore' }
            );
            killer.on('error', () => child.kill());
          } else {
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch {
              child.kill('SIGKILL');
            }
          }
        }
        // Do not hang forever when a descendant has inherited stdio.
        fallback ??= setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          finish(null);
        }, 2000);
      };
      const timer = setTimeout(() => {
        error ??= 'TIMEOUT';
        terminate();
      }, timeout);
      const collect = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
        const remaining = Math.max(0, limit - stdout.length - stderr.length);
        if (stream === 'stdout') stdout = Buffer.concat([stdout, chunk.subarray(0, remaining)]);
        else stderr = Buffer.concat([stderr, chunk.subarray(0, remaining)]);
        if (chunk.length > remaining && !error) {
          error = 'OUTPUT_LIMIT';
          terminate();
        }
      };
      child.stdout.on('data', (b: Buffer) => collect('stdout', b));
      child.stderr.on('data', (b: Buffer) => collect('stderr', b));
      child.stdin.on('error', () => {
        /* early exit is judged from exit status/protocol */
      });
      child.on('error', () => {
        error = 'SPAWN_ERROR';
        finish(null);
      });
      child.on('close', (code) => {
        if (process.platform === 'win32' && code === 0x5a170001) {
          error = 'SPAWN_ERROR';
          finish(null);
          return;
        }
        if (process.platform !== 'win32' && child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            /* group already empty */
          }
        }
        finish(code);
      });
      child.stdin.end(request.stdin ?? '');
    });
  }
}
