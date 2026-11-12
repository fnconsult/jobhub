/**
 * What the browser knows of a Profile's creation (ADR-0070, #810) while the Candidate creates it on `/profils/nouveau`,
 * for « Création du profil » in Activity (entries.ts): the uploaded CV read, the AI Coach's onboarding interview (#1002)
 * with its Provenance, the scripted Onboarding Questionnaire when it takes over, the Profile
 * born during it (ADR-0106, #999), the review and, once saved, the Profile's page. Held in memory only, so a page loaded again knows none of it: nothing new is kept of
 * the questionnaire's timing.
 *
 *   nextCreation(was, note, at)        what is known after `note`, made at `at`
 *   creationOnPage(creation, pathname)  what the page's Activity is given: while not saved, on `/profils/nouveau` only
 *
 * Pure, and safe in the browser.
 */
import type { Provenance } from "@jobhub/shared";
import { routes } from "../routes";
import type { CreationGiven } from "./entries";

/**
 * What the creation page says as the Candidate goes: a creation started (or started over: nothing known), the CV read
 * with its draft's Provenance, the interview's answers so far with its turns' Provenance (#1002), the questionnaire's
 * answers so far, the Profile born once its target role and location are
 * answered (#999, `href` its page), the review opened, the Profile saved at its page.
 */
export type CreationNote =
  | { type: "started" }
  | { type: "read"; provenance: Provenance | null }
  | { type: "interviewed"; answered: number; skipped: number; provenance: Provenance | null }
  | { type: "answered"; answered: number; skipped: number }
  | { type: "created"; href: string }
  | { type: "reviewed" }
  | { type: "saved"; href: string };

/** What is known after `note`: the questionnaire from when it started, the review from when it first opened. */
export function nextCreation(was: CreationGiven | null, note: CreationNote, at: string): CreationGiven {
  const known = was ?? {};
  switch (note.type) {
    case "started":
      return {};
    case "read":
      return { ...known, reading: { provenance: note.provenance } };
    case "interviewed":
      return { ...known, interview: { at: known.interview?.at ?? at, answered: note.answered, skipped: note.skipped, provenance: note.provenance } };
    case "answered":
      return { ...known, questionnaire: { at: known.questionnaire?.at ?? at, answered: note.answered, skipped: note.skipped } };
    case "created":
      return { ...known, created: known.created ?? { at, href: note.href } };
    case "reviewed":
      return { ...known, review: known.review ?? { at } };
    case "saved":
      return { ...known, href: note.href };
  }
}

/** What the page's Activity is given: a creation not saved shows on `/profils/nouveau` only, a saved one on its Profile's page. */
export function creationOnPage(creation: CreationGiven | null, pathname: string): CreationGiven | undefined {
  if (!creation) return undefined;
  return creation.href || pathname === routes.newProfile ? creation : undefined;
}
