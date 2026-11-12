import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { requireCoachSpace } from "@/coach-space/server";
import { CoachSpaceShell } from "@/components/CoachSpaceHeader";
import { getCoachingBooking, calBookingOn } from "@/coaching-booking/server";
import { Card } from "@/design/Card";
import { buttonClass } from "@/design/button-class";
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
      <Card title={t("coachingBooking.availability")}>
        <div className="stack">
          <p>{t("coachingBooking.availabilityIntro")}</p>
          <a href={SETTINGS} className={buttonClass({ variant: "primary" })}>
            {t("coachingBooking.openAvailability")}
          </a>
          {event && (await calBookingOn()) ? <AvailabilityPreview bookingUrl={event.bookingUrl} /> : <p>{t("coachingBooking.notConfigured")}</p>}
        </div>
      </Card>
    </CoachSpaceShell>
  );
}
