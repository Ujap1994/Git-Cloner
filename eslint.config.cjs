const js = require('@eslint/js');
const globals = require('globals');
module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
  { files: ['app/renderer/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['tests/e2e/*.cjs'], languageOptions: { globals: globals.browser } },
  { rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] } }
];
