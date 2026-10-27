import type { Metadata } from "next";
import { requireBackOffice } from "@/admin/server";
import { dashboardBlocks } from "@/back-office-dashboard/blocks";
import { currentJobDiscoveryDashboard } from "@/back-office-dashboard/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { JobDiscoveryBlock } from "./JobDiscoveryBlock";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice();
  const t = await getServerT();
  return { title: `${t("admin.dashboard.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * The Back Office Dashboard (#408, ADR-0042), the Back Office's home: the figures and charts of what the platform
 * consumes, each block shown only to the roles that read its section; the sidebar leads to each section they cover.
 */
export default async function BackOfficeDashboardPage() {
  const { access } = await requireBackOffice();
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const blocks = dashboardBlocks(access);
  const jobDiscovery = blocks.includes("jobDiscovery") ? await currentJobDiscoveryDashboard() : null;
  return (
    <BackOfficeLayout access={access} title={t("admin.dashboard.title")}>
      <p className="lead">{t("admin.dashboard.intro")}</p>
      <p>{t("admin.yourRoles", { roles: access.roles.map((role) => t(`admin.roles.${role}`)).join(", ") })}</p>
      {blocks.length === 0 ? <p>{t("admin.dashboard.noBlocks")}</p> : null}
      {jobDiscovery ? <JobDiscoveryBlock figures={jobDiscovery} locale={locale} /> : null}
    </BackOfficeLayout>
  );
}
