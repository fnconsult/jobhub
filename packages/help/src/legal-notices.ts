/**
 * The notice of a substantial Legal Text Version (ADR-0062, #547): each Candidate is emailed at least
 * LEGAL_NOTICE_DAYS days before it takes effect, and a substantial change to the privacy policy is shown once in the
 * app after it does. Pure: the CI check, the worker and the web app read the same rules.
 */
import type { LegalTextId, LegalTextVersion } from "./legal-texts";

/** How many days ahead a Candidate is told of a substantial version. */
export const LEGAL_NOTICE_DAYS = 30;

/** The Legal Texts whose substantial versions are noticed: the CGU, the CGV and the privacy policy, not the legal notice. */
export const NOTICED_LEGAL_TEXTS: readonly LegalTextId[] = ["cgu", "cgv", "confidentialite"];

/** `day` (`YYYY-MM-DD`) moved by `days` days. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The first effective date a substantial version merged on `day` may have: its notice must have its 30 days. */
export function earliestNoticedEffective(day: string): string {
  return addDays(day, LEGAL_NOTICE_DAYS);
}

/** Whether `version` is one Candidates are told of ahead: a substantial version of the CGU, the CGV or the privacy policy. */
export function isNoticed(version: Pick<LegalTextVersion, "text" | "change">): boolean {
  return version.change === "substantielle" && NOTICED_LEGAL_TEXTS.includes(version.text);
}

/**
 * The versions of `written` whose notice is to be emailed `on` that day: noticed, and not in effect yet. Sent as soon
 * as the Production deployment carrying them runs (the CI check made sure it had its 30 days at merge).
 */
export function legalNoticesDue<T extends Pick<LegalTextVersion, "text" | "change" | "effective">>(on: string, written: readonly T[]): T[] {
  return written.filter((version) => isNoticed(version) && version.effective > on);
}

/** The substantial version of the privacy policy whose change is shown once in the app `on` that day: the latest in effect; null for none. */
export function privacyChangeInEffect<T extends Pick<LegalTextVersion, "text" | "change" | "effective">>(on: string, written: readonly T[]): T | null {
  return (
    written
      .filter((version) => version.text === "confidentialite" && version.change === "substantielle" && version.effective <= on)
      .sort((a, b) => b.effective.localeCompare(a.effective))[0] ?? null
  );
}
