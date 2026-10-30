import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A route's own stylesheet (agenda.css, abonnement.css, account.css, the Back Office's) reaches the browser only on
// the pages that import it. A class it alone defines, written by a page outside its route, is unstyled on a direct
// load of that page and picks up the route's look after a client-side visit to it (#469: Espace coach drew the
// Agenda's `.agenda-items` once they left app.css).
const app = fileURLToPath(new URL("./", import.meta.url));
const src = join(app, "..");

/** Every file under `path` whose name passes `keep`. */
function files(path: string, keep: (file: string) => boolean): string[] {
  if (statSync(path).isFile()) return keep(path) ? [path] : [];
  return readdirSync(path).flatMap((name) => (name === "node_modules" ? [] : files(join(path, name), keep)));
}

/** The class names a stylesheet's selectors name. */
function definedClasses(css: string): Set<string> {
  const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].map((match) => match[1]!);
  return new Set(selectors.flatMap((selector) => [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]!)));
}

/** The class names a file writes in `className="…"`, or in the strings of a `className={…}`. */
function writtenClasses(source: string): string[] {
  const literal = [...source.matchAll(/className="([^"]*)"/g)].map((match) => match[1]!);
  const computed = [...source.matchAll(/className=\{([^}]*)\}/g)].flatMap((match) => [...match[1]!.matchAll(/["'`]([^"'`]*)["'`]/g)].map((inner) => inner[1]!));
  return [...literal, ...computed].flatMap((names) => names.split(/\s+/)).filter(Boolean);
}

const SOURCES = files(src, (file) => /\.tsx$/.test(file) && !/\.test\.tsx$/.test(file));
/** The classes defined where every page gets them: app.css, and the stylesheets that ship with a component. */
const GLOBAL = new Set(
  [join(app, "app.css"), ...files(join(src, "design"), (file) => file.endsWith(".css")), ...files(join(src, "components"), (file) => file.endsWith(".css"))].flatMap((file) => [
    ...definedClasses(readFileSync(file, "utf8")),
  ]),
);
const ROUTE_STYLESHEETS = files(app, (file) => file.endsWith(".css") && file !== join(app, "app.css"));

/** Whether `file` lies in `dir`. */
const within = (file: string, dir: string) => file.startsWith(dir + sep);

/** The files that import the component in `file`, by its path from `src` (`@/components/Name`) or a relative path. */
function importers(file: string): string[] {
  const module = relative(src, file).replace(/\.tsx$/, "");
  return SOURCES.filter((other) => other !== file).filter((other) => {
    const source = readFileSync(other, "utf8");
    const relativeModule = relative(dirname(other), file).replace(/\.tsx$/, "");
    return source.includes(`"@/${module}"`) || source.includes(`"./${relativeModule}"`) || source.includes(`"${relativeModule}"`);
  });
}

/** Whether `file` is drawn only within `dir`: it lies there, or every file importing it is drawn only there. */
function drawnOnlyWithin(file: string, dir: string, seen = new Set<string>()): boolean {
  if (within(file, dir)) return true;
  if (seen.has(file)) return true;
  seen.add(file);
  const by = importers(file);
  return by.length > 0 && by.every((importer) => drawnOnlyWithin(importer, dir, seen));
}

/**
 * Writers the import graph cannot tell apart from their module: TextSizeControl.tsx exports the select (home page, a
 * Job Offer) and the slider; only the slider writes `.text-size-hint`, and only Préférences draws the slider.
 */
const DRAWN_ONLY_IN_ROUTE = ["components/TextSizeControl.tsx writes .text-size-hint"];

describe("a route's own stylesheet styles only its route (#469)", () => {
  it("finds the route stylesheets", () => {
    expect(ROUTE_STYLESHEETS.map((file) => relative(app, file))).toContain(join("agenda", "agenda.css"));
  });

  it.each(ROUTE_STYLESHEETS.map((file) => [relative(app, file), file]))("%s: its classes are written only by what its route draws", (_, stylesheet) => {
    const route = dirname(stylesheet);
    const own = [...definedClasses(readFileSync(stylesheet, "utf8"))].filter((name) => !GLOBAL.has(name));
    const outside = SOURCES.flatMap((file) =>
      writtenClasses(readFileSync(file, "utf8"))
        .filter((name) => own.includes(name))
        .filter(() => !drawnOnlyWithin(file, route))
        .map((name) => `${relative(src, file)} writes .${name}`),
    );
    expect([...new Set(outside)].filter((writer) => !DRAWN_ONLY_IN_ROUTE.includes(writer))).toEqual([]);
  });
});
