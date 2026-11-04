import { sharedPool } from "@/database/pool";
import { currentState } from "@/tools/server";
import { datedRecipientList, recipientsSwitchedOn, type DatedRecipientList } from "./index";

/**
 * The Recipient list now, from the Tools' state in use (as Outils reads it). Undated without a database, or when the
 * day it changed cannot be read: the list is still shown, a public notice never fails for want of its date.
 */
export async function recipientListNow(now: Date = new Date()): Promise<Omit<DatedRecipientList, "changedAt"> & { changedAt: Date | null }> {
  const recipients = recipientsSwitchedOn(await currentState());
  if (!process.env.DATABASE_URL) return { recipients, changedAt: null };
  try {
    return await datedRecipientList(sharedPool(), recipients, now);
  } catch (error) {
    console.error("[recipient-list] the day the list changed could not be read", error);
    return { recipients, changedAt: null };
  }
}
