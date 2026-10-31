import { isLegalTextId, LEGAL_TEXT_DAY, legalText, parisDay } from "@jobhub/help";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalTextView } from "@/design/LegalTextView";
import { PublicSite } from "@/design/PublicSite";
import { getRequestLocale, getServerT } from "@/i18n/server";

type Params = { params: Promise<{ text: string; version: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { text } = await params;
  // A dated version is never indexed: only the version in effect, at /legal/<text>, is (#501).
  return { title: `${isLegalTextId(text) ? t(`legal.texts.${text}`) : t("publicSite.legal")} · ${t("app.name")}`, robots: { index: false } };
}

/**
 * A Legal Text Version at its permanent address, /legal/<text>/<YYYY-MM-DD> (ADR-0062): the one an Acceptance points
 * to (#510). Marked archived once a later version is in effect; 404 for a date that is no version, or a version
 * before its effective date.
 */
export default async function LegalTextVersionPage({ params }: Params) {
  const { text, version } = await params;
  if (!isLegalTextId(text) || !LEGAL_TEXT_DAY.test(version)) notFound();
  const shown = legalText(text, await getRequestLocale(), { on: parisDay(), version });
  if (!shown) notFound();
  return (
    <PublicSite current="legal">
      <main id="main" className="ds-site__page">
        <LegalTextView text={text} shown={shown} />
      </main>
    </PublicSite>
  );
}
