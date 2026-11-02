import { describe, expect, it } from "vitest";
import { unknownQuotes } from "./quoted-labels";
import { HELP_LOCALES, type HelpLocale } from "./types";

/** #553: the « L'extension » articles quote the Side Panel and the web app word for word (ADR-0065). */
describe("the « L'extension » Help Articles' quoted labels (#553)", () => {
  it.each(HELP_LOCALES)("each exists in the %s catalogue", (locale: HelpLocale) => {
    const { count, missing } = unknownQuotes("extension", locale);
    expect(count).toBe(7);
    expect(missing).toEqual([]);
  });
});
