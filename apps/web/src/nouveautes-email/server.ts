import { getAuth, getMailer } from "@/auth/server";
import { sharedPool } from "@/database/pool";
import { builtVersion, currentRelease } from "@/release";
import { createNouveautesEmails, type NouveautesEmails } from "./index";

let instance: NouveautesEmails | undefined;

/**
 * The app's Nouveautés email (#566), on the database named by DATABASE_URL. The web app keeps the Candidate's choice
 * and unsubscribes from the email's link; the worker (apps/worker) sends it, from Production only.
 */
export function getNouveautesEmails(): NouveautesEmails {
  instance ??= createNouveautesEmails(sharedPool(), {
    mailer: getMailer(),
    baseURL: String(getAuth().options.baseURL),
    production: !currentRelease(process.env).beta,
    version: builtVersion,
  });
  return instance;
}
