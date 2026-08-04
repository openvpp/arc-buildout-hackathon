import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
};

const sharedEnv = {
  NEXT_PUBLIC_APP_NAME: 'EV Telemetry Dashboard (Test)',
  NEXT_PUBLIC_APP_ENV: 'test',
  NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3000',
  NEXT_PUBLIC_ARC_EXPLORER_BASE_URL: 'https://explorer.test.example',
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5433/ev_telemetry_test',
  API_KEY_HASH_SECRET: 'test-api-key-hash-secret-32chars!!',
  APP_ENV: 'test',
  ALLOW_MOCK_ADAPTERS: 'true',
  PROVENANCE_DELIVERY_MODE: 'pending',
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          include: [
            'src/**/*.{test,spec}.{ts,tsx}',
            'test/unit/**/*.{test,spec}.ts',
          ],
          env: sharedEnv,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          globals: true,
          setupFiles: ['./test/setup/integration-setup.ts'],
          include: ['test/integration/**/*.{test,spec}.ts'],
          env: sharedEnv,
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/test/**',
        'src/types/**',
        'src/app/**',
        'src/styles/**',
        'src/server/infrastructure/db/schema/**',
        'src/worker/**',
      ],
      thresholds: {
        'src/lib/api/errors.ts': {
          statements: 85,
          branches: 75,
          functions: 90,
          lines: 85,
        },
        'src/lib/query/query-client.ts': {
          statements: 90,
          branches: 80,
          functions: 90,
          lines: 90,
        },
        'src/lib/utils/url.ts': {
          statements: 90,
          branches: 80,
          functions: 100,
          lines: 90,
        },
        'src/config/env.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/features/telemetry/schemas.ts': {
          statements: 80,
          branches: 70,
          functions: 70,
          lines: 80,
        },
        'src/features/verification/status.ts': {
          statements: 84,
          branches: 78,
          functions: 100,
          lines: 84,
        },
        'src/features/wallets/format.ts': {
          statements: 90,
          branches: 80,
          functions: 100,
          lines: 90,
        },
      },
    },
  },
});
