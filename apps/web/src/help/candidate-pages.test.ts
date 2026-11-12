import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { articleFor, articlesFor } from "@jobhub/help";
import { describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL("../app", import.meta.url));

/**
 * The pages that are not a Candidate's: the Back Office, the Coach space, signing in, pages read signed out (the public
 * pages Nouveautés and Légal among them, #470, and the Help Centre, #544), and the Design System components' test page (#462), served to the e2e
 * suite only.
 */
const NOT_CANDIDATE_PAGES = [
  /^\/admin(\/|$)/,
  /^\/espace-coach(\/|$)/,
  /^\/connexion(\/|$)/,
  /^\/desabonnement(\/nouveautes)?$/,
  /^\/compte\/supprime$/,
  /^\/design-system(\/|$)/,
  /^\/nouveautes(\/\[version\])?$/,
  /^\/legal(\/|$)/,
  /^\/aide(\/|$)/,
  // The Human Coaches' path on the public site (ADR-0105): a Visitor's page, behind a switch.
  /^\/coachs-humains$/,
];

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

  // « Espace coach v2 » on (#867): every page, the Human Coach epic's too.
  it.each(["fr", "en"] as const)("gives every Candidate page a page article, in %s (« Espace coach v2 » on)", (locale) => {
    const withoutArticle = candidatePages.filter((route) => articleFor(route, locale, { from: articlesFor(locale, { coachSpaceV2: true }) })?.kind !== "page");
    expect(withoutArticle).toEqual([]);
  });

  // Off, the articles main served: a page the epic added (a 404 while it is off, ADR-0106) has its article on only.
  it.each(["fr", "en"] as const)("gives every Candidate page a page article, in %s, but the epic's pages while « Espace coach v2 » is off", (locale) => {
    const withoutArticle = candidatePages.filter((route) => articleFor(route, locale)?.kind !== "page");
    const epics = withoutArticle.filter((route) => articleFor(route, locale, { from: articlesFor(locale, { coachSpaceV2: true }) })?.requires === "coach-space-v2");
    expect(withoutArticle).toEqual(epics);
    expect(withoutArticle).not.toContain("/coachs");
  });
});
