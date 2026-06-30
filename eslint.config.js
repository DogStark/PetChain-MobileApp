// @ts-check
const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const importPlugin = require('eslint-plugin-import');
const prettierPlugin = require('eslint-plugin-prettier');
const securityPlugin = require('eslint-plugin-security');
let a11yPlugin;
try {
  a11yPlugin = require('eslint-plugin-react-native-a11y');
} catch {
  // Plugin does not yet declare ESLint 9 peer support; rules are skipped when absent.
  a11yPlugin = null;
}

module.exports = tseslint.config(
  // Security plugin — recommended ruleset
  {
    plugins: { security: securityPlugin },
    rules: {
      ...securityPlugin.configs.recommended.rules,
      // Disable rules that produce excessive noise in a TypeScript/React Native codebase
      // or overlap with TypeScript's own type safety guarantees:
      'security/detect-object-injection': 'off', // Too many false-positives with typed array/object access
      'security/detect-non-literal-regexp': 'off', // Flagged in tests; patterns are developer-controlled
      'security/detect-unsafe-regex': 'warn',
      'security/detect-no-csrf-before-method-override': 'off', // Not applicable (we use express csrf separately)
    },
  },
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'eslint.config.js',
      'babel.config.cjs',
      'jest.config.js',
      'jest.setup.js',
      '.detoxrc.js',
      'e2e/**',
      'backend/docs/**',
      'backend/scripts/**',
      'backend/tests/**',
      'scripts/**',
      '.storybook/**',
      'package/**',
      'expoWidgetPlugin.js',
      'ecosystem.config.js',
      'src/services/graphql/generated.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      import: importPlugin,
      prettier: prettierPlugin,
      ...(a11yPlugin ? { 'react-native-a11y': a11yPlugin } : {}),
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.node,
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Promise: 'readonly',
        Buffer: 'readonly',
        process: 'readonly',
        __DEV__: 'readonly',
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/display-name': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'import/no-duplicates': 'error',
      'import/no-cycle': 'off',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      ...(a11yPlugin
        ? {
            'react-native-a11y/has-accessibility-props': 'error',
            'react-native-a11y/has-valid-accessibility-role': 'error',
            'react-native-a11y/no-nested-touchables': 'error',
          }
        : {}),
    },
  },

  {
    files: ['backend/middleware/**/*.{ts,tsx}', 'backend/server/app.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  {
    files: ['backend/server.ts', 'backend/seeds/**', 'backend/config/database.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    files: ['backend/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      'no-useless-escape': 'off',
    },
  },

  {
    files: [
      '**/__tests__/**/*.{ts,tsx,js}',
      '**/*.test.{ts,tsx,js}',
      '**/__mocks__/**/*.{ts,tsx,js}',
    ],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      'import/order': 'off',
      'no-console': 'off',
    },
  },
);
