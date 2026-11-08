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
    // Email intake's MTA (#580): Haraka loads its plugins with require(), so they are CommonJS.
    files: ["apps/mta/**/*.js"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // The app's Maestro scripts (#705): Maestro's own JavaScript, its `http`, `json` and `output`, and the run's env.
    files: ["apps/mobile/maestro/scripts/**/*.js"],
    languageOptions: { globals: { http: "readonly", json: "readonly", output: "writable", STACK_URL: "readonly", STACK_EMAIL: "readonly" } },
  },
  {
    // The native app's Metro, Babel and Jest configurations (#683) and its config plugins (#700): CommonJS, as those
    // tools load them.
    files: ["apps/mobile/*.js", "apps/mobile/plugins/**/*.js"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
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
          // The Design System's props that pick a look or a role, never text (#462): `variant="quiet"`, `tone="danger"`,
          // `<SectionsLayout look="tabs">` (#468); the app's text in a weight of Inter, `<AppText weight="semiBold">` (#683).
          // Its form controls take a form field's own attributes, which name and wire it, never text (#465):
          // `<TextInput name="value" autoComplete="new-password" aria-describedby="…-help">`; an AddressDrawer's
          // `opener` is the selector of the link that opened it. A public page names itself to its site header (#470):
          // `<PublicSite current="legal">`. A document's language is a code, never text (#473): `<ThemedHtml lang="fr">`.
          // The app's `testID`, what its Maestro flows find a field by (#705), never read by anyone.
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
              "look",
              "size",
              "tone",
              "weight",
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
              "lang",
              "testID",
            ],
          },
        },
      ],
    },
  },
);
