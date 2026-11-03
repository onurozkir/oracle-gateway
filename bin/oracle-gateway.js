#!/usr/bin/env node

import { runCLI } from '../src/cli.js';

runCLI().catch((error) => {
  console.error('\x1b[31m[ERROR]\x1b[0m Fatal CLI Error:', error.message || error);
  process.exit(1);
});
