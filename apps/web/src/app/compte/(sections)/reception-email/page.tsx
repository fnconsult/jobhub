import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { EmailIntakeForm } from "@/components/EmailIntakeForm";
import { getCandidateSenders, getEmailIntake } from "@/email-intake/server";
import { getRequestLocale } from "@/i18n/server";

/**
 * Mon compte's « Réception par email » Section (#441): switch Email intake on or off, the Forwarding address, the
 * Candidate's sending addresses, and their Recognised senders (#450).
 */
export default async function AccountEmailIntakePage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const emailIntake = getEmailIntake();
  const [forwardingAddress, sendingAddresses, recognisedSenders, locale] = await Promise.all([
    emailIntake.forwardingAddress(candidate.id),
    emailIntake.sendingAddresses(candidate.id),
    getCandidateSenders().list(candidate.id),
    getRequestLocale(),
  ]);
  return <EmailIntakeForm forwardingAddress={forwardingAddress} sendingAddresses={sendingAddresses} recognisedSenders={recognisedSenders} locale={locale} />;
}
