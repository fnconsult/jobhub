import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditStylesheet } from "@jobhub/shared/design";
import { describe, expect, it } from "vitest";

// ADR-0053: a Back Office page migrated to the Design System is drawn with its components (Tabs, Table, Card, Stat,
// Pill, Status, Note, Button, Field, Drawer), not with the old markup restyled by a parallel layer in app.css. The pilot
// pages of #465 (Paramètres, the Dashboard and Activité) are the model #466 follows for the other sections.
const here = fileURLToPath(new URL("./", import.meta.url));
const appCss = readFileSync(join(here, "../app.css"), "utf8");

/** The page's components; a row's own page (`[id]`) is not part of the pilot. */
function sources(path: string): string[] {
  if (statSync(path).isFile()) return path.endsWith(".tsx") && !path.endsWith(".test.tsx") ? [path] : [];
  return readdirSync(path)
    .filter((name) => name !== "[id]")
    .flatMap((name) => sources(join(path, name)));
}

const PILOT = [join(here, "parametres"), join(here, "activite"), join(here, "JobDiscoveryBlock.tsx"), join(here, "page.tsx")].flatMap(sources);

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
  input: "TextInput / Select",
  notice: "Note",
};

/** The class names a file writes in `className="…"`, or in the strings of a `className={…}`. */
function classNames(source: string): string[] {
  const literal = [...source.matchAll(/className="([^"]*)"/g)].map((match) => match[1]!);
  const computed = [...source.matchAll(/className=\{([^}]*)\}/g)].flatMap((match) => [...match[1]!.matchAll(/["'`]([^"'`]*)["'`]/g)].map((inner) => inner[1]!));
  return [...literal, ...computed].flatMap((names) => names.split(/\s+/)).filter(Boolean);
}

describe("the pilot pages of the Back Office's Design System (#465, ADR-0053)", () => {
  it("are found", () => {
    expect(PILOT.some((file) => file.endsWith("ProviderSheet.tsx"))).toBe(true);
    expect(PILOT.some((file) => file.endsWith("appels-ia/page.tsx"))).toBe(true);
  });

  it("are not restyled by a parallel layer in app.css", () => {
    expect(appCss).not.toContain(".in-design-system");
  });

  it.each(["parametres/parametres.css", "activite/activite.css", "dashboard.css", "../../components/PageIntro.css"])(
    "keep their own layout beside them, on the ADR-0009 floor and the tokens: %s",
    (name) => {
      expect(auditStylesheet(readFileSync(join(here, name), "utf8"))).toEqual([]);
    },
  );

  it.each(PILOT.map((file) => [file.slice(here.length), file]))("%s draws no old markup a component replaces", (_, file) => {
    const used = classNames(readFileSync(file, "utf8")).filter((name) => name in OLD_CLASSES);
    expect(used.map((name) => `${name} → ${OLD_CLASSES[name]}`)).toEqual([]);
  });
});
