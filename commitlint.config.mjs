/**
 * Commitlint configuration — Conventional Commits.
 *
 * @see https://www.conventionalcommits.org/
 * @type {import('@commitlint/types').UserConfig}
 */
const config = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'refactor',
        'test',
        'docs',
        'build',
        'ci',
        'chore',
        'perf',
        'revert',
      ],
    ],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'body-max-line-length': [0, 'always'],
  },
};

export default config;
