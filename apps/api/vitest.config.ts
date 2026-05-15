import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
    }),
  ],
  test: {
    globals: true,
    globalSetup: './test/vitest.globalSetup.ts',
    include: ['src/**/*.spec.ts'],
    alias: {
      '@tas/db/client': resolve(__dirname, '../../packages/db/src/client.ts'),
      '@tas/db': resolve(__dirname, '../../packages/db/src/schema/index.ts'),
      '@tas/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
      '@tas/ari-client': resolve(__dirname, '../../packages/ari-client/src/index.ts'),
    },
  },
});
