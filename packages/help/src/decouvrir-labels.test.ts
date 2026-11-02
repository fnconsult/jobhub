import { resources } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { articles } from "./index";
import { HELP_LOCALES, type HelpLocale } from "./types";

/** Every string of a catalogue, its `{{placeholders}}` written « … » as the articles quote them. */
function catalogueStrings(node: unknown, into: string[] = []): string[] {
  if (typeof node === "string") into.push(node.replace(/\{\{\s*\w+\s*\}\}/g, "…"));
  else if (node && typeof node === "object") for (const child of Object.values(node)) catalogueStrings(child, into);
  return into;
}

/** The words an article quotes « like this ». */
const quotes = (body: string) => [...body.matchAll(/«\s*([^«»]+?)\s*»/g)].map((match) => match[1]!);

/**
 * #552: the « Découvrir Jobbbox » articles quote the interface word for word (ADR-0065). Each quote is a string of the
 * interface's catalogue, or its beginning up to a sentence break (« Ce lien de désabonnement n'est plus valable »), or
 * the title of another Help Article in the same language.
 */
describe("the « Découvrir Jobbbox » Help Articles' quoted labels (#552)", () => {
  it.each(HELP_LOCALES)("each exists in the %s catalogue", (locale: HelpLocale) => {
    const strings = catalogueStrings(resources[locale]);
    const titles = articles(locale).map((article) => article.title);
    const found = (quote: string) =>
      titles.includes(quote) || strings.some((value) => value === quote || (value.startsWith(quote) && /^[\s.,;:!?]/.test(value.slice(quote.length))));
    const decouvrir = articles(locale).filter((article) => article.topic === "decouvrir");
    expect(decouvrir.length).toBeGreaterThanOrEqual(10);
    const missing = decouvrir.flatMap((article) => quotes(article.body).filter((quote) => !found(quote)).map((quote) => `${article.id}: « ${quote} »`));
    expect(missing).toEqual([]);
  });
});
