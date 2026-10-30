import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { componentTestPageServed } from "@/design/component-test-page";
import { LegalDocumentView } from "@/design/LegalDocumentView";
import { PublicSite } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
import { SPECIMEN_LEGAL_DOCUMENT } from "@/public-pages/specimen-legal-document";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("publicSite.legal")} · ${t("app.name")}`, robots: { index: false } };
}

/**
 * The Légal page's test page (#470): a long specimen Legal Document in the page's layout, for the e2e suite's scroll
 * check while the team has written no real text. Served to the e2e suite and on a developer's machine only.
 */
export default async function LegalTestPage() {
  if (!componentTestPageServed(process.env)) notFound();
  return (
    <PublicSite current="legal">
      <main id="main" className="ds-site__page">
        <LegalDocumentView id={SPECIMEN_LEGAL_DOCUMENT.id} shown={{ document: SPECIMEN_LEGAL_DOCUMENT, earlier: [] }} />
      </main>
    </PublicSite>
  );
}
