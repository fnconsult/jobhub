import { isLegalTextId, legalText, parisDay } from "@jobhub/help";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalTextView } from "@/design/LegalTextView";
import { PublicSite } from "@/design/PublicSite";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { legalTextMetadata } from "@/public-pages/indexing-server";

type Params = { params: Promise<{ text: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { text } = await params;
  if (!isLegalTextId(text)) return { title: `${t("publicSite.legal")} · ${t("app.name")}` };
  // Indexed in the languages it has a version in effect in; « pas encore publié » is not (#545).
  return { title: `${t(`legal.texts.${text}`)} · ${t("app.name")}`, ...(await legalTextMetadata(text)) };
}

/**
 * A Legal Text on Légal (ADR-0062), in the page's language: the version in effect today in France, never one before
 * its effective date. The texts are the team's Markdown files (packages/help/legal); until one is in effect, the page
 * shows that it is not published yet. #470's addresses and `?version=` are redirected by proxy.ts.
 */
export default async function LegalTextPage({ params }: Params) {
  const { text } = await params;
  if (!isLegalTextId(text)) notFound();
  return (
    <PublicSite current="legal">
      <main id="main" className="ds-site__page">
        <LegalTextView text={text} shown={legalText(text, await getRequestLocale(), { on: parisDay() })} />
      </main>
    </PublicSite>
  );
}
