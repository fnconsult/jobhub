import { resources } from "@jobhub/shared/i18n";
import { articles } from "./index";
import type { HelpSettings } from "./requirements";
import type { HelpLocale } from "./types";

/** Every string of a catalogue, its `{{placeholders}}` written « … » as the articles quote them. */
function catalogueStrings(node: unknown, into: string[] = []): string[] {
  if (typeof node === "string") into.push(node.replace(/\{\{\s*\w+\s*\}\}/g, "…"));
  else if (node && typeof node === "object") for (const child of Object.values(node)) catalogueStrings(child, into);
  return into;
}

/** The words an article quotes « like this ». */
const quotes = (body: string) => [...body.matchAll(/«\s*([^«»]+?)\s*»/g)].map((match) => match[1]!);

/**
 * The quotes of a topic's Help Articles that the interface does not have (ADR-0065: labels word for word), as
 * « <id>: « quote » ». A quote is found when it is a string of the interface's catalogue (the web app's and the
 * extension's), or its beginning up to a sentence break (« Ce lien de désabonnement n'est plus valable »), or the
 * title of another Help Article served in the same language under the same `settings` (« Espace coach v2 » off unless
 * said, #867). Used by the tests only.
 */
export function unknownQuotes(topic: string, locale: HelpLocale, settings: HelpSettings = {}): { count: number; missing: string[] } {
  const strings = catalogueStrings(resources[locale]);
  const titles = articles(locale, settings).map((article) => article.title);
  const found = (quote: string) =>
    titles.includes(quote) || strings.some((value) => value === quote || (value.startsWith(quote) && /^[\s.,;:!?]/.test(value.slice(quote.length))));
  const inTopic = articles(locale, settings).filter((article) => article.topic === topic);
  return { count: inTopic.length, missing: inTopic.flatMap((article) => quotes(article.body).filter((quote) => !found(quote)).map((quote) => `${article.id}: « ${quote} »`)) };
}
