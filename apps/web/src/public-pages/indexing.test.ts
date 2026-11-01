import { describe, expect, it } from "vitest";
import { helpCentrePaths, indexedPages, publicPageMetadata, robotsFile, siteOrigin, sitemapEntries, type IndexSources } from "./indexing";

const ORIGIN = "https://app.jobbbox.fr";

// A public Help Article of the Help Centre (#549), an Administrator's that must never be listed (ADR-0065), and one
// without a topic, which has no public address.
const ARTICLES = [
  { id: "faq-extension", audience: "visitor", topic: "extension" },
  { id: "tutorial-parametres", audience: "administrator", topic: "parametres" },
  { id: "page-account" },
];
const SOURCES: IndexSources = {
  helpArticles: ARTICLES,
  // The CGU in effect in both languages, the privacy policy in French only, the others not written yet.
  legalTextInEffect: (text, locale) => text === "cgu" || (text === "confidentialite" && locale === "fr"),
};

describe("publicPageMetadata (#545)", () => {
  it("an indexed page carries its canonical and reciprocal hreflang, x-default the French, in each language", () => {
    const fr = publicPageMetadata({ path: "/legal/cgu", indexedIn: ["fr", "en"], url: "fr", origin: ORIGIN, beta: false });
    const en = publicPageMetadata({ path: "/legal/cgu", indexedIn: ["fr", "en"], url: "en", origin: ORIGIN, beta: false });
    const languages = { fr: `${ORIGIN}/legal/cgu`, en: `${ORIGIN}/en/legal/cgu`, "x-default": `${ORIGIN}/legal/cgu` };
    expect(fr).toEqual({ alternates: { canonical: `${ORIGIN}/legal/cgu`, languages }, robots: { index: true, follow: true } });
    expect(en).toEqual({ alternates: { canonical: `${ORIGIN}/en/legal/cgu`, languages }, robots: { index: true, follow: true } });
  });

  it("the home page is / in French and /en in English", () => {
    const home = publicPageMetadata({ path: "/", indexedIn: ["fr", "en"], url: "en", origin: ORIGIN, beta: false });
    expect(home.alternates).toEqual({ canonical: `${ORIGIN}/en`, languages: { fr: `${ORIGIN}/`, en: `${ORIGIN}/en`, "x-default": `${ORIGIN}/` } });
  });

  it("a page not indexed in its URL's language is noindex, with no canonical", () => {
    expect(publicPageMetadata({ path: "/legal/confidentialite", indexedIn: ["fr"], url: "en", origin: ORIGIN, beta: false })).toEqual({ robots: { index: false } });
    expect(publicPageMetadata({ path: "/legal/cgv", indexedIn: [], url: "fr", origin: ORIGIN, beta: false })).toEqual({ robots: { index: false } });
  });

  it("on the Beta, every page is noindex", () => {
    expect(publicPageMetadata({ path: "/aide", indexedIn: ["fr", "en"], url: "fr", origin: ORIGIN, beta: true }).robots).toEqual({ index: false });
  });
});

describe("the Help Centre in the sitemap (#545, ADR-0065)", () => {
  it("lists the public Help Articles at /aide/<topic>/<id>, never an Administrator's, never one without a topic", () => {
    expect(helpCentrePaths(ARTICLES)).toEqual(["/aide/extension/faq-extension"]);
  });
});

describe("sitemap.xml (#545)", () => {
  const entries = sitemapEntries({ origin: ORIGIN, beta: false, sources: SOURCES });
  const urls = entries.map((entry) => entry.url);

  it("lists every indexed page in French and in English, each with its hreflang", () => {
    expect(urls).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/en`,
      `${ORIGIN}/aide`,
      `${ORIGIN}/en/aide`,
      `${ORIGIN}/aide/extension/faq-extension`,
      `${ORIGIN}/en/aide/extension/faq-extension`,
      `${ORIGIN}/legal/cgu`,
      `${ORIGIN}/en/legal/cgu`,
      `${ORIGIN}/legal/confidentialite`,
      `${ORIGIN}/nouveautes`,
      `${ORIGIN}/en/nouveautes`,
    ]);
    expect(entries.find((entry) => entry.url === `${ORIGIN}/en/nouveautes`)?.alternates).toEqual({
      languages: { fr: `${ORIGIN}/nouveautes`, en: `${ORIGIN}/en/nouveautes`, "x-default": `${ORIGIN}/nouveautes` },
    });
  });

  it("lists no Administrator article and no noindex page", () => {
    expect(urls.some((url) => url.includes("tutorial-parametres"))).toBe(false);
    for (const noindex of ["/connexion", "/desabonnement", "/compte/supprime", "/legal/cgu/", "/legal/cgv", "/admin", "/espace-coach", "/compte"]) {
      expect(urls.some((url) => url.replace(/\/en(?=\/|$)/, "").startsWith(`${ORIGIN}${noindex}`)), noindex).toBe(false);
    }
  });

  it("every page it lists is indexed by its own metadata in that language", () => {
    for (const { path, indexedIn } of indexedPages(SOURCES)) {
      for (const url of indexedIn) {
        expect(publicPageMetadata({ path, indexedIn, url, origin: ORIGIN, beta: false }).robots, `${url} ${path}`).toEqual({ index: true, follow: true });
      }
    }
  });

  it("is empty on the Beta", () => {
    expect(sitemapEntries({ origin: ORIGIN, beta: true, sources: SOURCES })).toEqual([]);
  });
});

describe("robots.txt (#545)", () => {
  it("allows the public site, points to the sitemap and disallows the Back Office, the API and the coach space", () => {
    expect(robotsFile({ origin: ORIGIN, beta: false })).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/espace-coach"] },
      sitemap: `${ORIGIN}/sitemap.xml`,
    });
  });

  it("disallows everything on the Beta", () => {
    expect(robotsFile({ origin: ORIGIN, beta: true })).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});

describe("siteOrigin", () => {
  it("is APP_URL, else the request's host", () => {
    expect(siteOrigin({ APP_URL: "https://app.jobbbox.fr/" })).toBe(ORIGIN);
    expect(siteOrigin({}, { host: "beta.jobbbox.fr", proto: "https" })).toBe("https://beta.jobbbox.fr");
    expect(siteOrigin({}, { host: "localhost:3000" })).toBe("http://localhost:3000");
  });
});
