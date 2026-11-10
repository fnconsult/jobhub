import { notFound } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { coachSpaceV2On } from "@/coach-space/server";
import { getCoachEnrolments } from "@/coach-enrolments/server";
import { OwnEnrolment } from "@/coach-enrolments/OwnEnrolment";
import { PublicSite } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
export const metadata = { robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!coachSpaceV2On()) notFound();
  const person = await getCurrentCandidate();
  if (!person) return signInRedirect();
  const record = await getCoachEnrolments().owned(person, (await params).id);
  if (!record) notFound();
  const t = await getServerT();
  return (
    <PublicSite>
      <main className="page stack">
        <h1>{t("coachEnrolment.confirmTitle")}</h1>
        <p>{t("coachEnrolment.confirmIntro")}</p>
        <OwnEnrolment record={record} />
      </main>
    </PublicSite>
  );
}
