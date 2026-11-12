import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { getCoachEnrolments } from "@/coach-enrolments/server";
import { OwnEnrolment } from "@/coach-enrolments/OwnEnrolment";
import { PublicSite } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
export const metadata = { robots: { index: false } };
export default async function Page() {
    requireCoachSpaceV2(); // « Espace coach v2 » off (ADR-0106): a 404.
    const person = await getCurrentCandidate();
    if (!person)
        return signInRedirect();
    const [records, t] = await Promise.all([getCoachEnrolments().own(person), getServerT()]);
    return (<PublicSite>
      <main id="main" className="ds-site__page ds-site__narrow">
        <h1 className="ds-site__title">{t("coachEnrolment.ownTitle")}</h1>
        {records.length ? records.map((record) => <OwnEnrolment key={record.id} record={record}/>) : <p>{t("coachEnrolment.noRequests")}</p>}
      </main>
    </PublicSite>);
}
