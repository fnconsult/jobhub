import { MeetingForm } from "@/coach-space/MeetingForm";
import { getCoachContacts } from "@/coach-space/contacts-server";
import { CoachSpaceShell } from "@/components/CoachSpaceHeader";
import { TimeZoneForm } from "@/coaching-time/TimeZoneForm";
import { getCoachingTimeZones } from "@/coaching-time/server";
import { requireCoachSpaceV2 } from "@/coach-space/server";
import { getServerT } from "@/i18n/server";
export default async function Page() {
  const coach = await requireCoachSpaceV2();
  const t = await getServerT();
  return (
    <CoachSpaceShell>
      <section className="coach-space-card">
        <h2>{t("coachSpaceV2.pages.profil")}</h2>
        <TimeZoneForm value={await getCoachingTimeZones().coach(coach.id)} coach />
        <h2>{t("coachMeeting.permanent")}</h2>
        <MeetingForm initial={await getCoachContacts().ofCoach(coach.id)} />
      </section>
    </CoachSpaceShell>
  );
}
