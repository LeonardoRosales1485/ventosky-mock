// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    // El contexto de operación —empresa, sucursal, caja— es de cada tab, y quien lo sirve es
    // `TabContextStore`. Leer `sessionStorage` por afuera se saltea el sellado del que depende ese
    // aislamiento, así que sólo él puede tocarlo.
    files: ['src/**/*.ts'],
    ignores: ['src/app/core/tab-context/**', 'src/**/*.spec.ts', 'src/test-setup.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'sessionStorage',
          message: 'El contexto del tab se lee y se escribe por `TabContextStore`.',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
]);
