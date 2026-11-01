import { describe, expect, it } from "vitest";
import { AIDE_ET_LEGAL, footerColumns, HEADER_LINKS, languageLinks, localePath, shellHref, withLang } from "./public-shell";

const hrefs = (links: ReadonlyArray<{ href: string }>) => links.map((link) => link.href);

describe("withLang", () => {
  it("leaves a link alone when the page's language is not chosen by its URL", () => {
    expect(withLang("/legal/cgv")).toBe("/legal/cgv");
  });

  it("carries the language the URL chose, before the anchor and with the query kept", () => {
    expect(withLang("/legal/confidentialite#ia", "en")).toBe("/legal/confidentialite?lang=en#ia");
    expect(withLang("/connexion?suite=%2Fcompte", "en")).toBe("/connexion?suite=%2Fcompte&lang=en");
    expect(withLang("/nouveautes?lang=fr", "en")).toBe("/nouveautes?lang=en");
  });

  it("never touches a link out of the site", () => {
    expect(withLang("mailto:contact@jobbbox.fr", "en")).toBe("mailto:contact@jobbbox.fr");
    expect(withLang("https://chromewebstore.google.com/detail/jobbbox", "en")).toBe("https://chromewebstore.google.com/detail/jobbbox");
  });
});

describe("the public header (#544)", () => {
  it("leads to Nouveautés, Aide and Légal, in that order", () => {
    expect(HEADER_LINKS.map(({ key, href }) => [key, href])).toEqual([
      ["nouveautes", "/nouveautes"],
      ["aide", "/aide"],
      ["legal", "/legal/cgu"],
    ]);
  });
});

describe("the public footer (#544)", () => {
  const columns = footerColumns({ contactEmail: "contact@jobbbox.fr", extensionStore: "https://chromewebstore.google.com/detail/jobbbox" });

  it("has three columns: Légal, Aide, Jobbbox", () => {
    expect(columns.map((column) => column.key)).toEqual(["legal", "help", "jobbbox"]);
  });

  it("Légal: Mentions légales, CGU, CGV, Confidentialité et cookies, IA dans Jobbbox at its anchor in the privacy policy", () => {
    const legal = columns[0]!.links;
    expect(legal.map((link) => link.key)).toEqual(["mentionsLegales", "cgu", "cgv", "confidentialite", "ia"]);
    expect(hrefs(legal)).toEqual(["/legal/mentions-legales", "/legal/cgu", "/legal/cgv", "/legal/confidentialite", "/legal/confidentialite#ia"]);
  });

  it("Aide: the Help Centre, an email to the team, the extension's store page", () => {
    const help = columns[1]!.links;
    expect(help.map((link) => link.key)).toEqual(["helpCentre", "contact", "extension"]);
    expect(hrefs(help)).toEqual(["/aide", "mailto:contact@jobbbox.fr", "https://chromewebstore.google.com/detail/jobbbox"]);
  });

  it("without a contact address or a store page, « Nous contacter » and « Extension » lead to the Help Centre", () => {
    const help = footerColumns({})[1]!.links;
    expect(hrefs(help)).toEqual(["/aide", "/aide", "/aide"]);
  });

  it("Jobbbox: Nouveautés and « Se connecter », « Mon compte » once signed in, neither on a sign-in page", () => {
    expect(hrefs(columns[2]!.links)).toEqual(["/nouveautes", "/connexion"]);
    expect(footerColumns({ account: "account" })[2]!.links.map(({ label, href }) => [label, href])).toEqual([
      ["publicSite.nouveautes", "/nouveautes"],
      ["nav.account", "/compte"],
    ]);
    expect(hrefs(footerColumns({ account: null })[2]!.links)).toEqual(["/nouveautes"]);
  });
});

describe("languageLinks (#545)", () => {
  it("names the page itself at its French and its English address, its query kept and its `lang` dropped", () => {
    expect(languageLinks("/legal/cgv?version=1.0")).toEqual([
      { locale: "fr", href: "/legal/cgv?version=1.0" },
      { locale: "en", href: "/en/legal/cgv?version=1.0" },
    ]);
    expect(languageLinks("/en/nouveautes?lang=en")).toEqual([
      { locale: "fr", href: "/nouveautes" },
      { locale: "en", href: "/en/nouveautes" },
    ]);
    expect(languageLinks("/en")).toEqual([
      { locale: "fr", href: "/" },
      { locale: "en", href: "/en" },
    ]);
  });

  it("for a signed-in Candidate, whose Interface Language comes first, also says `lang`", () => {
    expect(languageLinks("/en/legal/cgu", { signedIn: true })).toEqual([
      { locale: "fr", href: "/legal/cgu?lang=fr" },
      { locale: "en", href: "/en/legal/cgu?lang=en" },
    ]);
  });
});

describe("localePath and shellHref (#545)", () => {
  it("puts a page of the site under /en in English, the home page at /en; French has no prefix", () => {
    expect(localePath("/legal/confidentialite#ia", "en")).toBe("/en/legal/confidentialite#ia");
    expect(localePath("/", "en")).toBe("/en");
    expect(localePath("/?x=1", "en")).toBe("/en?x=1");
    expect(localePath("/en/aide", "en")).toBe("/en/aide");
    expect(localePath("/aide", "fr")).toBe("/aide");
    expect(localePath("/aide")).toBe("/aide");
    expect(localePath("mailto:contact@jobbbox.fr", "en")).toBe("mailto:contact@jobbbox.fr");
  });

  it("keeps the URL's language from page to page, and its `lang` when it had one", () => {
    expect(shellHref("/nouveautes", { url: "en" })).toBe("/en/nouveautes");
    expect(shellHref("/nouveautes", { url: "fr" })).toBe("/nouveautes");
    expect(shellHref("/legal/cgu", { url: "en", lang: "en" })).toBe("/en/legal/cgu?lang=en");
    expect(shellHref("https://chromewebstore.google.com/detail/jobbbox", { url: "en" })).toBe("https://chromewebstore.google.com/detail/jobbbox");
  });
});

describe("« Aide et légal » in the Candidate's Sidebar (#544)", () => {
  it("leads to Aide, Légal and Nouveautés", () => {
    expect(AIDE_ET_LEGAL.map(({ key, href }) => [key, href])).toEqual([
      ["aide", "/aide"],
      ["legal", "/legal/cgu"],
      ["nouveautes", "/nouveautes"],
    ]);
  });
});
