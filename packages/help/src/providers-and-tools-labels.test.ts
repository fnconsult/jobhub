import { TOOLS } from "@jobhub/shared";
import { resources } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { articleFor, articles, isPublic } from "./index";
import { HELP_LOCALES, type HelpLocale } from "./types";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every string of a catalogue, its `{{placeholders}}` written « … » as the articles quote them. */
function catalogueStrings(node: unknown, into: string[] = []): string[] {
  if (typeof node === "string")
    into.push(node.replace(/\{\{\s*\w+\s*\}\}/g, "…"));
  else if (node && typeof node === "object")
    for (const child of Object.values(node)) catalogueStrings(child, into);
  return into;
}

/** `text` as a pattern, each « … » standing for a name. */
const withNames = (text: string) =>
  text.split("…").map(escape).join("(?:…|.+?)");

/** The words an article quotes « like this », an ellipsis standing for a name (« Tester … »). */
const quotes = (body: string) =>
  [...body.matchAll(/«\s*([^«»]+?)\s*»/g)].map((match) => match[1]!);

const TOPIC = "fournisseurs-et-tools";
const ofTopic = (locale: HelpLocale) =>
  articles(locale).filter((article) => article.topic === TOPIC);

/**
 * #557: the Back Office's « Fournisseurs et Tools » articles (ADR-0065): 4 pages, 8 tutorials and 4 frequent questions,
 * for Administrators only, quoting the interface word for word. Each quote is a string of the interface's catalogue
 * (its placeholder written « … » or filled with a name), or its beginning up to a sentence break, a Tool's name, or
 * the title of another Help Article in the same language.
 */
describe("the « Fournisseurs et Tools » Help Articles (#557)", () => {
  it.each(HELP_LOCALES)(
    "are 4 pages, 8 tutorials and 4 frequent questions for Administrators, never public, in %s",
    (locale) => {
      const found = ofTopic(locale);
      const count = (kind: string) =>
        found.filter((article) => article.kind === kind).length;
      expect([
        count("page"),
        count("tutorial"),
        count("faq"),
        count("glossary"),
      ]).toEqual([4, 8, 4, 0]);
      expect(
        found.every(
          (article) =>
            article.audience === "administrator" && !isPublic(article),
        ),
      ).toBe(true);
    },
  );

  it.each(HELP_LOCALES)(
    "quote labels that exist in the %s catalogue",
    (locale: HelpLocale) => {
      const strings = catalogueStrings(resources[locale]);
    // Each string as a pattern, compiled once: its names filled in (« Ajouter Google ») or left « … ».
    const whole = strings.map((value) => new RegExp(`^${withNames(value)}$`));
    const names: readonly string[] = TOOLS.map((tool) => tool.name);
    const titles = articles(locale).map((article) => article.title);
    // A whole string, or its beginning up to a sentence break (« … n'a pas été modifié : … » of « …. La tentative … »).
    const found = (quote: string) => {
      const beginning = new RegExp(`^${withNames(quote)}(?=$|\\s?[.;:!?]|(?<=[.!?])\\s)`);
      return titles.includes(quote) || names.includes(quote) || whole.some((pattern) => pattern.test(quote)) || strings.some((value) => beginning.test(value));
    };
    const missing = ofTopic(locale).flatMap((article) =>
        quotes(article.body)
          .filter((quote) => !found(quote))
          .map((quote) => `${article.id}: « ${quote} »`),
      );
      expect(missing).toEqual([]);
    },
  );

  it("shows Paramètres, its Connexion tab, its Sources, Recherche web and Extension tabs and Outils their own article « Sur cette page »", () => {
    const here = (route: string) =>
      articleFor(route, "fr", { scope: "backOffice" })?.id;
    expect(here("/admin/parametres")).toBe("page-admin-settings");
    expect(here("/admin/parametres?tab=ia")).toBe("page-admin-settings");
    expect(here("/admin/parametres?tab=connexion&saved=google")).toBe(
      "page-admin-sign-in",
    );
    expect(
      here("/admin/parametres?fournisseur=france-travail&tab=sources"),
    ).toBe("page-admin-search-sites");
    expect(here("/admin/outils")).toBe("page-admin-tools");
    expect(here("/admin/outils/mistral")).toBe("page-admin-tools");
    expect(
      articleFor("/admin/parametres?tab=connexion", "fr", { scope: "public" }),
    ).toBeNull();
  });
});
