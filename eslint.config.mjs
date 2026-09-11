// Flat config (ESLint 9). Phase 1 of docs/engineering-plan.md.
//
// Goal for this pass: a ZERO-ERROR baseline that only flags unambiguous bugs
// (duplicate object keys — matters for the i18n dicts —, `const` reassignment,
// unreachable code, `typeof` typos, self-assignment, …). Style and
// cross-file-global checking are deliberately deferred:
//   - `no-undef` is OFF: js/*.js are global-scope scripts that share names
//     across files; enabling it now is pure noise. checkJs (jsconfig.json)
//     covers real undefined-name mistakes better. Re-enable in phase 5, after
//     the ES-module conversion in phase 3.
//   - `no-unused-vars` is a WARN, not an error.

import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            '**/node_modules/**',
            'js/i18n/zh-Hans.js', // generated at build time
            'mp-bot/**', // standalone sub-project, own tooling
            'catch-tracker/**', // standalone sub-project, own tooling
        ],
    },

    js.configs.recommended,

    // Shared rule tweaks for the whole repo.
    {
        rules: {
            'no-undef': 'off',
            // Most `no-unused-vars` hits in js/**/*.js are top-level functions
            // that ARE called — from inline on*="" handlers in index.html,
            // which ESLint can't see. Left as a WARN, not an error. Phase 5
            // (after handlers move to addEventListener) clears the bulk of them.
            'no-unused-vars': [
                'warn',
                { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' },
            ],
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-cond-assign': ['error', 'except-parens'],
            'no-constant-condition': ['error', { checkLoops: false }],
            'no-prototype-builtins': 'off',
            'no-control-regex': 'off',
            // The codebase intentionally uses NBSP inside template strings to
            // keep a number and its trailing icon (e.g. "4.53 ⭐")
            // from wrapping apart. Strings are already skipped by default.
            'no-irregular-whitespace': [
                'error',
                { skipStrings: true, skipTemplates: true, skipComments: true, skipRegExps: true },
            ],
        },
    },

    // Front-end browser scripts (global scope, not modules).
    {
        files: ['js/**/*.js', 'sw.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                ...globals.serviceworker,
                __LANG: 'readonly',
            },
        },
    },

    // Locale dictionaries assign onto the shared `I18N` global.
    {
        files: ['js/i18n/**/*.js'],
        languageOptions: {
            globals: { I18N: 'writable' },
        },
    },

    // Netlify Functions — Node, CommonJS.
    {
        files: ['netlify/functions/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
    },

    // Build / tooling scripts and this config — Node, ESM.
    {
        files: ['scripts/**/*.mjs', '**/*.mjs', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.node },
        },
    },
];
