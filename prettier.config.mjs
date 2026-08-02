/**
 * Prettier configuration.
 *
 * Deliberately small. Formatting is Prettier's responsibility; code-quality
 * rules live in ESLint. The two concerns never overlap (see `eslint.config.mjs`,
 * which extends `eslint-config-prettier` to disable stylistic ESLint rules).
 *
 * @see https://prettier.io/docs/options
 * @type {import('prettier').Config}
 */
const config = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  endOfLine: 'lf',
  plugins: ['prettier-plugin-tailwindcss'],
};

export default config;
