import { isLegalDocumentId, legalDocument } from "@jobhub/help";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalDocumentView } from "@/design/LegalDocumentView";
import { PublicSite } from "@/design/PublicSite";
import { getRequestLocale, getServerT } from "@/i18n/server";

type Params = { params: Promise<{ document: string }>; searchParams: Promise<{ version?: string | string[] }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { document } = await params;
  return { title: `${isLegalDocumentId(document) ? t(`legal.documents.${document}`) : t("publicSite.legal")} · ${t("app.name")}` };
}

/**
 * A Legal Document on the Légal page (#470), in the page's language: the version in effect, or `?version=` an
 * earlier one. The texts are the team's Markdown files (packages/help/legal); until one is written, the page shows
 * that it is not published yet.
 */
export default async function LegalDocumentPage({ params, searchParams }: Params) {
  const { document: id } = await params;
  if (!isLegalDocumentId(id)) notFound();
  const { version } = await searchParams;
  const asked = typeof version === "string" ? version : undefined;
  const shown = legalDocument(id, await getRequestLocale(), { version: asked });
  if (asked && !shown) notFound();
  return (
    <PublicSite current="legal">
      <main id="main" className="ds-site__page">
        <LegalDocumentView id={id} shown={shown} />
      </main>
    </PublicSite>
  );
}
