import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { TwoStepVerificationSettings } from "@/components/TwoStepVerificationSettings";
import { getRequestLocale } from "@/i18n/server";
import { getTwoStepVerification, mustHaveIt } from "@/two-step-verification/server";

/** Mon compte's « Sécurité » Section (#663): Two-step verification, which an Administrator or a Human Coach cannot turn off (#665). */
export default async function AccountSecurityPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const [status, mandatory, locale] = await Promise.all([getTwoStepVerification().status(candidate.id), mustHaveIt(candidate.id), getRequestLocale()]);
  return <TwoStepVerificationSettings status={status} locale={locale} mandatory={mandatory} />;
}
