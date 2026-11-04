import { sharedPool } from "@/database/pool";
import { currentState } from "@/tools/server";
import { datedRecipientList, recipientsSwitchedOn, type DatedRecipientList } from "./index";

/** The Recipient list now, from the Tools' state in use (as Outils reads it); undated without a database. */
export async function recipientListNow(now: Date = new Date()): Promise<Omit<DatedRecipientList, "changedAt"> & { changedAt: Date | null }> {
  const recipients = recipientsSwitchedOn(await currentState());
  if (!process.env.DATABASE_URL) return { recipients, changedAt: null };
  return datedRecipientList(sharedPool(), recipients, now);
}
