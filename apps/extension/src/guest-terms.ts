/**
 * The Guest's box (ADR-0062, #550): before the first CV a Guest session sends, the Guest accepts the CGU for guests
 * (the version in effect, which the web app names) and says they read the information on their data. The box is
 * never ticked for them. What they accepted, the version and when, stays in the Guest session, in this browser only:
 * no request carries it, and it goes with the session. While no CGU version is in effect, there is no box.
 *
 * And the Side Panel's foot: Aide, Confidentialité and CGU, on the web app, in the browser's language.
 */

/** The CGU version in effect, as the web app names it: its id (the effective date, YYYY-MM-DD) and permanent URL. */
export interface CguVersion {
  version: string;
  url: string;
}

/** What the Guest accepted, kept in the Guest session: the CGU version, and when (ms since the epoch). */
export interface GuestTermsAcceptance {
  version: string;
  acceptedAt: number;
}

/** The CGU version the Guest must accept before sending a CV: the one in effect, unless already accepted in this session. */
export function guestTermsToAccept(inEffect: CguVersion | null, accepted: GuestTermsAcceptance | undefined): CguVersion | null {
  if (!inEffect) return null;
  return accepted?.version === inEffect.version ? null : inEffect;
}

/** A version's day as the box names it: « 01/12/2026 » in French, as the Legal Texts write it; written out otherwise. */
export function versionDay(version: string, language: string): string {
  if (language === "fr") return version.split("-").reverse().join("/");
  return new Intl.DateTimeFormat(language, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${version}T00:00:00Z`));
}

/** The web app's language for a browser's: English under `/en` (#545), French otherwise. */
export function siteLanguage(browserLanguage: string | undefined): "fr" | "en" {
  return browserLanguage?.toLowerCase().startsWith("en") ? "en" : "fr";
}

/** A public page of the web app, in `language`: the same French slug, under `/en` in English. */
export function siteHref(webOrigin: string, path: string, language: "fr" | "en"): string {
  return `${webOrigin}${language === "en" ? "/en" : ""}${path}`;
}

/** The two links of the box: the CGU's section for guests, and the privacy policy. */
export const GUEST_TERMS_LINKS = { terms: "/legal/cgu#invite", privacy: "/legal/confidentialite" } as const;

/** The Side Panel's foot, in this order: the Help Centre's « L'extension » topic, the privacy policy, the CGU. */
export const SIDE_PANEL_LINKS = [
  { key: "help", path: "/aide/extension" },
  { key: "privacy", path: "/legal/confidentialite" },
  { key: "terms", path: "/legal/cgu" },
] as const;

/**
 * A sentence cut where its `{{name}}` placeholders stand, so each can be drawn as a link: its text parts and the
 * names, in order. `marker(name)` is what `t` put in the placeholder's place.
 */
export type SentencePart = { text: string } | { slot: string };

export function sentenceParts(sentence: string, slots: readonly string[], marker: (slot: string) => string): SentencePart[] {
  const parts: SentencePart[] = [];
  let rest = sentence;
  while (rest) {
    const found = slots
      .map((slot) => ({ slot, at: rest.indexOf(marker(slot)) }))
      .filter(({ at }) => at >= 0)
      .sort((a, b) => a.at - b.at)[0];
    if (!found) {
      parts.push({ text: rest });
      break;
    }
    if (found.at > 0) parts.push({ text: rest.slice(0, found.at) });
    parts.push({ slot: found.slot });
    rest = rest.slice(found.at + marker(found.slot).length);
  }
  return parts;
}
