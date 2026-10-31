import { SUPPORTED_LOCALES, type Locale } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { mailClientLint } from "./mail-client-lint";
import { EMAIL_NAMES, sampleEmails, type EmailName } from "./samples";

/**
 * Each of the eight emails, rendered in both Interface Languages from its sample (./samples), checked in both parts:
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
  followUp: {
    fr: ["Votre candidature « DAF H/F » est restée sans réponse", "Lire la relance", "https://app.jobbbox.fr/candidatures/application-1", "Modifier mes délais de relance", "https://app.jobbbox.fr/compte/relances"],
    en: ['Your application "DAF H/F" has had no answer', "Read the follow-up", "https://app.jobbbox.fr/candidatures/application-1", "Change my follow-up delays", "https://app.jobbbox.fr/compte/relances"],
  },
  appointmentReminder: {
    fr: [
      "mercredi 21 octobre 2026",
      "09:00 · Entretien : DAF H/F chez Acme Industrie",
      "Format : Sur place",
      "Lieu ou lien : 12 rue de la République, Lyon",
      "Durée : 60 min",
      "14:30 · Séance de coaching avec Sophie Martin",
      "Lien : https://meet.example/abc",
      "Ouvrir mon agenda",
      "https://app.jobbbox.fr/agenda?vue=liste",
      "Ne plus recevoir ces rappels",
      "https://app.jobbbox.fr/compte/rappels",
    ],
    en: [
      "Wednesday, October 21, 2026",
      "9:00 AM · Interview: DAF H/F at Acme Industrie",
      "Place or link: 12 rue de la République, Lyon",
      "Duration: 60 min",
      "2:30 PM · Coaching session with Sophie Martin",
      "Open my agenda",
      "https://app.jobbbox.fr/agenda?vue=liste",
      "Stop receiving these reminders",
      "https://app.jobbbox.fr/compte/rappels",
    ],
  },
  appleFailureAlert: {
    fr: ["apple", "La clé .p8 ou un identifiant enregistré ne permet pas de signer le secret", "Ouvrir l'onglet Connexion", "https://app.jobbbox.fr/admin/parametres?tab=connexion", "super-admin"],
    en: ["apple", "The .p8 key or a saved ID cannot sign the secret", "Open the Sign-in tab", "https://app.jobbbox.fr/admin/parametres?tab=connexion", "super-admin"],
  },
  webSearchSpendAlert: {
    fr: ["2,40", "2,00", "2026-10", "Rien n'est coupé", "Voir le détail dans Consommation IA", "https://app.jobbbox.fr/admin/consommation-ia?periode=2026-10", "super-admin"],
    en: ["€2.40", "€2.00", "2026-10", "Nothing is cut", "See the details in Consommation IA", "https://app.jobbbox.fr/admin/consommation-ia?periode=2026-10", "super-admin"],
  },
  quotaReduction: {
    fr: [
      "Le 14 novembre 2026, ce que comprend votre offre Standard va baisser",
      "Recherches d'offres",
      "Aujourd'hui : 7 par semaine",
      "À partir du 14 novembre 2026 : 3 par semaine",
      "Aujourd'hui : Illimité",
      "Séances de coaching à prix réduit",
      "Pourquoi : Les recherches d'offres coûtent plus cher à nos fournisseurs.",
      "jusqu'au 14 décembre 2026 inclus",
      "Résilier sans frais",
      "https://app.jobbbox.fr/abonnement/baisse",
    ],
    en: [
      "On November 14, 2026, what your Standard plan includes will go down",
      "Today: 7 a week",
      "From November 14, 2026: 3 a week",
      "Today: Unlimited",
      "Coaching sessions at a reduced price",
      "up to and including December 14, 2026",
      "Cancel at no cost",
      "https://app.jobbbox.fr/abonnement/baisse",
    ],
  },
  abandonedFollowUp: {
    fr: ["Vos relances pour « DAF H/F » sont restées sans réponse", "Ouvrir la candidature", "https://app.jobbbox.fr/candidatures/application-1", "https://app.jobbbox.fr/compte/relances"],
    en: ['Your follow-ups for "DAF H/F" have had no answer', "Open the application", "https://app.jobbbox.fr/candidatures/application-1", "https://app.jobbbox.fr/compte/relances"],
  },
};

const unescape = (html: string) => html.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe.each(SUPPORTED_LOCALES)("the eight emails in %s", (language) => {
  const emails = sampleEmails(language);

  it("are the eight", () => {
    expect(EMAIL_NAMES).toHaveLength(8);
    expect(Object.keys(emails).sort()).toEqual([...EMAIL_NAMES].sort());
    expect(Object.keys(facts).sort()).toEqual([...EMAIL_NAMES].sort());
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
