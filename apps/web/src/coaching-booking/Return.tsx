import { sharedPool } from "@/database/pool";
import { getCoachingBooking, calBookingOn } from "./server";
import { BookingEmbed } from "./Embed";
import { BookingWait } from "./ReturnWait";
import { getServerT } from "@/i18n/server";
import Link from "next/link";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
const BACK = "/coachs";
export async function BookingReturn({ candidateId, checkoutId }: { candidateId: string; checkoutId: string }) {
  if (!/^cs_[\w-]{1,200}$/.test(checkoutId) || !(await calBookingOn())) return null;
  const session = (
    await sharedPool().query<{ id: string }>(
      "SELECT id FROM coaching_session WHERE candidate_id=$1 AND stripe_checkout_session_id=$2 AND withdrawn_at IS NULL AND cancelled_at IS NULL",
      [candidateId, checkoutId],
    )
  ).rows[0];
  if (!session) return <BookingWait />;
  const claim = await getCoachingBooking().forCandidate(candidateId, session.id);
  if (!claim?.token) return null;
  const t = await getServerT();
  return (
    <Card title={t("coachingBooking.book")} headingLevel={3} flat>
      <div className="stack">
        <BookingEmbed bookingUrl={claim.event.bookingUrl} token={claim.token} />
        <Link className={buttonClass()} href={BACK}>
          {t("coachingBooking.later")}
        </Link>
      </div>
    </Card>
  );
}
