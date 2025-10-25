// Flat ESLint configuration for Prompt Guesser
// Works with ESLint v9+ and "type": "module"

import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import functional from "eslint-plugin-functional";
import boundaries from "eslint-plugin-boundaries";
import prettierConfig from "eslint-config-prettier";

export default [
  // --- Ignore patterns (replaces .eslintignore) ---
  {
    ignores: [
      "dist/",
      "node_modules/",
      "coverage/",
      "docs/",
      "*.config.*",
      "README.md"
    ],
  },

  // --- TypeScript / project defaults ---
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: "./tsconfig.json", sourceType: "module" },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      import: importPlugin,
      functional,
      boundaries,
    },
    settings: {
      "boundaries/elements": [
        { type: "domain", pattern: "src/domain/**" },
        { type: "adapter", pattern: "src/adapters/**" },
        { type: "test", pattern: "tests/**" },
      ],
    },
    rules: {
      // --- Base ESLint + TS recommended ---
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...tsPlugin.configs.strict.rules,

      // --- Functional style (relaxed for commands) ---
      "functional/no-class": "off",
      "functional/no-this-expression": "off",
      "functional/prefer-readonly-type": "warn",
      "functional/immutable-data": ["warn", { ignoreIdentifierPattern: ["^ctx", "^state"] }],

      // --- Imports & layering ---
      "import/order": [
        "error",
        {
          alphabetize: { order: "asc", caseInsensitive: true },
          groups: [["builtin", "external"], ["internal"], ["parent", "sibling", "index"]],
          "newlines-between": "always",
        },
      ],
      "import/no-cycle": ["error", { maxDepth: 2 }],
      "boundaries/element-types": [
        "error",
        {
          default: "allow",
          rules: [
            { from: "adapter", allow: ["adapter"] },
            { from: "domain", disallow: ["adapter"] },
            { from: "test", allow: ["domain", "adapter", "test"] },
          ],
        },
      ],

      // --- TypeScript safety ---
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/explicit-function-return-type": "warn",

      // --- Misc ---
      "no-console": "warn",
    },
  },

  // --- Test overrides ---
  {
    files: ["tests/**/*", "**/*.test.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: "./tsconfig.vitest.json", sourceType: "module" },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-console": "off",
      "functional/immutable-data": "off",
      "functional/prefer-readonly-type": "off",
    },
  },

  // --- Disable stylistic conflicts with Prettier ---
  prettierConfig,
];
