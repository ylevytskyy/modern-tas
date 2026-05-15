import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/integration/**/*.spec.ts'],
    testTimeout: 30000,
    alias: {
      '@tas/db/client': resolve(__dirname, '../../packages/db/src/client.ts'),
      '@tas/db': resolve(__dirname, '../../packages/db/src/schema/index.ts'),
      '@tas/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
    },
  },
});
