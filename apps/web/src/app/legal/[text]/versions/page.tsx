import { isLegalTextId, legalTextHistory, parisDay } from "@jobhub/help";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalTextHistoryView } from "@/design/LegalTextView";
import { PublicSite } from "@/design/PublicSite";
import { getRequestLocale, getServerT } from "@/i18n/server";

type Params = { params: Promise<{ text: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { text } = await params;
  return { title: `${t("legal.history")} · ${isLegalTextId(text) ? t(`legal.texts.${text}`) : t("publicSite.legal")} · ${t("app.name")}` };
}

/** A Legal Text's version history (ADR-0062): each version in effect so far, where « Versions précédentes » leads. */
export default async function LegalTextHistoryPage({ params }: Params) {
  const { text } = await params;
  if (!isLegalTextId(text)) notFound();
  return (
    <PublicSite current="legal">
      <main id="main" className="ds-site__page">
        <LegalTextHistoryView text={text} history={legalTextHistory(text, await getRequestLocale(), parisDay())} />
      </main>
    </PublicSite>
  );
}
