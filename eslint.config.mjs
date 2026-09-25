import { FlatCompat } from '@eslint/eslintrc';
import prettierConfig from 'eslint-config-prettier';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  prettierConfig,
  {
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'coverage/**',
      'test-results/**',
      'drizzle/migrations/**',
      '.claude/**',
      'next-env.d.ts',
    ],
  },
];

export default eslintConfig;
