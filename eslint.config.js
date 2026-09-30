// ESLint flat config (ESLint 9 + typescript-eslint 8).
// Type-checked linting is intentionally left off for now to keep Stage 1 fast;
// later stages can switch to tseslint.configs.recommendedTypeChecked.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Ignore build output, deps, and coverage.
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.vite/**', '.smoke/**', '.research/**'],
  },
  // Base JS + TS recommended rules.
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
