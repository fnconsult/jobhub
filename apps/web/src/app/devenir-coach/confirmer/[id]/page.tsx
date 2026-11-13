import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { notFound } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { getCoachEnrolments } from "@/coach-enrolments/server";
import { OwnEnrolment } from "@/coach-enrolments/OwnEnrolment";
import { PublicSite } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
export const metadata = { robots: { index: false } };
export default async function Page({ params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    requireCoachSpaceV2(); // « Espace coach v2 » off (ADR-0107): a 404.
    const person = await getCurrentCandidate();
    if (!person)
        return signInRedirect();
    const record = await getCoachEnrolments().owned(person, (await params).id);
    if (!record)
        notFound();
    const t = await getServerT();
    return (<PublicSite>
      <main id="main" className="ds-site__page ds-site__narrow">
        <h1 className="ds-site__title">{t("coachEnrolment.confirmTitle")}</h1>
        <p>{t("coachEnrolment.confirmIntro")}</p>
        <OwnEnrolment record={record}/>
      </main>
    </PublicSite>);
}
