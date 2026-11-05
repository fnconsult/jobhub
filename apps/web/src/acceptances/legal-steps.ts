/**
 * The legal steps of the Jobbbox app (#689, ADR-0076): what its native screen asks after sign-in, as the web asks it.
 * `legalSteps` turns what the Candidate has left to see (the CGU version to accept, the privacy policy's change to
 * show once, the EU AI Consent) into what the app shows: each Legal Text Version in the app's language, its bodies the
 * repo's Markdown with the contact address filled in (`contactEmail`, "" while none is set), the French version where
 * the build carries no translation.
 */
import { legalText, legalTextVersionUrl, type HelpLocale, type LegalTextId, type LegalTextVersion } from "@jobhub/help";
import type { LegalStepsResponse, ShownLegalTextRead } from "@jobhub/shared/reads";
import { withPublicContactEmail } from "@/public-pages/contact-email";

export interface LegalStepsDue {
  /** The CGU version to accept now (Acceptances' `pending`), or null. */
  cgu: { version: string } | null;
  /** The privacy policy's change still to show (Legal Text notices' `privacyChange`), or null. */
  privacyChange: { version: string } | null;
  euAiConsentGiven: boolean;
}

export function legalSteps(
  due: LegalStepsDue,
  locale: HelpLocale,
  { on, written, contactEmail }: { on: string; written?: Record<HelpLocale, readonly LegalTextVersion[]>; contactEmail: string },
): LegalStepsResponse {
  function shown(text: LegalTextId, version: string): ShownLegalTextRead | null {
    const found = legalText(text, locale, { on, version }, written?.[locale]) ?? (locale === "fr" ? null : legalText(text, "fr", { on, version }, written?.fr));
    if (!found) return null;
    const filled = withPublicContactEmail(found, contactEmail).version;
    return {
      version: filled.effective,
      url: legalTextVersionUrl(text, filled.effective),
      title: filled.title,
      translation: filled.locale !== "fr",
      inBrief: filled.inBrief,
      sections: filled.sections.map((section) => ({ title: `${section.number}. ${section.title}`, body: section.body })),
    };
  }
  return {
    acceptance: due.cgu ? shown("cgu", due.cgu.version) : null,
    privacyChange: due.privacyChange ? shown("confidentialite", due.privacyChange.version) : null,
    euAiConsentGiven: due.euAiConsentGiven,
  };
}
