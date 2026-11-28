import { getMailer } from "@/auth/server";
import { sharedPool } from "@/database/pool";
import { coachSendsPerDay } from "@/coach-actions/settings";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { createSends, type Sends } from "./index";

let instance: Sends | undefined;

/**
 * The app's Sends (ADR-0119, #1162), on the database named by DATABASE_URL, through the app's mailer (Brevo, from
 * MAIL_FROM's address), capped at COACH_SENDS_PER_DAY, read at each send. Offered behind COACH_SEND_ENABLED:
 * see `coachSendOn`.
 */
export function getSends(): Sends {
  instance ??= createSends(sharedPool(), { mailer: getMailer(), cap: () => coachSendsPerDay(getPlatformSettingsResolver().current()) });
  return instance;
}
