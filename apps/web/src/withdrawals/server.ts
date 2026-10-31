import { getAuth, getMailer } from "@/auth/server";
import { getBilling } from "@/billing/server";
import { sharedPool } from "@/database/pool";
import { getHumanCoaches } from "@/human-coaches/server";
import { createWithdrawals, type Withdrawals } from "./index";

let instance: Withdrawals | undefined;

/** The app's Withdrawals (#511), on the database named by DATABASE_URL: Stripe through billing, emails through the app's mailer. */
export function getWithdrawals(): Withdrawals {
  instance ??= createWithdrawals(sharedPool(), { billing: getBilling(), humanCoaches: getHumanCoaches(), mailer: getMailer(), baseURL: String(getAuth().options.baseURL) });
  return instance;
}
