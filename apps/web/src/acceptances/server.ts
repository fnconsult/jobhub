import type { LegalTextVersionRecord } from "@jobhub/help";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "@/auth/server";
import { sharedPool } from "@/database/pool";
import { REQUEST_PATH_HEADER } from "@/request-path";
import { acceptanceHref, openWhilePending } from "./gate";
import { createAcceptances, type Acceptances } from "./index";

let instance: Acceptances | undefined;

/** The app's Acceptances, on the database named by DATABASE_URL, their pseudonyms keyed with AUTH_SECRET. */
export function getAcceptances(): Acceptances {
  instance ??= createAcceptances(sharedPool(), { secret: String(getAuth().options.secret) });
  return instance;
}

/**
 * The CGU version the Candidate must accept before going on, read once per request. Never fails a page: when it
 * cannot be read, nothing is asked (and the error is logged).
 */
export const pendingAcceptance = cache(async (candidateId: string): Promise<LegalTextVersionRecord | null> => {
  try {
    return await getAcceptances().pending(candidateId);
  } catch (error) {
    console.error("[acceptances] could not read the CGU version to accept", error);
    return null;
  }
});

/**
 * For every page of a signed-in Candidate: while a CGU version waits for their Acceptance, sends them to the
 * Acceptance screen, to come back to this page, unless it stays open (their data, their subscription, see gate.ts).
 */
export async function requireAcceptedTerms(candidateId: string): Promise<void> {
  if (!(await pendingAcceptance(candidateId))) return;
  const path = (await headers()).get(REQUEST_PATH_HEADER);
  if (path && openWhilePending(path)) return;
  redirect(acceptanceHref(path));
}
