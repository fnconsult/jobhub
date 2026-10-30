import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { ForwardingWizard } from "@/components/ForwardingWizard";
import { getCandidateSenders, getEmailIntake, getForwardingSetup } from "@/email-intake/server";
import { getRequestLocale } from "@/i18n/server";

/** « Réception par email »'s step-by-step forwarding setup wizard (#451), opened from the Section. */
export default async function ForwardingWizardPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const [setup, sendingAddresses, recognisedSenders, locale] = await Promise.all([
    getForwardingSetup(candidate.id),
    getEmailIntake().sendingAddresses(candidate.id),
    getCandidateSenders().list(candidate.id),
    getRequestLocale(),
  ]);
  return <ForwardingWizard initial={setup} sendingAddresses={sendingAddresses} recognisedSenders={recognisedSenders} locale={locale} />;
}
