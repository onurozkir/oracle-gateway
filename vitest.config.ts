import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000, hookTimeout: 30000 },
  resolve: {
    alias: {
      '@oracle-gate/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@oracle-gate/runtime': fileURLToPath(
        new URL('./packages/runtime/src/index.ts', import.meta.url)
      ),
      '@oracle-gate/adapters': fileURLToPath(
        new URL('./packages/adapters/src/index.ts', import.meta.url)
      ),
    },
  },
});
