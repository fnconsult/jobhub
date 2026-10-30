import { getAuth, getMailer } from "@/auth/server";
import { getBilling } from "@/billing/server";
import { sharedPool } from "@/database/pool";
import { createQuotaReductions, type QuotaReductions } from "./index";

let instance: QuotaReductions | undefined;

/**
 * The app's Quota Reductions (#514), on the database named by DATABASE_URL. The Back Office schedules and cancels them,
 * the Candidate cancels over one on /abonnement; the worker (apps/worker) applies them and e-mails the notices.
 */
export function getQuotaReductions(): QuotaReductions {
  instance ??= createQuotaReductions(sharedPool(), { billing: getBilling(), mailer: getMailer(), baseURL: String(getAuth().options.baseURL) });
  return instance;
}
