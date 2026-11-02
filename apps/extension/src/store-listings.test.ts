// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STORE_ORIGINS } from "./build-target";

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const LOCALES = ["fr", "en"] as const;
const listing = (locale: string) => readFileSync(`${extensionRoot}store/${locale}.md`, "utf8");
const catalogue = (locale: string) => JSON.parse(readFileSync(`${repoRoot}packages/shared/src/i18n/locales/${locale}.json`, "utf8"));
const messages = (locale: string) => JSON.parse(readFileSync(`${extensionRoot}public/_locales/${locale}/messages.json`, "utf8"));

/** Every string in a catalogue. */
const strings = (value: unknown): string[] =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];

/** The public and the beta listing of one language, split at « # Fiche beta » / « # Beta listing ». */
function listings(locale: string) {
  const text = listing(locale);
  const at = text.search(/^# (Fiche beta|Beta listing)$/m);
  expect(at).toBeGreaterThan(0);
  return { public: text.slice(0, at), beta: text.slice(at) };
}

/** A listing's summary: the paragraph under « Résumé » / « Summary ». */
const summaryOf = (text: string) => /^## (?:Résumé|Summary)[^\n]*\n\n([^\n]+)/m.exec(text)?.[1] ?? "";

// The Chrome Web Store listings' texts (#563, #501), kept in the repo in French and in English.
describe("the extension's store listings", () => {
  it.each(LOCALES)("%s: point to the privacy policy and the Help Centre's « L'extension » topic of their own web app", (locale) => {
    const { public: publicListing, beta } = listings(locale);
    for (const [text, origin] of [[publicListing, STORE_ORIGINS.public], [beta, STORE_ORIGINS.beta]] as const) {
      expect(text).toContain(`${origin}/legal/confidentialite`);
      expect(text).toContain(`${origin}/aide/extension`);
    }
    expect(publicListing).not.toContain("staging.jobbbox.ai");
  });

  it.each(LOCALES)("%s: the beta listing is unlisted and named after the beta build", (locale) => {
    const { public: publicListing, beta } = listings(locale);
    expect(beta).toMatch(locale === "fr" ? /\*\*Visibilité\*\* : non répertoriée/ : /\*\*Visibility\*\*: unlisted/);
    expect(publicListing).toMatch(locale === "fr" ? /\*\*Visibilité\*\* : publique/ : /\*\*Visibility\*\*: public/);
    expect(beta).toContain(`${locale === "fr" ? "**Nom** :" : "**Name**:"} ${messages(locale).extNameBeta.message}`);
  });

  it.each(LOCALES)("%s: each summary fits the store's 132 characters, the public one being the manifest's description", (locale) => {
    const { public: publicListing, beta } = listings(locale);
    for (const text of [publicListing, beta]) {
      expect(summaryOf(text)).not.toBe("");
      expect(summaryOf(text).length).toBeLessThanOrEqual(132);
    }
    expect(summaryOf(publicListing)).toBe(messages(locale).extDescription.message);
  });

  it.each(LOCALES)("%s: quotes the interface's labels word for word", (locale) => {
    const known = new Set(strings(catalogue(locale)));
    const quoted = [...listing(locale).matchAll(/« ([^»]+) »/g)].map((match) => match[1]!);
    expect(quoted.length).toBeGreaterThan(0);
    expect(quoted.filter((label) => !known.has(label))).toEqual([]);
  });
});
