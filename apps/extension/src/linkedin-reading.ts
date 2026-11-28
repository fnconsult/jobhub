/**
 * « Lire cette page LinkedIn » in the Side Panel (ADR-0119, #1164): on the Candidate's click, the LinkedIn page in view is
 * read once, in their browser (src/linkedin-page.ts, injected by `read`), and its Reading sent to Jobbbox, which keeps
 * each person's name, role and company as contacts of the Application or Target Company of that company. Never in the
 * background: nothing reads a page until the click.
 *
 *   const outcome = await readLinkedInTab({ read: () => injectInto(tabId), api });
 *   status(linkedInReadMessage(outcome, t));
 */
import type { LinkedInReading } from "@jobhub/shared";
import type { createI18n } from "@jobhub/shared/i18n";
import type { JobbboxApi, LinkedInReadingKept } from "./jobbbox-api";

export type LinkedInReadOutcome =
  | ({ state: "kept" } & LinkedInReadingKept)
  /** The page is not one a Reading may be of (a profile, a feed), it names no company, or the browser refused to read it. */
  | { state: "unreadable" }
  | { state: "failed"; error: "disabled" | "signed_out" | "refused" | "invalid" | "unreachable" };

export async function readLinkedInTab({
  read,
  api,
}: {
  /** Reads the page in view: its Reading, or null. */
  read: () => Promise<LinkedInReading | null>;
  api: Pick<JobbboxApi, "keepLinkedInReading">;
}): Promise<LinkedInReadOutcome> {
  const reading = await read().catch(() => null);
  if (!reading) return { state: "unreadable" };
  const kept = await api.keepLinkedInReading(reading);
  if (!kept.ok) return { state: "failed", error: kept.error };
  const { ok: _ok, ...where } = kept;
  return { state: "kept", ...where };
}

const FAILURES = {
  disabled: "extension.linkedIn.disabled",
  signed_out: "extension.signedOut",
  refused: "extension.installationNotRecognised",
  invalid: "extension.linkedIn.unreadable",
  unreachable: "extension.unreachable",
} as const;

/** What the Side Panel says once the page is read: where its people went, or why nothing was kept. */
export function linkedInReadMessage(outcome: LinkedInReadOutcome, t: ReturnType<typeof createI18n>["t"]): { text: string; error?: true } {
  if (outcome.state === "unreadable") return { text: t("extension.linkedIn.unreadable"), error: true };
  if (outcome.state === "failed") return { text: t(FAILURES[outcome.error]), error: true };
  const { company, peopleRead, peopleKept, filedIn } = outcome;
  if (peopleRead === 0) return { text: t("extension.linkedIn.nobodyNamed", { company }) };
  if (peopleKept === 0 || filedIn.length === 0) return { text: t("extension.linkedIn.notFiled", { company }) };
  const places = filedIn.map((place) => t(place.kind === "application" ? "extension.linkedIn.application" : "extension.linkedIn.targetCompany", { name: place.name })).join(", ");
  return { text: t("extension.linkedIn.kept", { count: peopleKept, company, places }) };
}
