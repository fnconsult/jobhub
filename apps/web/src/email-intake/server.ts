import { sharedPool } from "@/database/pool";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { emailIntakeDomain } from "./domain";
import { createEmailIntake, type EmailIntake } from "./index";

let instance: EmailIntake | undefined;

/** The app's Email intake, on the database named by DATABASE_URL, giving addresses on the EMAIL_INTAKE_DOMAIN in use. */
export function getEmailIntake(): EmailIntake {
  instance ??= createEmailIntake(sharedPool(), { domain: () => emailIntakeDomain(getPlatformSettingsResolver().current()) });
  return instance;
}
