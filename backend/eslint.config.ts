import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import { configs as airbnb, plugins as airbnbPlugins } from 'eslint-config-airbnb-extended';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/**', 'node_modules/**']),

  js.configs.recommended,

  // Airbnb's configs reference these plugins but do not register them.
  airbnbPlugins.stylistic,
  airbnbPlugins.importX,
  airbnbPlugins.node,
  airbnbPlugins.typescriptEslint,

  // Airbnb style guide (flat-config port), then typescript-eslint's strict
  // presets last so the stricter type-aware rules win any overlap.
  airbnb.base.typescript,
  airbnb.node.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 25, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // Airbnb's stance, kept deliberately: awaiting inside a loop serialises
      // work that could run together. Read once, decide, then Promise.all the
      // writes. Reach for a sequential loop only when each step truly depends
      // on the previous one's result.
      'no-await-in-loop': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // NodeNext ESM requires .js specifiers that point at .ts sources; the rule
      // reads that as a mismatch. TypeScript already enforces the correct form.
      'import-x/extensions': 'off',
    },
  },

  {
    files: ['scripts/**/*.ts'],
    rules: {
      // One-off migrations are read at the terminal: a report on stdout is the
      // whole interface, and the numbers it prints are how you decide to apply.
      'no-console': 'off',
      // The stored documents predate the types they are being migrated towards,
      // so they are read as the untyped records they actually are.
      '@typescript-eslint/dot-notation': 'off',
    },
  },

  {
    files: ['src/server.ts'],
    rules: {
      // Process bootstrap: startup logging on stdout, and exiting from a signal
      // handler after close() is the intended shutdown path, not an error.
      'no-console': 'off',
      'n/no-process-exit': 'off',
    },
  },

  {
    files: ['src/services/console-notification.service.ts'],
    rules: {
      // Printing to stdout is this implementation's entire job — it stands in
      // for a real delivery channel.
      'no-console': 'off',
    },
  },

  {
    files: ['test/**/*.ts'],
    rules: {
      // node:test's describe/it return promises that the runner itself awaits.
      // Awaiting or voiding every one of them would be noise in every test file.
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },

  {
    files: ['eslint.config.ts'],
    rules: {
      // import.meta.dirname works from Node 20.11/21.2; the plugin only counts
      // it as supported from 22.16, which would fail this repo's engines range.
      'n/no-unsupported-features/node-builtins': 'off',
    },
  },
);
