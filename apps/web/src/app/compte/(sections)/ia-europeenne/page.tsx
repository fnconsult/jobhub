import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { EuAiConsentForm } from "@/components/EuAiConsentForm";
import { getEuAiConsents } from "@/eu-ai-consent/server";
import { getRequestLocale } from "@/i18n/server";

/** Mon compte's European AI Section: the EU AI consent. */
export default async function AccountEuAiPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const [givenAt, locale] = await Promise.all([getEuAiConsents().givenAt(candidate.id), getRequestLocale()]);
  return <EuAiConsentForm givenAt={givenAt} locale={locale} />;
}
