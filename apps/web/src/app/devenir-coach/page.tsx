import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentCandidate } from "@/auth/server";
import { EnrolmentForm } from "@/coach-enrolments/EnrolmentForm";
import { PublicSite } from "@/design/PublicSite";
import { getRequestLocale, getServerT } from "@/i18n/server";
export async function generateMetadata(): Promise<Metadata> {
    const t = await getServerT();
    return { title: `${t("coachEnrolment.title")} · ${t("app.name")}` };
}
const OWN = "/devenir-coach/mes-demandes";
export default async function Page() {
    const [t, locale, person] = await Promise.all([getServerT(), getRequestLocale(), getCurrentCandidate()]);
    return (<PublicSite>
      <main className="page stack">
        <h1>{t("coachEnrolment.title")}</h1>
        <p>{t("coachEnrolment.intro")}</p>
        {person ? <Link href={OWN}>{t("coachEnrolment.ownTitle")}</Link> : null}
        <EnrolmentForm locale={locale} email={person?.email ?? ""}/>
      </main>
    </PublicSite>);
}
