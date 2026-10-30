import { getAppointmentReminders } from "@/appointment-reminders/server";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { AppointmentRemindersForm } from "@/components/AppointmentRemindersForm";

/** Mon compte's Rappels Section: the Appointment Reminder setting. */
export default async function AccountRemindersPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  return <AppointmentRemindersForm enabled={await getAppointmentReminders().enabled(candidate.id)} />;
}
