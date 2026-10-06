import { describe, expect, it } from "vitest";
import { createI18n, DEFAULT_LOCALE, resources, SUPPORTED_LOCALES } from "./index";

function keysOf(tree: object, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "object" && value !== null ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

describe("createI18n", () => {
  it("speaks French by default", () => {
    expect(DEFAULT_LOCALE).toBe("fr");
    const i18n = createI18n();
    expect(i18n.language).toBe("fr");
    expect(i18n.t("textSize.label")).toBe("Taille du texte");
  });

  it("switches to English when asked", () => {
    expect(createI18n("en").t("textSize.label")).toBe("Text size");
  });

  it("falls back to French for an unsupported locale", () => {
    const i18n = createI18n("de");
    expect(i18n.language).toBe("fr");
    expect(i18n.t("textSize.label")).toBe("Taille du texte");
  });
});

describe("translation catalogues", () => {
  it("have exactly the same keys in every supported locale", () => {
    const reference = keysOf(resources[DEFAULT_LOCALE].translation).sort();
    for (const locale of SUPPORTED_LOCALES) {
      expect(keysOf(resources[locale].translation).sort()).toEqual(reference);
    }
  });
});
