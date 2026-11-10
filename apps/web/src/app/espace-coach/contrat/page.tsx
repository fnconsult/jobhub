import { PublicSite } from "@/design/PublicSite";
import { notFound } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { coachSpaceV2On } from "@/coach-space/server";
import { getCoachEnrolments } from "@/coach-enrolments/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { CoachSpaceShell } from "@/components/CoachSpaceHeader";
import { getServerT } from "@/i18n/server";
/** #880 supplies acceptance of the human-approved version. Enrolment alone never grants Candidate access. */
export default async function Page() {
  if (!coachSpaceV2On()) notFound();
  const person = await getCurrentCandidate();
  if (!person) return signInRedirect();
  const records = await getCoachEnrolments().approvedActive(person);
  if (!records.some((record) => record.state === "approved") && !(await getHumanCoaches().coachSignedIn(person))) notFound();
  const t = await getServerT();
  if (!(await getHumanCoaches().coachSignedIn(person)))
    return (
      <PublicSite>
        <main className="page stack">
          <h1>{t("coachSpaceV2.pages.contrat")}</h1>
          <p>{t("coachEnrolment.awaitingContract")}</p>
        </main>
      </PublicSite>
    );
  return (
    <CoachSpaceShell>
      <section className="coach-space-card">
        <h2>{t("coachSpaceV2.pages.contrat")}</h2>
        <p>{t("coachEnrolment.awaitingContract")}</p>
      </section>
    </CoachSpaceShell>
  );
}
