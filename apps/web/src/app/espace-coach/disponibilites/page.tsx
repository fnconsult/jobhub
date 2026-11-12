import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { requireCoachSpace } from "@/coach-space/server";
import { CoachSpaceShell } from "@/components/CoachSpaceHeader";
import { getCoachingBooking, calBookingOn } from "@/coaching-booking/server";
import { getServerT } from "@/i18n/server";
import { AvailabilityPreview } from "@/coaching-booking/AvailabilityPreview";
const SETTINGS = "https://app.cal.com/availability";
export default async function Page() {
  requireCoachSpaceV2(); // « Espace coach v2 » off (ADR-0106): a 404.
  const coach = await requireCoachSpace(),
    event = await getCoachingBooking().configured(coach.id),
    t = await getServerT();
  return (
    <CoachSpaceShell>
      <section className="coach-space-card stack">
        <h2>{t("coachingBooking.availability")}</h2>
        <p>{t("coachingBooking.availabilityIntro")}</p>
        <a href={SETTINGS} className="button">
          {t("coachingBooking.openAvailability")}
        </a>
        {event && (await calBookingOn()) ? <AvailabilityPreview bookingUrl={event.bookingUrl} /> : <p>{t("coachingBooking.notConfigured")}</p>}
      </section>
    </CoachSpaceShell>
  );
}
