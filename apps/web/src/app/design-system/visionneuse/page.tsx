import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { componentTestPageServed } from "@/design/component-test-page";
import { DocumentViewer } from "@/design/DocumentViewer";
import { getServerT } from "@/i18n/server";

/** The Viewer's two-page specimen (src/design/specimen-document.ts). */
const SPECIMEN = { src: "/api/design-system/specimen-pdf", fileName: "CV-Marie-Dupont.pdf" };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("designSystem.viewer.title")} · ${t("app.name")}`, robots: { index: false } };
}

/**
 * The Viewer's test page (#468): the PDF / DOCX Viewer on its two-page specimen, for the e2e suite's paging, zoom and
 * download checks. Served to the e2e suite and on a developer's machine only.
 */
export default async function ViewerTestPage() {
  if (!componentTestPageServed(process.env)) notFound();
  return (
    <main id="main" data-density="confort">
      <DocumentViewer src={SPECIMEN.src} fileName={SPECIMEN.fileName} />
    </main>
  );
}
