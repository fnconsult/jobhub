import { getAuth, getMailer } from "@/auth/server";
import { sharedPool } from "@/database/pool";
import { createLegalTextNotices, sendsLegalTextNotices, type LegalTextNotices } from "./index";

let instance: LegalTextNotices | undefined;

/**
 * The app's Legal Text notices (#547), on the database named by DATABASE_URL. The web app shows the privacy policy's
 * change once and records it closed; the worker (apps/worker) emails the notices.
 */
export function getLegalTextNotices(): LegalTextNotices {
  instance ??= createLegalTextNotices(sharedPool(), { mailer: getMailer(), baseURL: String(getAuth().options.baseURL), production: sendsLegalTextNotices(process.env) });
  return instance;
}
