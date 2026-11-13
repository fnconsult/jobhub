import { describe, expect, it } from "vitest";
import { unknownQuotes } from "./quoted-labels";
import { HELP_LOCALES, type HelpLocale } from "./types";

/** #554: the « Espace coach » articles quote the coach space, and the Candidate's pages they mention, word for word (ADR-0065). */
describe("the « Espace coach » Help Articles' quoted labels (#554)", () => {
  it.each(HELP_LOCALES)("each exists in the %s catalogue", (locale: HelpLocale) => {
    const { count, missing } = unknownQuotes("espace-coach", locale);
    // The five of #554, why Two-step verification is asked (#665), the same in the app (#688), and its notifications (#699).
    expect(count).toBe(8);
    expect(missing).toEqual([]);
  });

  // « Espace coach v2 » on (#867): the current Coach and Association workspace articles, including contract, payment,
  // reminders and fiscal flows.
  it.each(HELP_LOCALES)("each exists in the %s catalogue, « Espace coach v2 » on", (locale: HelpLocale) => {
    const { count, missing } = unknownQuotes("espace-coach", locale, { coachSpaceV2: true });
    expect(count).toBe(37);
    expect(missing).toEqual([]);
  });
});
