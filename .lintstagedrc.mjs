/**
 * lint-staged configuration.
 *
 * Runs fast, auto-fixing checks on staged files only. The full validation
 * suite (`pnpm validate`) — including typecheck, tests, and build — runs in CI
 * and on demand, not on every commit, to keep the hook fast and hard to bypass
 * accidentally.
 *
 * ESLint runs with `--max-warnings=0` so warnings block a commit exactly as
 * they block CI.
 *
 * @type {import('lint-staged').Configuration}
 */
const config = {
  '*.{js,jsx,mjs,cjs,ts,tsx}': [
    // --no-warn-ignored: staged *.d.ts match the glob but are ESLint-ignored
    // (eslint.config.mjs), and --max-warnings=0 would otherwise fail the hook.
    'eslint --fix --max-warnings=0 --no-warn-ignored',
    'prettier --write',
  ],
  '*.{json,md,mdx,css,yml,yaml}': ['prettier --write'],
};

export default config;
