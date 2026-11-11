import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { getCoachEnrolments } from "@/coach-enrolments/server";
import { OwnEnrolment } from "@/coach-enrolments/OwnEnrolment";
import { PublicSite } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
export const metadata = { robots: { index: false } };
export default async function Page() {
    const person = await getCurrentCandidate();
    if (!person)
        return signInRedirect();
    const [records, t] = await Promise.all([getCoachEnrolments().own(person), getServerT()]);
    return (<PublicSite>
      <main className="page stack">
        <h1>{t("coachEnrolment.ownTitle")}</h1>
        {records.length ? records.map((record) => <OwnEnrolment key={record.id} record={record}/>) : <p>{t("coachEnrolment.noRequests")}</p>}
      </main>
    </PublicSite>);
}
