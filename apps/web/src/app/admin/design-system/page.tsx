import type { Metadata } from "next";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { designSystemView } from "@/design/design-system-page";
import { DesignSystemPage } from "@/design/DesignSystemPage";
import { getServerT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to a Candidate would still carry the Back Office's title.
  await requireBackOffice();
  const t = await getServerT();
  return { title: `${t("admin.sections.designSystem")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * The Design System page (#463, ADR-0053), under Plateforme: every token and every component, built from the real
 * components, in the theme and Density its toggles choose (`?theme=sombre`, `?densite=compact`). Every Back Office Role
 * reads it; a Candidate gets a 404, as for every Back Office page.
 */
export default async function DesignSystemAdminPage({ searchParams }: { searchParams: Promise<{ theme?: string | string[]; densite?: string | string[] }> }) {
  const { access } = await requireBackOffice();
  const t = await getServerT();
  return (
    <BackOfficeLayout access={access} title={t("admin.sections.designSystem")}>
      <DesignSystemPage initial={designSystemView(await searchParams)} />
    </BackOfficeLayout>
  );
}
