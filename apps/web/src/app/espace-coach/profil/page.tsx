import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { MeetingForm } from "@/coach-space/MeetingForm";
import { getCoachContacts } from "@/coach-space/contacts-server";
import { CoachSpaceShell } from "@/components/CoachSpaceHeader";
import { TimeZoneForm } from "@/coaching-time/TimeZoneForm";
import { getCoachingTimeZones } from "@/coaching-time/server";
import { requireCoachSpace } from "@/coach-space/server";
import { getServerT, getRequestLocale } from "@/i18n/server";
import { getCoachPages } from "@/coach-pages/server";
import { CoachPageEditor } from "@/coach-pages/CoachPageEditor";
import { PublicCoachProfile } from "@/coach-pages/PublicCoachProfile";
import { getCurrentCandidate } from "@/auth/server";
import { getCoachEnrolments } from "@/coach-enrolments/server";
import { getCoachingOffers } from "@/coaching-offers/server";
import { SellerInfo } from "@/coaching-offers/SellerInfo";
import { notFound } from "next/navigation";
export default async function Page() {
  requireCoachSpaceV2(); // « Espace coach v2 » off (ADR-0106): a 404.
  const coach = await requireCoachSpace(),
    person = await getCurrentCandidate();
  if (!person) notFound();
  const [t, locale, profile, offer, enrolments] = await Promise.all([
    getServerT(),
    getRequestLocale(),
    getCoachPages().editor(coach.id),
    getCoachingOffers().offer(coach.id),
    getCoachEnrolments().own(person),
  ]);
  if (!profile) notFound();
  const enrollment = enrolments.find((e) => e.humanCoachId === coach.id && e.state === "approved"),
    snapshot = profile.latest;
  const initial = snapshot?.content ?? { presentation: coach.bio, specialties: enrollment?.specialties ?? [], languages: enrollment?.languages ?? [] };
  const latestPortrait = snapshot?.photo ? `data:image/webp;base64,${snapshot.photo.toString("base64")}` : null;
  const approvedPortrait = profile.approved?.photo ? `data:image/webp;base64,${profile.approved.photo.toString("base64")}` : null;
  const formattedPrice =
    offer?.amount !== null && offer?.amount !== undefined
      ? new Intl.NumberFormat(locale, { style: "currency", currency: offer.currency }).format(offer.amount / 100)
      : null;
  return (
    <CoachSpaceShell>
      {snapshot ? <p role="status">{t(`coachPage.status.${snapshot.state}`)}</p> : null}
      {snapshot?.reason ? (
        <p role="alert">
          {t("coachPage.reason")}: {snapshot.reason}
        </p>
      ) : null}
      <CoachPageEditor key={profile.head} coachId={coach.id} name={coach.name} head={profile.head} initial={initial} photoUrl={latestPortrait} />
      {profile.approved ? (
        <section className="coach-space-card stack">
          <h2>{t("coachPage.visible")}</h2>
          <PublicCoachProfile
            name={coach.name}
            page={{
              ...profile.approved.content,
              photoUrl: approvedPortrait,
            }}
          />
        </section>
      ) : (
        <p>{t("coachPage.notPublished")}</p>
      )}
      {offer ? (
        <section className="coach-space-card stack">
          <h2>{t("coachPage.offers")}</h2>
          <SellerInfo seller={offer.seller} t={t} />
          <p>{t("humanCoaches.sessionDuration", { count: offer.durationMinutes })}</p>
          {offer.seller.kind === "jobbbox" ? <p>{t("coachPage.jobbboxPrice")}</p> : offer.amount !== null ? <p>{formattedPrice}</p> : null}
        </section>
      ) : null}
      <section className="coach-space-card stack">
        <TimeZoneForm value={await getCoachingTimeZones().coach(coach.id)} coach />
        <h2>{t("coachMeeting.permanent")}</h2>
        <MeetingForm initial={await getCoachContacts().ofCoach(coach.id)} />
      </section>
    </CoachSpaceShell>
  );
}
