import { redirect } from "next/navigation";
import { getAppointmentReminders } from "@/appointment-reminders/server";
import { getCurrentCandidate } from "@/auth/server";
import { AppointmentRemindersForm } from "@/components/AppointmentRemindersForm";
import { routes } from "@/routes";

/** Mon compte's Rappels Section: the Appointment Reminder setting. */
export default async function AccountRemindersPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  return <AppointmentRemindersForm enabled={await getAppointmentReminders().enabled(candidate.id)} />;
}
