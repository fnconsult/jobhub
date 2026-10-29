import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditStylesheet } from "@jobhub/shared/design";
import { describe, expect, it } from "vitest";

// ADR-0053: a Back Office page is drawn with the Design System's components (Tabs, Table, Card, Stat, Pill, Status,
// Note, Button, Field, Checkbox, Drawer, Properties, FilterLinks), not with the old markup restyled by a parallel layer
// in app.css. The pilot pages of #465 (Paramètres, the Dashboard and Activité) were the model; #466 brought every other
// section, and each row's own page, onto them.
const here = fileURLToPath(new URL("./", import.meta.url));
const appCss = readFileSync(join(here, "../app.css"), "utf8");

/** Every component of the Back Office's pages, a row's own page (`[id]`) included. */
function sources(path: string): string[] {
  if (statSync(path).isFile()) return path.endsWith(".tsx") && !path.endsWith(".test.tsx") ? [path] : [];
  return readdirSync(path).flatMap((name) => sources(join(path, name)));
}

const PAGES = sources(here);

/** The old markup's classes, each with the Design System component that replaces it. */
const OLD_CLASSES: Record<string, string> = {
  "application-table": "Table",
  "table-scroll": "Table",
  "side-sheet": "Drawer",
  tablist: "TabLinks",
  kpis: "Stat",
  kpi: "Stat",
  pill: "Pill",
  button: "Button / buttonClass",
  "button-primary": "Button / buttonClass",
  "button-danger": "Button / buttonClass",
  input: "TextInput / Select / Textarea",
  field: "Field",
  hint: "Field's hint",
  notice: "Note",
  lead: "PageIntro",
  "quota-form": "Card",
  fieldset: "Card",
  "checkbox-field": "Checkbox / Radio",
  choice: "Checkbox / Radio",
  props: "Properties",
  prop: "Properties",
  draft: "the page's text block",
  "journal-filter": "FilterLinks",
};

/** The classes only the Back Office used: they leave app.css with the old markup (#466). */
const BACK_OFFICE_ONLY_CLASSES = [
  "quota-form",
  "plan-rank",
  "playbook-rules",
  "trigger-reasons",
  "unanswered-answer",
  "administrator-roles",
  "ai-message-text",
  "journal-filter",
  "journal-changes",
  "journal-technical",
  "provider-secret-actions",
  "provider-secret-replace",
];

/** The class names a file writes in `className="…"`, or in the strings of a `className={…}`. */
function classNames(source: string): string[] {
  const literal = [...source.matchAll(/className="([^"]*)"/g)].map((match) => match[1]!);
  const computed = [...source.matchAll(/className=\{([^}]*)\}/g)].flatMap((match) => [...match[1]!.matchAll(/["'`]([^"'`]*)["'`]/g)].map((inner) => inner[1]!));
  return [...literal, ...computed].flatMap((names) => names.split(/\s+/)).filter(Boolean);
}

/** The classes a stylesheet's selectors name. */
function definedClasses(css: string): Set<string> {
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{[^{}]*\}/g, "{}");
  return new Set([...selectors.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((match) => match[1]!));
}

describe("the Back Office's pages in the Design System (#465, #466, ADR-0053)", () => {
  it("are found, every section and each row's own page", () => {
    for (const page of ["parametres/ProviderSheet.tsx", "activite/appels-ia/page.tsx", "signalements/[id]/page.tsx", "offres/page.tsx", "playbooks/[id]/page.tsx", "outils/[id]/page.tsx", "administrateurs/page.tsx"]) {
      expect(PAGES.some((file) => file.endsWith(page))).toBe(true);
    }
  });

  it("are not restyled by a parallel layer in app.css", () => {
    expect(appCss).not.toContain(".in-design-system");
  });

  it("left the classes only they used out of app.css", () => {
    const defined = definedClasses(appCss);
    expect(BACK_OFFICE_ONLY_CLASSES.filter((name) => defined.has(name))).toEqual([]);
  });

  it.each(["parametres/parametres.css", "activite/activite.css", "dashboard.css", "section.css", "../../components/PageIntro.css"])(
    "keep their own layout beside them, on the ADR-0009 floor and the tokens: %s",
    (name) => {
      expect(auditStylesheet(readFileSync(join(here, name), "utf8"))).toEqual([]);
    },
  );

  it.each(PAGES.map((file) => [file.slice(here.length), file]))("%s draws no old markup a component replaces", (_, file) => {
    const used = classNames(readFileSync(file, "utf8")).filter((name) => name in OLD_CLASSES || BACK_OFFICE_ONLY_CLASSES.includes(name));
    expect(used.map((name) => `${name} → ${OLD_CLASSES[name] ?? "the page's own stylesheet"}`)).toEqual([]);
  });
});
