import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditStylesheet } from "@jobhub/shared/design";
import { describe, expect, it } from "vitest";

// ADR-0053, #467: the Candidate's pages Recherches d'offres and Candidatures, an Application's page with its Sections,
// and the quick actions on the home page, drawn in the Confort Density with the Design System's components (Card, Ring,
// Pill, Note, EmptyState, Table, Field, Button), not with the old markup restyled.
const app = fileURLToPath(new URL("./", import.meta.url));
const components = join(app, "../components");

const PAGES = [
  join(app, "page.tsx"),
  join(app, "recherches/page.tsx"),
  join(app, "candidatures/page.tsx"),
  join(app, "candidatures/[id]/layout.tsx"),
  join(app, "candidatures/[id]/sections.tsx"),
  join(components, "JobOfferResults.tsx"),
  join(components, "JobSearchControls.tsx"),
  join(components, "ActionCardList.tsx"),
  join(components, "TailoredDocuments.tsx"),
  join(components, "QuickActions.tsx"),
];

/** The old markup's classes, each with the Design System component that replaces it. */
const OLD_CLASSES: Record<string, string> = {
  "application-table": "Table",
  "table-scroll": "Table",
  tablist: "Tabs / SectionsLayout's tabs",
  rows: "JobOfferResults' cards",
  row: "JobOfferResults' cards",
  meter: "Ring",
  pill: "Pill",
  button: "Button / buttonClass",
  "button-primary": "Button / buttonClass",
  "button-quiet": "Button / buttonClass",
  input: "TextInput / Select",
  notice: "Note / EmptyState",
};

/** The class names a file writes in `className="…"`, or in the strings of a `className={…}`. */
function classNames(source: string): string[] {
  const literal = [...source.matchAll(/className="([^"]*)"/g)].map((match) => match[1]!);
  const computed = [...source.matchAll(/className=\{([^}]*)\}/g)].flatMap((match) => [...match[1]!.matchAll(/["'`]([^"'`]*)["'`]/g)].map((inner) => inner[1]!));
  return [...literal, ...computed].flatMap((names) => names.split(/\s+/)).filter(Boolean);
}

describe("the Candidate's pages in the Design System (#467, ADR-0053)", () => {
  it.each(PAGES.map((file) => [file.slice(join(app, "..").length + 1), file]))("%s draws no old markup a component replaces", (_, file) => {
    const used = classNames(readFileSync(file, "utf8")).filter((name) => name in OLD_CLASSES);
    expect(used.map((name) => `${name} → ${OLD_CLASSES[name]}`)).toEqual([]);
  });

  it.each([
    join(app, "recherches/recherches.css"),
    join(app, "candidatures/candidatures.css"),
    join(components, "JobOfferResults.css"),
    join(components, "QuickActions.css"),
    join(components, "SectionsTabs.css"),
  ].map((file) => [file.slice(join(app, "..").length + 1), file]))("%s keeps its page's layout beside it, on the ADR-0009 floor and the tokens", (_, file) => {
    expect(auditStylesheet(readFileSync(file, "utf8"))).toEqual([]);
  });
});
