import { sharedPool } from "@/database/pool";
import { getJobQueue } from "@/job-queue/server";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { secretCipherFromEnv, type SecretCipher } from "@/provider-secrets/cipher";
import { getSecretResolver } from "@/provider-secrets/server";
import { emailIntakeDomain, emailIntakeLimits } from "./domain";
import { createEmailIntakeInbound, type EmailIntakeInbound } from "./inbound";
import { createEmailIntake, type EmailIntake } from "./index";

let instance: EmailIntake | undefined;
let inbound: EmailIntakeInbound | undefined;
let cipher: SecretCipher | null | undefined;

/** The app's Email intake, on the database named by DATABASE_URL, giving addresses on the EMAIL_INTAKE_DOMAIN in use. */
export function getEmailIntake(): EmailIntake {
  instance ??= createEmailIntake(sharedPool(), { domain: () => emailIntakeDomain(getPlatformSettingsResolver().current()) });
  return instance;
}

/**
 * Email intake's door for Brevo Inbound Parsing (#442): the BREVO_INBOUND_SECRET in use (Clés, else env), Email intake's
 * limits in use (Paramètres, else env), texts sealed under SECRETS_MASTER_KEYS, emails to read queued for the worker.
 */
export function getEmailIntakeInbound(): EmailIntakeInbound {
  inbound ??= createEmailIntakeInbound(sharedPool(), {
    emailIntake: getEmailIntake(),
    cipher: () => (cipher ??= secretCipherFromEnv(process.env)),
    queue: getJobQueue(),
    settings: () => {
      const { dailyCap, brevoIpRanges } = emailIntakeLimits(getPlatformSettingsResolver().current());
      return { secret: getSecretResolver().current().env.BREVO_INBOUND_SECRET, brevoIpRanges, dailyCap };
    },
  });
  return inbound;
}
