import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = resolve(import.meta.dirname, "../../packages/shared/src");

/** The relative modules a source file imports or re-exports (static `from "./…"` and side-effect `import "./…"`). */
function relativeImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/(?:from|import)\s+["'](\.{1,2}\/[^"']+)["']/g)].map((match) => match[1] as string);
}

function resolveModule(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  const candidate = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((path) => statSync(path, { throwIfNoEntry: false })?.isFile());
  if (!candidate) throw new Error(`${from} imports ${specifier}, which does not resolve`);
  return candidate;
}

/** Every module of this package that `@jobhub/shared` (src/index.ts) loads, itself included. */
function rootExportGraph(): Set<string> {
  const seen = new Set<string>();
  const pending = [join(SOURCE, "index.ts")];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith(".json")) continue;
    for (const specifier of relativeImports(file)) pending.push(resolveModule(file, specifier));
  }
  return seen;
}

describe("@jobhub/shared, the root export the specs import", () => {
  // Playwright's specs (e2e/*.spec.ts, e2e/support) import it through Node's own ESM loader, which refuses a JSON module imported
  // without `with { type: "json" }`: one such import anywhere below the barrel and no spec loads ("No tests found").
  // The JSON-backed modules (the i18n locales) stay behind a subpath export (`@jobhub/shared/i18n`, …).
  it("loads no JSON module, so Node's ESM loader (Playwright) can import it", () => {
    const json = [...rootExportGraph()].filter((file) => file.endsWith(".json")).map((file) => file.slice(SOURCE.length + 1));
    expect(json).toEqual([]);
  });
});
