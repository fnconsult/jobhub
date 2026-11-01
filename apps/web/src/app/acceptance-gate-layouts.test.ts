import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openWhilePending } from "../acceptances/gate";

// ADR-0062, #510: while a CGU version waits for the Candidate's Acceptance, only a few pages stay open (gate.ts). The
// gate runs where the page is drawn (CandidateLayout), often in a layout shared by several pages. Next does not draw a
// shared layout again on a client-side navigation between the pages it holds: if one layout held an open page and a
// closed one, a click from the open one (Mes données) would draw the closed one (Préférences) with no gate. So no
// layout but the root's is shared by pages on both sides; Mon compte splits its Sections into two route groups.
const app = fileURLToPath(new URL("./", import.meta.url));

/** Every file under `path` named `name`. */
function named(path: string, name: string): string[] {
  if (statSync(path).isFile()) return path.endsWith(`${sep}${name}`) ? [path] : [];
  return readdirSync(path).flatMap((entry) => named(join(path, entry), name));
}

/** The address a page answers at: route groups left out, a dynamic segment filled in. */
function routeOf(page: string): string {
  const segments = relative(app, dirname(page))
    .split(sep)
    .filter((segment) => segment && !/^\(.*\)$/.test(segment))
    .map((segment) => (/^\[.*\]$/.test(segment) ? "x" : segment));
  return `/${segments.join("/")}`;
}

const PAGES = named(app, "page.tsx");
const LAYOUTS = named(app, "layout.tsx").filter((layout) => dirname(layout) !== app.replace(/\/$/, ""));

describe("no layout is shared by a page open before the CGU Acceptance and one that is not (ADR-0062)", () => {
  it("finds Mon compte's two groups", () => {
    const of = (group: string) => PAGES.filter((page) => page.includes(`${sep}compte${sep}${group}${sep}`)).map(routeOf);
    expect(of("(open-before-acceptance)")).toEqual(["/compte/donnees"]);
    expect(of("(sections)")).toContain("/compte/preferences");
  });

  it.each(LAYOUTS.map((layout) => [relative(app, layout), layout]))("%s", (_, layout) => {
    const below = PAGES.filter((page) => page.startsWith(dirname(layout) + sep)).map(routeOf);
    const open = below.filter(openWhilePending);
    expect(open.length === 0 || open.length === below.length, `open: ${open.join(", ")}; closed: ${below.filter((route) => !openWhilePending(route)).join(", ")}`).toBe(true);
  });
});
