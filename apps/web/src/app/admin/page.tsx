import type { Metadata } from "next";
import Link from "next/link";
import { requireAdministrator } from "@/admin/server";
import { BackOfficeHeader } from "@/components/BackOfficeHeader";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireAdministrator();
  const t = await getServerT();
  return { title: `${t("admin.title")} · ${t("app.name")}`, robots: { index: false } };
}

/** The back office's home: one entry per section the Jobbbox team runs. */
export default async function BackOfficePage() {
  await requireAdministrator();
  const t = await getServerT();
  return (
    <main className="page">
      <BackOfficeHeader />
      <h1>{t("admin.title")}</h1>
      <p className="lead">{t("admin.intro")}</p>
      <ul className="stack">
        <li>
          <Link href={routes.adminPlanQuotas}>{t("admin.sections.planQuotas")}</Link>
        </li>
        <li>
          <Link href={routes.adminHumanCoaches}>{t("admin.sections.humanCoaches")}</Link>
        </li>
      </ul>
    </main>
  );
}
