import { describe, expect, it } from "vitest";
import { unknownQuotes } from "./quoted-labels";
import { HELP_LOCALES, type HelpLocale } from "./types";

/** #555: the « Utiliser Jobbbox » articles quote the interface word for word, after the Design System (ADR-0065). */
describe("the « Utiliser Jobbbox » Help Articles' quoted labels (#555)", () => {
  it.each(HELP_LOCALES)("each exists in the %s catalogue", (locale: HelpLocale) => {
    const { count, missing } = unknownQuotes("utiliser", locale);
    expect(count).toBeGreaterThanOrEqual(29);
    expect(missing).toEqual([]);
  });

  // « Espace coach v2 » on (#867): its articles, and each `.v2` in its base's place, quote the interface as well.
  it.each(HELP_LOCALES)("each exists in the %s catalogue, « Espace coach v2 » on", (locale: HelpLocale) => {
    const { count, missing } = unknownQuotes("utiliser", locale, { coachSpaceV2: true });
    expect(count).toBeGreaterThanOrEqual(29);
    expect(missing).toEqual([]);
  });
});
