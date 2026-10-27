import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { EmailIntakeForm } from "@/components/EmailIntakeForm";
import { getEmailIntake } from "@/email-intake/server";
import { getRequestLocale } from "@/i18n/server";
import { routes } from "@/routes";

/** Mon compte's « Réception par email » Section (#441): switch Email intake on or off, the Forwarding address, the Candidate's sending addresses. */
export default async function AccountEmailIntakePage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const emailIntake = getEmailIntake();
  const [forwardingAddress, sendingAddresses, locale] = await Promise.all([
    emailIntake.forwardingAddress(candidate.id),
    emailIntake.sendingAddresses(candidate.id),
    getRequestLocale(),
  ]);
  return <EmailIntakeForm forwardingAddress={forwardingAddress} sendingAddresses={sendingAddresses} locale={locale} />;
}
