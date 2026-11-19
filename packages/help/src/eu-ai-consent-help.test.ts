import { describe, expect, it } from "vitest";
import { article, motionScript } from "./index";
import { HELP_LOCALES, type HelpLocale } from "./types";

/**
 * #1052: the Help that tells a Candidate about the EU AI Consent offered before their CV is read. Two things it must
 * not get wrong, since it is read where the consent is asked:
 * - every AI call is redacted, consent or not (packages/ai/src/ai-layer.ts), so taking the identity out is never what
 *   « Pas maintenant » alone does;
 * - the no-CV way in (« Répondre aux questions de mon coach ») says it is for a Candidate without a CV, so it never
 *   reads as what to do once the consent is answered.
 */
const WORDS = {
  fr: {
    notNow: "« Pas maintenant »",
    noCvButton: "« Répondre aux questions de mon coach »",
    noCv: /\bsans CV\b/i,
    identityRemoved: /retir\w*[^.]*identité|identité[^.]*retir\w*/i,
    bothChoices: /dans les deux cas/i,
  },
  en: {
    notNow: "« Not now »",
    noCvButton: "« Answer my coach's questions »",
    noCv: /\bwithout a CV\b/i,
    identityRemoved: /remov\w*[^.]*identity|tak\w*[^.]*identity[^.]*\bout\b|identity[^.]*(remov\w*|tak\w* out)/i,
    bothChoices: /either way/i,
  },
} as const;

/** Sentences of a Help text: split after `.`, `?` or `!` followed by a space and a capital, a digit or a quote. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+(?=[«A-ZÀ-Ý0-9])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function texts(locale: HelpLocale): { name: string; text: string }[] {
  const ids = ["page-new-profile", "tutorial-getting-started", "glossary-eu-ai-consent"];
  const fromArticles = ids.map((id) => {
    const found = article(id, locale);
    if (!found) throw new Error(`No ${id} article in ${locale}`);
    return { name: `article ${id}`, text: found.body };
  });
  const motion = motionScript("commencer", locale);
  if (!motion) throw new Error(`No commencer motion in ${locale}`);
  return [...fromArticles, ...motion.steps.map((step) => ({ name: `motion commencer, « ${step.title} »`, text: step.narration }))];
}

describe("the Help on the EU AI Consent offered before the CV is read (#1052)", () => {
  it.each(HELP_LOCALES)("never says only « Pas maintenant » takes the identity out (%s)", (locale: HelpLocale) => {
    const words = WORDS[locale];
    const wrong = texts(locale).flatMap(({ name, text }) =>
      sentences(text)
        .filter((sentence) => sentence.includes(words.notNow) && words.identityRemoved.test(sentence) && !words.bothChoices.test(sentence))
        .map((sentence) => `${name}: ${sentence}`),
    );
    expect(wrong).toEqual([]);
  });

  it.each(HELP_LOCALES)("says the identity is taken out with either answer, where it explains them (%s)", (locale: HelpLocale) => {
    const words = WORDS[locale];
    for (const { name, text } of texts(locale)) {
      if (!text.includes(words.notNow)) continue;
      const said = sentences(text).some((sentence) => words.bothChoices.test(sentence) && words.identityRemoved.test(sentence));
      expect(said, `${name} explains ${words.notNow} without saying the identity is taken out either way`).toBe(true);
    }
  });

  it.each(HELP_LOCALES)("names the no-CV case wherever it quotes the no-CV button (%s)", (locale: HelpLocale) => {
    const words = WORDS[locale];
    const all = texts(locale).flatMap(({ name, text }) =>
      sentences(text)
        .filter((sentence) => sentence.includes(words.noCvButton))
        .map((sentence) => ({ name, sentence })),
    );
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.filter(({ sentence }) => !words.noCv.test(sentence)).map(({ name, sentence }) => `${name}: ${sentence}`)).toEqual([]);
  });
});
