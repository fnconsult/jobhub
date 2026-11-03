import { DEFAULT_LOCALE, isSupportedLocale } from "@jobhub/shared/i18n";
import { permanentSuperAdminsFromEnv } from "@/admin/access";
import { getAuth, getMailer } from "@/auth/server";
import { getExternalApiLog } from "@/ai-usage/external-api-log";
import { sharedPool } from "@/database/pool";
import { routes } from "@/routes";
import { twoStepChangeEmail, type TwoStepChange } from "./email";
import { createTwoStepVerification, type TwoStepVerification } from "./index";
import { mustHaveTwoStepVerification } from "./obligation";
import { relyingPartyOf } from "./passkeys";

let instance: TwoStepVerification | undefined;

/**
 * The app's Two-step verification, on the database named by DATABASE_URL, its secrets encrypted with AUTH_SECRET, its
 * passkeys made for APP_URL's host.
 */
export function getTwoStepVerification(): TwoStepVerification {
  const { secret, baseURL } = getAuth().options;
  instance ??= createTwoStepVerification(sharedPool(), { secret: String(secret), relyingParty: relyingPartyOf(String(baseURL)), externalApis: getExternalApiLog() });
  return instance;
}

/** Whether the Candidate must have Two-step verification now (#665): an Administrator (ADMIN_EMAILS included) or a Human Coach. */
export function mustHaveIt(candidateId: string): Promise<boolean> {
  return mustHaveTwoStepVerification(sharedPool(), candidateId, permanentSuperAdminsFromEnv(process.env).emails);
}

/**
 * Emails the account that its Two-step verification was turned on or off, or reset by a super-admin, in its Interface
 * Language. Never fails the change: an email that could not go is logged.
 */
export async function tellTwoStepChange(candidate: { email: string; interfaceLanguage?: unknown }, change: TwoStepChange): Promise<void> {
  try {
    const securityUrl = new URL(routes.accountSecurity, String(getAuth().options.baseURL)).toString();
    const language = isSupportedLocale(candidate.interfaceLanguage) ? candidate.interfaceLanguage : DEFAULT_LOCALE;
    await getMailer().send({ to: candidate.email, ...twoStepChangeEmail({ change, at: new Date(), securityUrl }, language) });
  } catch (error) {
    console.error("[two-step-verification] the change could not be emailed", error);
  }
}
