import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['test/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.claude/**', '**/.next/**'],
    setupFiles: ['./test/setup/integration-setup.ts'],
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
