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
  // The Back Office is built while sign-in is (Sign-in Providers record to it): the base URL is asked of auth only when
  // an e-mail goes, never while building.
  instance ??= createQuotaReductions(sharedPool(), { billing: getBilling(), mailer: getMailer(), baseURL: () => String(getAuth().options.baseURL) });
  return instance;
}
