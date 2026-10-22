import { createI18n, resources, SUPPORTED_LOCALES, type Locale } from "@jobhub/shared/i18n";
import i18next, { type TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { BACK_OFFICE_SECTIONS, FAILURE_FIELDS, type BackOfficeFailure, type BackOfficeSection } from "./back-office";
import { journalFieldName } from "./journal-fields";

const failureFields = Object.entries(FAILURE_FIELDS).flatMap(([section, fields]) => fields.map((field) => [section as BackOfficeSection, field] as const));

/** `locale`'s translations alone: a key it lacks comes back as the key, not in French. */
function onlyIn(locale: Locale): TFunction {
  const instance = i18next.createInstance();
  void instance.init({ resources: { [locale]: resources[locale] }, lng: locale, fallbackLng: false, initAsync: false, interpolation: { escapeValue: false } });
  return instance.t;
}

describe("journalFieldName", () => {
  // « Champ en cause » (#263): the field at fault of every failure is named as its page names it, in fr and en.
  describe.each(SUPPORTED_LOCALES)("in %s", (locale) => {
    it.each(failureFields)("names the field at fault %s.%s", (section, field) => {
      const name = journalFieldName(onlyIn(locale), section, field);
      expect(name).not.toBe(field);
      // Not a missing key's path either.
      expect(name).not.toMatch(/^[a-z][A-Za-z]*(\.[A-Za-z_]+)+$/);
    });
  });

  it("names a role refused for an unknown account's email, and an Apple key that does not sign", () => {
    const t = createI18n("fr").t;
    expect(journalFieldName(t, "roles", "email")).toBe("Adresse e-mail");
    expect(journalFieldName(t, "sign_in_providers", "privateKey")).toBe("Clé privée (.p8)");
  });

  it("is given only the fields declared for its section by a failure", () => {
    const declared: BackOfficeFailure = { section: "roles", target: "a@b.fr", tried: "added", reason: "unknown_account", field: "email" };
    // @ts-expect-error a field not declared in FAILURE_FIELDS for the section would have no label.
    const undeclared: BackOfficeFailure = { section: "roles", target: "a@b.fr", tried: "added", reason: "unknown_account", field: "nickname" };
    expect([declared, undeclared]).toHaveLength(2);
  });
});

describe("the Journal's sections", () => {
  // An Administrator denied a section outside their roles (#264) is recorded in it, whichever it is: each is named in fr and en.
  describe.each(SUPPORTED_LOCALES)("in %s", (locale) => {
    it.each(BACK_OFFICE_SECTIONS)("names the section %s", (section) => {
      expect(onlyIn(locale)(`admin.journal.sections.${section}`)).not.toMatch(/^admin\.journal\./);
    });

    it("names a denied access", () => {
      expect(onlyIn(locale)("admin.journal.actions.denied")).not.toMatch(/^admin\.journal\./);
    });
  });
});
