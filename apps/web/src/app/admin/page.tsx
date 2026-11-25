import type { Metadata } from "next";
import type { IntroPage } from "@/admin/page-intro";
import { requireBackOffice } from "@/admin/server";
import { dashboardBlocks } from "@/back-office-dashboard/blocks";
import { currentApiBlock, currentJobDiscoveryDashboard } from "@/back-office-dashboard/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { getExtensionEventsBackOffice } from "@/extension-events/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { ApiBlock } from "./ApiBlock";
import { ExtensionBlock } from "./ExtensionBlock";
import { JobDiscoveryBlock } from "./JobDiscoveryBlock";
import "./dashboard.css";

/** Its intro (#465): one line, the rest behind « En savoir plus ». */
const INTRO: IntroPage = "dashboard";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice();
  const t = await getServerT();
  return { title: `${t("admin.dashboard.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * The Back Office Dashboard (#408, ADR-0042), the Back Office's home: each Tool's quota state (the « API » block, #1116),
 * seen by every Administrator, then the figures and charts of what the platform consumes and the extension's use (#925),
 * each of those blocks shown only to the roles that read its section; the sidebar leads to each section they cover.
 */
export default async function BackOfficeDashboardPage() {
  const { access } = await requireBackOffice();
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const blocks = dashboardBlocks(access);
  const [api, jobDiscovery, extension] = await Promise.all([
    blocks.includes("api") ? currentApiBlock(access) : null,
    blocks.includes("jobDiscovery") ? currentJobDiscoveryDashboard() : null,
    blocks.includes("extension") ? getExtensionEventsBackOffice().dashboard() : null,
  ]);
  return (
    <BackOfficeLayout access={access} title={t("admin.dashboard.title")}>
      <div className="dashboard">
        <PageIntro t={t} page={INTRO} subject={t("admin.dashboard.title")} values={{ roles: access.roles.map((role) => t(`admin.roles.${role}`)).join(", ") }} />
        {api ? <ApiBlock rows={api} locale={locale} /> : null}
        {jobDiscovery ? <JobDiscoveryBlock figures={jobDiscovery} locale={locale} /> : null}
        {extension ? <ExtensionBlock figures={extension} locale={locale} /> : null}
      </div>
    </BackOfficeLayout>
  );
}
