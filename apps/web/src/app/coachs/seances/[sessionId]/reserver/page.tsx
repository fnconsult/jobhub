// « Espace coach v2 » (ADR-0106): this page is a 404 while it is off.
import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { getCoachingBooking } from "@/coaching-booking/server";
import { BookingEmbed } from "@/coaching-booking/Embed";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { PublicSite } from "@/design/PublicSite";
export default async function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  requireCoachSpaceV2();
  const person = await getCurrentCandidate();
  if (!person) return signInRedirect();
  const claim = await getCoachingBooking().forCandidate(person.id, (await params).sessionId);
  if (!claim) notFound();
  const t = await getServerT();
  return (
    <PublicSite>
      <main id="main" className="ds-site__page">
        <h1>{t("coachingBooking.book")}</h1>
        <p>{t("coachingBooking.afterPayment")}</p>
        {claim.token ? (
          <BookingEmbed bookingUrl={claim.event.bookingUrl} token={claim.token} />
        ) : (
          <div>
            <p>{t("coachingBooking.alreadyBooked")}</p>
            <a className="button" href={`https://cal.com/reschedule/${claim.uid}`}>
              {t("coachingBooking.manage")}
            </a>
          </div>
        )}
        <Link className="button" href={routes.coaching}>
          {t("coachingBooking.later")}
        </Link>
      </main>
    </PublicSite>
  );
}
