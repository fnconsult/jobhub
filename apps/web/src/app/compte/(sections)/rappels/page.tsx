import {CoachingNoticeSettings} from "@/coaching-notifications/Settings";
import {getCoachingNotifications,coachingNoticesOn} from "@/coaching-notifications/server";
import { getAppointmentReminders } from "@/appointment-reminders/server";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { AppointmentRemindersForm } from "@/components/AppointmentRemindersForm";
import { PushNotificationsForm } from "@/components/PushNotificationsForm";
import { currentHumanCoach } from "@/human-coaches/server";
import { pushAudiencesOf, pushEventsFor } from "@/push-notifications";
import { getPushNotifications } from "@/push-notifications/server";

/**
 * Mon compte's Rappels Section: the Appointment Reminder by email, the default, then the app's Push notifications
 * (#698), one switch per event: a Candidate's, and a Human Coach's own too. The same page in the app's WebView.
 */
const CANDIDATE="candidate";
export default async function AccountRemindersPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const push = getPushNotifications();
  const [enabled, coach, settings, devices] = await Promise.all([getAppointmentReminders().enabled(candidate.id), currentHumanCoach(), push.settings(candidate.id), push.devices(candidate.id)]);
  return (
    <>
      <AppointmentRemindersForm enabled={enabled} />
      {coachingNoticesOn()?<CoachingNoticeSettings initial={await getCoachingNotifications().settings(candidate.id)} audience={CANDIDATE}/>:null}
      <PushNotificationsForm events={pushEventsFor(pushAudiencesOf(coach !== null))} settings={settings} devices={devices.length} />
    </>
  );
}
