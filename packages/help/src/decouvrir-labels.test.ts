import { describe, expect, it } from "vitest";
import { unknownQuotes } from "./quoted-labels";
import { HELP_LOCALES, type HelpLocale } from "./types";

/** #552: the « Découvrir Jobbbox » articles quote the interface word for word (ADR-0065). */
describe("the « Découvrir Jobbbox » Help Articles' quoted labels (#552)", () => {
  it.each(HELP_LOCALES)("each exists in the %s catalogue", (locale: HelpLocale) => {
    const { count, missing } = unknownQuotes("decouvrir", locale);
    expect(count).toBeGreaterThanOrEqual(10);
    expect(missing).toEqual([]);
  });
});
