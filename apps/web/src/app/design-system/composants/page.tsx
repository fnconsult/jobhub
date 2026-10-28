import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { componentTestPageServed, densityOfTestPage } from "@/design/component-test-page";
import { ComponentGallery } from "@/design/ComponentGallery";
import { getServerT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("designSystem.gallery.title")} · ${t("app.name")}`, robots: { index: false } };
}

/**
 * The components' test page (#462): every Design System component on one page, in Confort or, with `?densite=compact`,
 * in Compact, for the e2e suite's axe and keyboard checks. Served to the e2e suite and on a developer's machine only.
 */
export default async function ComponentTestPage({ searchParams }: { searchParams: Promise<{ densite?: string | string[] }> }) {
  if (!componentTestPageServed(process.env)) notFound();
  const { densite } = await searchParams;
  return (
    <main id="main" data-density={densityOfTestPage(densite)}>
      <ComponentGallery />
    </main>
  );
}
