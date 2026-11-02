import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { articles } from "@jobhub/help";
import { describe, expect, it } from "vitest";

// A page Help Article explains the page at its `route:` (ADR-0065): a route that no longer exists leaves the article
// unreachable from « Aide » and points the Help Centre at nothing (#555).
const app = fileURLToPath(new URL("./", import.meta.url));

/** The address pattern of every page under `dir`, as a page article writes it: route groups `(…)` left out. */
function pageRoutes(dir: string, path: string[] = []): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "api" && path.length === 0 ? [] : pageRoutes(full, /^\(.+\)$/.test(name) ? path : [...path, name]);
    return name === "page.tsx" ? [`/${path.join("/")}`] : [];
  });
}

const routes = new Set(pageRoutes(app));
/** The web app's page articles: the Side Panel's lives in the extension, not under `app`. */
const pageArticles = articles("fr").filter((article) => article.route !== null && article.topic !== "extension");

describe("each page Help Article's route (#555)", () => {
  it("finds the web app's pages and page articles", () => {
    expect(routes).toContain("/compte/reception-email");
    expect(routes).toContain("/profils/[id]/entreprises-cibles");
    expect(pageArticles.filter((article) => article.audience === "candidate" && article.topic === "utiliser").length).toBeGreaterThanOrEqual(20);
  });

  it.each(pageArticles.map((article) => [article.id, article.route!]))("%s: %s is a page of apps/web/src/app", (_, route) => {
    expect(routes).toContain(route);
  });
});
