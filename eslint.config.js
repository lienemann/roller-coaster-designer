// SPDX-License-Identifier: GPL-3.0-only
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import prettier from 'eslint-config-prettier';

const corePackageBoundaryRule = {
  // Enforces CLAUDE.md rule 2 and docs/webfvd-spec.md §1.1:
  // packages/core must not import DOM, React, or Three.js.
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
          message: 'packages/core must not depend on React. Keep UI code in packages/app.',
        },
        {
          group: ['three', 'three/*'],
          message:
            'packages/core must not depend on Three.js. Use gl-matrix; rendering code lives in packages/app/src/scene.',
        },
        {
          group: ['@roller-coaster-designer/app', '@roller-coaster-designer/app/*'],
          message: 'packages/core must not depend on the app package.',
        },
      ],
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.vite/**',
      '**/node_modules/**',
      'reference/**',
      // CommonJS config shims don't need type-aware linting.
      '**/postcss.config.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importPlugin,
      'unused-imports': unusedImports,
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'import/no-default-export': 'error',
      'import/order': [
        'warn',
        {
          'newlines-between': 'always',
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'unused-imports/no-unused-imports': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: corePackageBoundaryRule,
  },
  {
    files: [
      '**/*.config.{ts,js,cjs,mjs}',
      '**/vite.config.*',
      '**/vitest.config.*',
      '**/tailwind.config.*',
      '**/postcss.config.*',
    ],
    rules: {
      'import/no-default-export': 'off',
    },
  },
  {
    files: ['**/*.{test,spec}.ts', '**/*.{test,spec}.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  prettier,
);
