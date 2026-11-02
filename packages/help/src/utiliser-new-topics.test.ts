import { describe, expect, it } from "vitest";
import { articles, helpCentreArticle, search } from "./index";
import { unknownQuotes } from "./quoted-labels";
import { HELP_LOCALES, type HelpArticleKind, type HelpLocale } from "./types";

/**
 * #556: « Utiliser Jobbbox », new topics: Email intake, the glossary of the AI and its consents, FAQ and tutorials, for
 * the Candidate, in French and English (ADR-0065).
 */
const NEW_ARTICLES: Record<string, HelpArticleKind> = {
  "tutorial-email-intake-forward": "tutorial",
  "faq-email-intake-what-is-read": "faq",
  "glossary-ai-coach": "glossary",
  "glossary-ai-activity": "glossary",
  "glossary-eu-ai-consent": "glossary",
  "glossary-redaction": "glossary",
  "glossary-coach-access": "glossary",
  "glossary-target-company": "glossary",
  "glossary-private-job-offer": "glossary",
  "faq-cv-formats": "faq",
  "faq-cv-templates": "faq",
  "faq-search-criteria": "faq",
  "faq-expired-job-offer": "faq",
  "faq-cover-letter-outreach": "faq",
  "faq-company-dossier": "faq",
  "faq-enriched-contacts": "faq",
  "tutorial-apply-tailored-cv": "tutorial",
  "tutorial-edit-restore-cv": "tutorial",
  "tutorial-book-coaching-session": "tutorial",
  "tutorial-interview-calendar": "tutorial",
};

/** The glossary of #556: its seven new entries, and Coach Memory's, already written. */
const GLOSSARY = [...Object.keys(NEW_ARTICLES).filter((id) => NEW_ARTICLES[id] === "glossary"), "glossary-coach-memory"];

describe("« Utiliser Jobbbox », new topics (#556)", () => {
  it.each(HELP_LOCALES)("serves each article in %s, for the Candidate, under « Utiliser Jobbbox »", (locale: HelpLocale) => {
    for (const [id, kind] of Object.entries(NEW_ARTICLES)) {
      const found = helpCentreArticle("utiliser", id, locale);
      expect([id, found?.kind, found?.audience]).toEqual([id, kind, "candidate"]);
    }
    expect(GLOSSARY).toHaveLength(8);
    for (const id of GLOSSARY) expect(helpCentreArticle("utiliser", id, locale)?.kind).toBe("glossary");
  });

  it("counts 2 Email intake articles, 7 FAQ and 4 tutorials besides, and the glossary's 8 entries", () => {
    const ids = Object.keys(NEW_ARTICLES);
    expect(ids.filter((id) => id.includes("email-intake"))).toHaveLength(2);
    expect(ids.filter((id) => NEW_ARTICLES[id] === "faq" && !id.includes("email-intake"))).toHaveLength(7);
    expect(ids.filter((id) => NEW_ARTICLES[id] === "tutorial" && !id.includes("email-intake"))).toHaveLength(4);
  });

  it.each(HELP_LOCALES)("quotes the interface word for word, in %s (ADR-0065)", (locale: HelpLocale) => {
    const ours = (entry: string) => Object.keys(NEW_ARTICLES).some((id) => entry.startsWith(`${id}: `));
    expect(unknownQuotes("utiliser", locale).missing.filter(ours)).toEqual([]);
  });

  it.each(HELP_LOCALES)("never says « anonymised » nor promises guaranteed security in a public article, in %s (#503)", (locale: HelpLocale) => {
    const said = articles(locale)
      .filter((article) => article.audience !== "administrator")
      .filter((article) => /anonymi[sz]|anonyme|anonymous|sécurité garantie|garantit la sécurité|guaranteed (security|safety)|security guaranteed/i.test(`${article.title}\n${article.body}`))
      .map((article) => article.id);
    expect(said).toEqual([]);
  });

  it("describes the identity's removal in #503's words, and both sides of European AI as the AI layer routes them, without a recommendation", () => {
    const redaction = helpCentreArticle("utiliser", "glossary-redaction", "fr")!;
    expect(redaction.body).toContain("Avant l'envoi, Jobbbox retire votre identité");
    expect(redaction.body).toMatch(/pseudonymisation/);
    expect(redaction.body).toMatch(/votre prénom reste/);
    const consent = helpCentreArticle("utiliser", "glossary-eu-ai-consent", "fr")!;
    expect(consent.body).toMatch(/^- Avec l'accord : .*Mistral AI, dans l'Union européenne/m);
    expect(consent.body).toMatch(/^- Sans l'accord : .*fournisseur habituel/m);
    // Every call is redacted, with or without the consent (packages/ai, ADR-0007 amendment).
    expect(consent.body).toContain("Dans les deux cas, avant l'envoi, Jobbbox retire votre identité de chaque demande");
    expect(consent.body).toContain("Aucun des deux choix n'est recommandé");
    expect(helpCentreArticle("utiliser", "glossary-eu-ai-consent", "en")!.body).toContain("Neither choice is recommended");
  });

  it.each(HELP_LOCALES)("links Email intake's FAQ to the privacy policy's AI section, in %s", (locale: HelpLocale) => {
    expect(helpCentreArticle("utiliser", "faq-email-intake-what-is-read", locale)?.body).toContain("](/legal/confidentialite#ia)");
  });

  it.each([
    ["fr", "Où est passé le losange vert ?"],
    ["fr", "Pourquoi suis-je bloqué à cinq tentatives ?"],
    ["fr", "Comment négocier mon salaire ?"],
    ["en", "Where did the green diamond go?"],
  ] as const)("leaves the Unanswered Questions' test question unanswered, in %s: « %s » (#344)", (locale, query) => {
    const ours = search(query, locale, { scope: "coachPanel" }).filter((article) => article.id in NEW_ARTICLES);
    expect(ours.map((article) => article.id)).toEqual([]);
  });

  it.each([
    ["fr", "transférer mes alertes", "tutorial-email-intake-forward"],
    ["fr", "quels mails lit jobbbox", "faq-email-intake-what-is-read"],
    ["fr", "coach intelligence artificielle", "glossary-ai-coach"],
    ["fr", "activité ia", "glossary-ai-activity"],
    ["fr", "mémoire du coach", "glossary-coach-memory"],
    ["fr", "ia européenne", "glossary-eu-ai-consent"],
    ["fr", "retirer mon identité", "glossary-redaction"],
    ["fr", "accès coach", "glossary-coach-access"],
    ["fr", "entreprise cible", "glossary-target-company"],
    ["fr", "offre privée", "glossary-private-job-offer"],
    ["fr", "format pdf", "faq-cv-formats"],
    ["fr", "modèle de cv", "faq-cv-templates"],
    ["fr", "critères de recherche", "faq-search-criteria"],
    ["fr", "offre expirée", "faq-expired-job-offer"],
    ["fr", "message d'approche", "faq-cover-letter-outreach"],
    ["fr", "dossier entreprise", "faq-company-dossier"],
    ["fr", "contacts enrichis", "faq-enriched-contacts"],
    ["fr", "postuler cv adapté", "tutorial-apply-tailored-cv"],
    ["fr", "restaurer mon cv", "tutorial-edit-restore-cv"],
    ["fr", "réserver une séance", "tutorial-book-coaching-session"],
    ["fr", "calendrier entretien", "tutorial-interview-calendar"],
    ["en", "forward my job alerts", "tutorial-email-intake-forward"],
    ["en", "eu ai consent", "glossary-eu-ai-consent"],
    ["en", "redaction", "glossary-redaction"],
    ["en", "private job offer", "glossary-private-job-offer"],
    ["en", "target company", "glossary-target-company"],
  ] as const)("finds, from a Candidate's Coach Panel, in %s, « %s »: %s", (locale, query, id) => {
    expect(search(query, locale, { scope: "coachPanel" }).map((article) => article.id)).toContain(id);
  });
});
