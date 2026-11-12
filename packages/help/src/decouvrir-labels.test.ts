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

  // « Espace coach v2 » on (#867): its articles, and each `.v2` in its base's place, quote the interface as well.
  it.each(HELP_LOCALES)("each exists in the %s catalogue, « Espace coach v2 » on", (locale: HelpLocale) => {
    const { count, missing } = unknownQuotes("decouvrir", locale, { coachSpaceV2: true });
    expect(count).toBeGreaterThanOrEqual(10);
    expect(missing).toEqual([]);
  });
});
