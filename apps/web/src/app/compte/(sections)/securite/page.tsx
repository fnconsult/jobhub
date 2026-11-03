import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { TwoStepVerificationSettings } from "@/components/TwoStepVerificationSettings";
import { getRequestLocale } from "@/i18n/server";
import { getTwoStepVerification } from "@/two-step-verification/server";

/** Mon compte's « Sécurité » Section (#663): Two-step verification. */
export default async function AccountSecurityPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const [status, locale] = await Promise.all([getTwoStepVerification().status(candidate.id), getRequestLocale()]);
  return <TwoStepVerificationSettings status={status} locale={locale} />;
}
