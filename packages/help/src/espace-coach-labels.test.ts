import { describe, expect, it } from "vitest";
import { unknownQuotes } from "./quoted-labels";
import { HELP_LOCALES, type HelpLocale } from "./types";

/** #554: the « Espace coach » articles quote the coach space, and the Candidate's pages they mention, word for word (ADR-0065). */
describe("the « Espace coach » Help Articles' quoted labels (#554)", () => {
  it.each(HELP_LOCALES)("each exists in the %s catalogue", (locale: HelpLocale) => {
    const { count, missing } = unknownQuotes("espace-coach", locale);
    // The five of #554, and why Two-step verification is asked (#665).
    expect(count).toBe(6);
    expect(missing).toEqual([]);
  });
});
