import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { startServer, type PlanPricesServer } from "./support/plan-prices";

// Issue #545: the public site in English under /en, with the same French slugs; `hreflang` and `canonical` on each
// indexed public page; `noindex` everywhere else; `robots.txt` and `sitemap.xml`. The suite's server is a Beta (any
// target but production): there, every page is noindex and robots.txt disallows everything. A second server of the
// same build, JOBHUB_TARGET=production, shows what Production indexes.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const robotsMeta = (page: Page) => page.locator('meta[name="robots"]').getAttribute("content");

/** The page's canonical and its hreflang links, by language. */
async function alternates(page: Page): Promise<{ canonical: string | null; languages: Record<string, string> }> {
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  const links = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((all) => all.map((link) => [link.getAttribute("hreflang")!, link.getAttribute("href")!]));
  return { canonical, languages: Object.fromEntries(links) };
}

test.describe("the public site in English (#545)", () => {
  test("/en/legal/cgu and /en/nouveautes are in English for a Visitor, with the French slugs", async ({ page }) => {
    await page.goto("/en/legal/cgu");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.legal.texts.cgu);
    await expect(page.getByRole("banner").getByRole("link", { name: "English" })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("banner").getByRole("link", { name: "Français" })).toHaveAttribute("href", "/legal/cgu");

    await page.goto("/en/nouveautes");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.nouveautes.title);
    await expect(page.getByRole("banner").getByRole("link", { name: en.publicSite.help })).toHaveAttribute("href", "/en/aide");

    await page.goto("/en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    // A moved address of Légal keeps English.
    const moved = await page.request.get("/en/legal/ia", { maxRedirects: 0 });
    expect(moved.status()).toBe(308);
    expect(moved.headers().location).toMatch(/\/en\/legal\/confidentialite#ia$/);

    // /en before a page that is not public serves nothing, in English.
    const response = await page.goto("/en/candidatures");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.errorPage.notFound.title);
  });

  test("a Candidate signed in in French who opens an /en address reads their Interface Language; the page stays valid", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("public-site-en"));
    const response = await page.goto("/en/legal/cgu");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(`${origin}/en/legal/cgu`);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.legal.texts.cgu);
    // Their FR/EN switch still changes the page's language: it says `lang`, which comes first.
    await page.getByRole("banner").getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(`${origin}/en/legal/cgu?lang=en`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("each indexed public page has its canonical and reciprocal hreflang, x-default the French", async ({ page }) => {
    for (const path of ["/", "/aide", "/nouveautes"]) {
      for (const url of ["fr", "en"] as const) {
        const english = path === "/" ? "/en" : `/en${path}`;
        await page.goto(url === "en" ? english : path);
        expect(await alternates(page), `${url} ${path}`).toEqual({
          canonical: `${origin}${url === "en" ? english : path}`,
          languages: { fr: `${origin}${path}`, en: `${origin}${english}`, "x-default": `${origin}${path}` },
        });
      }
    }
  });

  test("on the Beta every page is noindex, robots.txt disallows everything and the sitemap lists nothing", async ({ page }) => {
    for (const path of ["/", "/en/aide", "/nouveautes", "/legal/cgu", "/connexion", "/desabonnement", "/compte/supprime", "/legal/cgu/versions"]) {
      const response = await page.goto(path);
      expect(response?.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
      expect(await robotsMeta(page), path).toMatch(/^noindex/);
    }
    const robots = await page.request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toMatch(/User-Agent: \*\nDisallow: \/\n/);
    const sitemap = await page.request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).not.toContain("<url>");
  });
});

test.describe("what Production indexes (#545)", () => {
  test.describe.configure({ timeout: 180_000 });
  let server: PlanPricesServer;
  test.beforeAll(async () => {
    server = await startServer(545, { JOBHUB_TARGET: "production" }, "start");
  });
  test.afterAll(() => server?.stop());

  test("robots.txt allows the public site and points to the sitemap, which lists the indexed pages in French and in English", async ({ request }) => {
    const robots = await (await request.get(`${server.origin}/robots.txt`)).text();
    expect(robots).toContain("Allow: /");
    for (const path of ["/admin", "/api", "/espace-coach"]) expect(robots).toContain(`Disallow: ${path}\n`);
    expect(robots).toContain(`Sitemap: ${server.origin}/sitemap.xml`);

    const sitemap = await (await request.get(`${server.origin}/sitemap.xml`)).text();
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!.replace(server.origin, ""));
    for (const path of ["/", "/en", "/aide", "/en/aide", "/nouveautes", "/en/nouveautes"]) expect(urls, path).toContain(path);
    for (const url of urls) expect(url, "no noindex page").not.toMatch(/^(\/en)?\/(connexion|desabonnement|compte|admin|espace-coach|legal\/[^/]+\/)/);
    expect(sitemap).toContain(`hreflang="en" href="${server.origin}/en/nouveautes"`);
  });

  test("the indexed pages say index; sign-in, the unsubscribe page, the deleted account's and a signed-in page say noindex", async ({ page }) => {
    for (const path of ["/aide", "/en/nouveautes"]) {
      const response = await page.goto(`${server.origin}${path}`);
      expect(response?.headers()["x-robots-tag"], path).toBeUndefined();
      expect(await robotsMeta(page), path).toBe("index, follow");
    }
    for (const path of ["/connexion", "/en/connexion", "/desabonnement", "/compte/supprime", "/legal/cgu/versions", "/legal/cgv", "/candidatures"]) {
      await page.goto(`${server.origin}${path}`);
      expect(await robotsMeta(page), path).toBe("noindex");
    }
  });
});
