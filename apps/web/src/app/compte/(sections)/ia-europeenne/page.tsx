import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { EuAiConsentForm } from "@/components/EuAiConsentForm";
import { getEuAiConsents } from "@/eu-ai-consent/server";
import { getRequestLocale } from "@/i18n/server";
import { routes } from "@/routes";

/** Mon compte's European AI Section: the EU AI consent. */
export default async function AccountEuAiPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const [givenAt, locale] = await Promise.all([getEuAiConsents().givenAt(candidate.id), getRequestLocale()]);
  return <EuAiConsentForm givenAt={givenAt} locale={locale} />;
}
