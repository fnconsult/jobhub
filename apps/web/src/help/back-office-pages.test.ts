import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { articles, routeAddresses } from "@jobhub/help";
import { describe, expect, it } from "vitest";
import { PARAMETRES_TABS } from "../platform-settings/parametres";

const appDir = fileURLToPath(new URL("../app", import.meta.url));

/**
 * The Administrators' page articles (#551, #557) explain a Back Office page that exists, and a tab of Paramètres by its
 * slug (`?tab=connexion`): a renamed page or tab would otherwise quietly lose its article « Sur cette page ».
 */
describe("the Back Office's page articles", () => {
  const pages = articles("fr").filter(
    (article) =>
      article.audience === "administrator" && article.kind === "page",
  );

  it("each explains a Back Office page of the app", () => {
    const missing = pages
      .filter(
        (article) =>
          !existsSync(
            path.join(appDir, article.route!.split("?")[0]!, "page.tsx"),
          ),
      )
      .map((article) => article.route);
    expect(missing).toEqual([]);
  });

  it("names a tab of Paramètres by one of its slugs", () => {
    const slugs = PARAMETRES_TABS.map((tab) => tab.slug);
    const named = pages
      .flatMap((article) => routeAddresses(article.route!))
      .filter((address) => address.startsWith("/admin/parametres?"));
    expect(named.length).toBeGreaterThanOrEqual(4);
    const unknown = named.filter(
      (address) =>
        !slugs.includes(
          new URLSearchParams(address.split("?")[1]).get("tab") ?? "",
        ),
    );
    expect(unknown).toEqual([]);
  });
});
