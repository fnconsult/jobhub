import js from "@eslint/js";
import i18next from "eslint-plugin-i18next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/.next/**", "**/.output/**", "**/.wxt/**", "**/dist/**", "**/next-env.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // Claude Code workflow scripts: the Workflow runtime provides these globals.
    files: [".claude/workflows/**/*.js"],
    languageOptions: {
      globals: { args: "readonly", agent: "readonly", parallel: "readonly", pipeline: "readonly", phase: "readonly", log: "readonly" },
    },
  },
  {
    files: ["**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // No hard-coded user-facing strings: interface text comes from i18next catalogues.
    files: ["apps/*/src/**/*.tsx", "apps/extension/entrypoints/**/*.{ts,tsx}"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": ["error", { mode: "jsx-only" }],
    },
  },
);
