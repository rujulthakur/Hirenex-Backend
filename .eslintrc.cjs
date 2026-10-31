/* ESLint: strict TypeScript, no "any". syntheticLabels (audit-only) is import-blocked outside the bias panel, seeder and tests. */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  env: { node: true, es2022: true },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'error',
  },
  overrides: [
    {
      files: ['src/**/*.ts'],
      excludedFiles: ['src/services/biasPanel.service.ts', 'src/seed/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/auditOnly/*', '**/syntheticLabel*'],
                message:
                  'syntheticLabels is AUDIT-ONLY. It must never be imported by scoring, ranking, shortlist or scheduling code.',
              },
            ],
          },
        ],
      },
    },
  ],
  ignorePatterns: ['dist', 'node_modules'],
};
