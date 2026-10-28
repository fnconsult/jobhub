import { SUPPORTED_LOCALES, type Locale } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { mailClientLint } from "./mail-client-lint";
import { EMAIL_NAMES, sampleEmails, type EmailName } from "./samples";

/**
 * Each of the seven emails, rendered in both Interface Languages from its sample (./samples), checked in both parts:
 * the same facts and links in the text and the HTML, in the right language, the HTML passing the mail-client lint.
 */
const greeting: Record<Locale, string> = { fr: "Bonjour,", en: "Hello," };

/** What each email must say, in both parts, per language: facts from its sample, and its links. */
const facts: Record<EmailName, Record<Locale, string[]>> = {
  signIn: {
    fr: ["https://app.jobbbox.fr/api/auth/magic-link/verify?token=abc", "15 minutes", "Me connecter à Jobbbox"],
    en: ["https://app.jobbbox.fr/api/auth/magic-link/verify?token=abc", "15 minutes", "Sign in to Jobbbox"],
  },
  jobDigest: {
    fr: [
      "Directrice administrative et financière",
      "DAF H/F",
      "Acme Industrie, Lyon",
      "score de correspondance : 92 / 100",
      "publiée le 20 octobre 2026",
      "score de correspondance : 64 / 100, partiel",
      "date de publication : date inconnue",
      "https://app.jobbbox.fr/offres/offer-1?profil=profile-1",
      "Voir les 12 offres",
      "https://app.jobbbox.fr/job-digests/digest-1",
      "Ne plus recevoir le Job Digest de ce profil",
      "https://app.jobbbox.fr/desabonnement?token=t0k3n&lang=fr",
    ],
    en: [
      "Directrice administrative et financière",
      "DAF H/F",
      "match score: 92 / 100",
      "posted on October 20, 2026",
      "match score: 64 / 100, partial",
      "posting date: date unknown",
      "See the 12 job offers",
      "https://app.jobbbox.fr/job-digests/digest-1",
      "Stop receiving this profile's Job Digest",
      "https://app.jobbbox.fr/desabonnement?token=t0k3n&lang=en",
    ],
  },
};

const unescape = (html: string) => html.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe.each(SUPPORTED_LOCALES)("the seven emails in %s", (language) => {
  const emails = sampleEmails(language);

  it("are the seven", () => {
    expect(Object.keys(emails).sort()).toEqual([...EMAIL_NAMES].sort());
  });

  describe.each(Object.keys(facts) as EmailName[])("%s", (name) => {
    const { subject, text, html } = emails[name];

    it("says its facts and links in both parts", () => {
      for (const fact of facts[name][language]) {
        expect(text, "text part").toContain(fact);
        expect(unescape(html), "HTML part").toContain(fact);
      }
    });

    it("speaks the Interface Language, every string translated", () => {
      expect(text.startsWith(`${greeting[language]}\n\n`)).toBe(true);
      expect(html).toContain(`<html lang="${language}"`);
      expect(html).toContain(`>${greeting[language]}</p>`);
      for (const part of [subject, text, html]) expect(part).not.toMatch(/\{\{|\b(emails|signInEmail|jobDigest|followUps|appointmentReminder|appleAlert|webSearchAlert)\.[a-z]/);
    });

    it("has a footer saying why it came, and an HTML part that passes the mail-client lint", () => {
      expect(text).toMatch(/\n\n--\n.+/);
      expect(mailClientLint(html)).toEqual([]);
    });
  });
});
