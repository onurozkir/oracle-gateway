import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(__dirname, '../bin/oracle-gateway.js');

test('CLI shows version when called with -v', async () => {
  const { stdout } = await execFileAsync(process.execPath, [binPath, '-v']);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('CLI shows help when called with --help', async () => {
  const { stdout } = await execFileAsync(process.execPath, [binPath, '--help']);
  assert.match(stdout, /Usage: oracle-gateway/);
  assert.match(stdout, /status/);
  assert.match(stdout, /config/);
});

test('CLI status command executes successfully', async () => {
  const { stdout } = await execFileAsync(process.execPath, [binPath, 'status']);
  assert.match(stdout, /CLI operational and ready/);
});
