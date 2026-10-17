import { createI18n } from "@jobhub/shared/i18n";
import { routes } from "../routes";

/** Why Apple's client secret could not be signed again. */
export type AppleFailureReason = "missing_secret" | "invalid_apple_key" | "no_master_key";

/**
 * The email the super-admins get when the worker could not sign Apple's client secret
 * again: the sign-in with Apple stops working when the one in use expires. In French,
 * the Jobbbox team's language. Names no secret.
 */
export function appleFailureEmail(failed: readonly { id: string; reason: AppleFailureReason }[], appUrl: string): { subject: string; text: string } {
  const { t } = createI18n("fr");
  const lines = failed.map(({ id, reason }) => `- ${id} : ${t(`appleAlert.reasons.${reason}`)}`);
  return {
    subject: t("appleAlert.subject"),
    text: t("appleAlert.body", { failures: lines.join("\n"), url: new URL(routes.adminSignInProviders, appUrl).toString() }),
  };
}
