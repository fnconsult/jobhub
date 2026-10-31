import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { componentTestPageServed } from "@/design/component-test-page";
import { LegalTextView } from "@/design/LegalTextView";
import { PublicSite } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
import { SPECIMEN_LEGAL_TEXT } from "@/public-pages/specimen-legal-text";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("publicSite.legal")} · ${t("app.name")}`, robots: { index: false } };
}

/**
 * The Légal page's test page (#470): a long specimen Legal Text Version in the page's layout, for the e2e suite's scroll
 * check while the team has written no real text. Served to the e2e suite and on a developer's machine only.
 */
export default async function LegalTestPage() {
  if (!componentTestPageServed(process.env)) notFound();
  return (
    <PublicSite current="legal">
      <main id="main" className="ds-site__page">
        <LegalTextView text={SPECIMEN_LEGAL_TEXT.text} shown={{ version: SPECIMEN_LEGAL_TEXT, inEffect: true, history: [] }} />
      </main>
    </PublicSite>
  );
}
