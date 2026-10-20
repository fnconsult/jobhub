import type { Metadata } from "next";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getServerT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice();
  const t = await getServerT();
  return { title: `${t("admin.title")} · ${t("app.name")}`, robots: { index: false } };
}

/** The Back Office's home: the sidebar leads to each section the Administrator's roles cover. */
export default async function BackOfficePage() {
  const { access } = await requireBackOffice();
  const t = await getServerT();
  return (
    <BackOfficeLayout access={access} title={t("admin.title")}>
      <p className="lead">{t("admin.intro")}</p>
      <p>{t("admin.yourRoles", { roles: access.roles.map((role) => t(`admin.roles.${role}`)).join(", ") })}</p>
    </BackOfficeLayout>
  );
}
