import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import reactPerf from "eslint-plugin-react-perf";
import jsxA11y from "eslint-plugin-jsx-a11y";
import sonarjs from "eslint-plugin-sonarjs";
import prettier from "eslint-config-prettier";
import globals from "globals";

import localRules from "./eslint-rules/index.js";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/*.min.js",
      "**/.turbo/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    plugins: {
      local: localRules,
    },
    rules: {
      "local/no-js-file-extension": "error",
      "local/no-non-vitest-testing": "error",
      "local/no-raw-undefined-union": "warn",

      complexity: ["error", 10],
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": [
        "error",
        { max: 75, skipBlankLines: true, skipComments: true },
      ],
      "max-depth": ["warn", 4],

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "warn",
    },
  },

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: { ...globals.browser, ...globals.node },
    },
  },

  {
    files: ["packages/web/src/**/*.{ts,tsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "react-perf": reactPerf,
      "jsx-a11y": jsxA11y,
      sonarjs,
      local: localRules,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "react-perf/jsx-no-new-object-as-prop": "warn",
      "react-perf/jsx-no-new-array-as-prop": "warn",
      "sonarjs/no-duplicate-string": ["warn", { threshold: 5 }],

      "local/no-inline-styles": "error",
      "local/max-jsx-props": "warn",
      "local/no-direct-fetch": "error",
    },
  },

  {
    // Auth module hits Cognito's /oauth2/token directly (not /api/*), so the
    // no-direct-fetch rule is lifted here. Everything else must still go
    // through data/api.ts.
    files: [
      "packages/web/src/data/api.ts",
      "packages/web/src/auth/**/*.ts",
      "packages/web/src/auth/**/*.tsx",
      "**/*.test.{ts,tsx}",
      "**/test/**/*",
    ],
    rules: { "local/no-direct-fetch": "off" },
  },

  prettier,
];
