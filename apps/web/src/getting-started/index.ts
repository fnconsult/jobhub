/**
 * « Pour bien commencer » (#1069): what the help reads of a Candidate's account on the server, for the selection that
 * `@jobhub/help` makes (`gettingStarted`). Read only while the account is in its first 14 days; after, null, and nothing
 * is read. Nothing leaves the account: the dates and yes-or-no it reads are the Candidate's own.
 *
 *   readGettingStarted(database, candidate, { extensionPublished, now }) // GettingStartedAccount, or null after 14 days
 */
import { gettingStartedOpen } from "@jobhub/help/coach-help";
import type { GettingStartedResponse } from "@jobhub/shared/reads";
import type { Queryable } from "../database/pool";

/** The account as « Pour bien commencer » reads it, as `GET /api/account/getting-started` sends it (a `GettingStartedAccount`). */
export type GettingStartedRead = NonNullable<GettingStartedResponse["account"]>;

/**
 * The account of `candidate` as « Pour bien commencer » reads it: when it was created, whether an ATS Score exists for
 * one of its CVs, whether it has a Capture from the extension (an Extension Event « capture » of theirs, or an Offer box
 * entry whose Arrival source is « Extension »), and whether the extension is published (`extensionPublished`, from
 * EXTENSION_STORE_URL). Null once the account's 14 days are over at `now`.
 */
export async function readGettingStarted(
  database: Queryable,
  candidate: { id: string; createdAt: Date },
  { extensionPublished, now }: { extensionPublished: boolean; now: Date },
): Promise<GettingStartedRead | null> {
  if (!gettingStartedOpen(candidate.createdAt, now)) return null;
  const { rows } = await database.query<{ ats_score: boolean; extension_capture: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ats_score s JOIN profile p ON p.id = s.profile_id WHERE p.candidate_id = $1) AS ats_score,
            EXISTS (SELECT 1 FROM extension_event WHERE candidate_id = $1 AND kind = 'capture')
              OR EXISTS (SELECT 1 FROM offer_box_entry WHERE candidate_id = $1 AND arrival_sources ? 'extension') AS extension_capture`,
    [candidate.id],
  );
  return {
    createdAt: candidate.createdAt.toISOString(),
    atsScore: rows[0]!.ats_score,
    extensionCapture: rows[0]!.extension_capture,
    extensionPublished,
  };
}
