import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/vitest.setup.ts'],
    include: ['{app,components,lib,test}/**/*.spec.{ts,tsx}'],
    alias: {
      '@tas/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
      '@/': resolve(__dirname, './') + '/',
    },
  },
});
