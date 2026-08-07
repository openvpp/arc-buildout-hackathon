import vitest from '@vitest/eslint-plugin';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import playwright from 'eslint-plugin-playwright';
import testingLibrary from 'eslint-plugin-testing-library';
import unusedImports from 'eslint-plugin-unused-imports';

/**
 * ESLint flat config.
 *
 * Layering strategy (deliberate, to avoid plugin double-registration):
 *  1. `eslint-config-next` (core-web-vitals + typescript) provides Next.js,
 *     React, React Hooks, jsx-a11y, and the base typescript-eslint setup, using
 *     its own bundled `@typescript-eslint` plugin + parser.
 *  2. A type-aware layer enables `projectService` on that already-registered
 *     parser and turns on type-checked rules BY NAME (no re-registration).
 *  3. Fresh, uniquely-namespaced plugins (`import-x`, `unused-imports`) add
 *     deterministic import ordering and unused-import removal.
 *  4. Architectural-boundary rules (env access, direct fetch, cross-feature
 *     imports) are scoped with `files` overrides.
 *  5. Test/e2e/config overrides relax or add rules where appropriate.
 *  6. `eslint-config-prettier` runs LAST so formatting stays Prettier's job.
 *
 * Note on "no unresolved imports": TypeScript (`pnpm typecheck`) is the
 * authoritative resolver here, so we do not run a second ESLint import resolver.
 */

const TYPE_AWARE_RULES = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-unsafe-assignment': 'error',
  '@typescript-eslint/no-unsafe-argument': 'error',
  '@typescript-eslint/no-unsafe-call': 'error',
  '@typescript-eslint/no-unsafe-member-access': 'error',
  '@typescript-eslint/no-unsafe-return': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/await-thenable': 'error',
  '@typescript-eslint/no-unnecessary-type-assertion': 'error',
  '@typescript-eslint/no-unnecessary-condition': 'error',
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/switch-exhaustiveness-check': 'error',
  '@typescript-eslint/consistent-type-imports': [
    'error',
    { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
  ],
  '@typescript-eslint/no-shadow': 'error',
  'no-shadow': 'off',
  // Unused vars are handled by unused-imports (below) + tsconfig noUnusedLocals.
  '@typescript-eslint/no-unused-vars': 'off',
};

const IMPORT_ORDER_RULES = {
  'unused-imports/no-unused-imports': 'error',
  'unused-imports/no-unused-vars': [
    'error',
    {
      vars: 'all',
      varsIgnorePattern: '^_',
      args: 'after-used',
      argsIgnorePattern: '^_',
    },
  ],
  'import-x/no-duplicates': 'error',
  'import-x/newline-after-import': 'error',
  'import-x/order': [
    'error',
    {
      groups: [
        'builtin',
        'external',
        'internal',
        ['parent', 'sibling', 'index'],
      ],
      pathGroups: [{ pattern: '@/**', group: 'internal', position: 'before' }],
      pathGroupsExcludedImportTypes: ['builtin'],
      'newlines-between': 'always',
      alphabetize: { order: 'asc', caseInsensitive: true },
    },
  ],
};

const PROCESS_ENV_RESTRICTION = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message:
    'Access environment variables through src/config/env.ts, not process.env directly.',
};

const FETCH_RESTRICTION = {
  selector: "CallExpression[callee.name='fetch']",
  message:
    'Do not call fetch directly here. Use the API client in src/lib/api instead.',
};

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'blob-report/**',
      'public/**',
      '**/*.d.ts',
      'pnpm-lock.yaml',
      '.claude/**',
    ],
  },

  // Next.js + React + jsx-a11y + base typescript-eslint (all bundled by
  // eslint-config-next; not re-registered here to avoid plugin collisions).
  ...nextCoreWebVitals,
  ...nextTypescript,

  // Fresh plugins registered once, under unique namespaces.
  {
    plugins: {
      'import-x': importX,
      'unused-imports': unusedImports,
    },
  },

  // Type-aware layer + import ordering, for all TS/TSX source.
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...TYPE_AWARE_RULES,
      ...IMPORT_ORDER_RULES,
      'default-case-last': 'error',
      'no-implicit-coercion': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },

  // Application source: logging + architectural boundaries.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'error',
      'no-restricted-syntax': ['error', PROCESS_ENV_RESTRICTION],
    },
  },

  // The public env module is the ONE frontend place allowed to read process.env.
  {
    files: ['src/config/env.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // Server env is the ONE backend place allowed to read process.env for secrets.
  {
    files: ['src/server/config/env.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // Backend domain/application must not import Next.js.
  {
    files: [
      'src/server/domain/**/*.{ts,tsx}',
      'src/server/application/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['next', 'next/*', 'react', 'react-dom', 'react/*'],
              message:
                'Domain and application layers cannot import Next.js or React.',
            },
            {
              group: ['@/features', '@/features/*', '@/features/*/*'],
              message: 'Server domain/application must not depend on features.',
            },
          ],
        },
      ],
    },
  },

  // Scripts and worker entrypoints may use console and process.env.
  {
    files: [
      'scripts/**/*.{ts,tsx}',
      'src/worker/**/*.{ts,tsx}',
      'src/agent/**/*.{ts,tsx}',
    ],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // Backend integration/unit tests under test/.
  {
    files: ['test/**/*.{ts,tsx}'],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-syntax': 'off',
      'no-console': 'off',
    },
  },

  // UI layers must not call fetch directly (that belongs in lib/api).
  {
    files: [
      'src/app/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/features/**/*.{ts,tsx}',
      'src/hooks/**/*.{ts,tsx}',
      'src/providers/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        PROCESS_ENV_RESTRICTION,
        FETCH_RESTRICTION,
      ],
    },
  },

  // Feature isolation: import features only through their public index.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*/*'],
              message:
                "Import from a feature's public entry (@/features/<name>), not its internal files.",
            },
          ],
        },
      ],
    },
  },

  // Shared layers must not depend on features (one-way dependency direction).
  {
    files: [
      'src/lib/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/config/**/*.{ts,tsx}',
      'src/hooks/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features', '@/features/*', '@/features/*/*'],
              message:
                'Shared modules (lib/components/config/hooks) must not depend on features.',
            },
          ],
        },
      ],
    },
  },

  // Unit / component tests.
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    plugins: { vitest, 'testing-library': testingLibrary },
    rules: {
      ...vitest.configs.recommended.rules,
      ...testingLibrary.configs['flat/react'].rules,
      // Test doubles legitimately use loose typing.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // Playwright E2E.
  {
    files: ['e2e/**/*.{ts,tsx}'],
    ...playwright.configs['flat/recommended'],
  },
  {
    files: ['e2e/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // Config & script files: allow console and process.env, no type-aware project.
  {
    files: [
      '*.{js,mjs,cjs,ts,mts,cts}',
      '.lintstagedrc.mjs',
      'eslint.config.mjs',
      'drizzle.config.ts',
      'vitest.config.ts',
      'playwright.config.ts',
      'next.config.ts',
    ],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
      'import-x/order': 'off',
    },
  },

  // Prettier compatibility LAST.
  prettier,
];

export default config;
