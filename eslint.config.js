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
    // Component tests (#462) render their own sample text, as a Candidate would see it.
    ignores: ["apps/*/src/**/*.test.tsx", "apps/web/src/design/testing.tsx"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          // The plugin's own exclusions, plus the names help in pages is given (#343): `<HelpTerm term="matchScore">`,
          // `<EmptyStateHelp of="proposals">` name a glossary term or an empty state, never text the Candidate reads.
          // The Design System's props that pick a look or a role, never text (#462): `variant="quiet"`, `tone="danger"`.
          // Its form controls take a form field's own attributes, which name and wire it, never text (#465):
          // `<TextInput name="value" autoComplete="new-password" aria-describedby="…-help">`; an AddressDrawer's
          // `opener` is the selector of the link that opened it. A public page names itself to its site header (#470):
          // `<PublicSite current="legal">`.
          "jsx-attributes": {
            include: [],
            exclude: [
              "className",
              "styleName",
              "style",
              "type",
              "key",
              "id",
              "width",
              "height",
              "term",
              "of",
              "variant",
              "size",
              "tone",
              "side",
              "role",
              "name",
              "autoComplete",
              "inputMode",
              "pattern",
              "list",
              "aria-describedby",
              "opener",
              "current",
            ],
          },
        },
      ],
    },
  },
);
