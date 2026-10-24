import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { articleFor } from "@jobhub/help";
import { describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL("../app", import.meta.url));

/** The pages that are not a Candidate's: the Back Office, the Coach space, signing in, and pages read signed out. */
const NOT_CANDIDATE_PAGES = [/^\/admin(\/|$)/, /^\/espace-coach(\/|$)/, /^\/connexion(\/|$)/, /^\/desabonnement$/, /^\/compte\/supprime$/];

/** Every page's route pattern (`/candidatures/[id]/documents`), route groups such as `(sections)` left out. */
function pageRoutes(dir: string, route = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isFile()) return entry.name === "page.tsx" ? [route || "/"] : [];
    if (!entry.isDirectory() || entry.name === "api" || entry.name.startsWith("_")) return [];
    const segment = /^\(.+\)$/.test(entry.name) ? "" : `/${entry.name}`;
    return pageRoutes(path.join(dir, entry.name), route + segment);
  });
}

describe("Help Articles of the Candidate's pages (ADR-0035)", () => {
  const candidatePages = pageRoutes(appDir).filter((route) => !NOT_CANDIDATE_PAGES.some((pattern) => pattern.test(route)));

  it("finds the Candidate's pages", () => {
    expect(candidatePages).toEqual(expect.arrayContaining(["/", "/candidatures", "/candidatures/[id]", "/profils/[id]", "/recherches", "/agenda", "/compte"]));
    expect(candidatePages).not.toContain("/admin");
  });

  it.each(["fr", "en"] as const)("gives every Candidate page a page article, in %s", (locale) => {
    const withoutArticle = candidatePages.filter((route) => articleFor(route, locale)?.kind !== "page");
    expect(withoutArticle).toEqual([]);
  });
});
