import { isLegalTextId, legalText, parisDay } from "@jobhub/help";
import { isSupportedLocale } from "@jobhub/shared/i18n";
import { NextResponse } from "next/server";
import { contentDisposition } from "@/export";
import { getRequestLocale } from "@/i18n/server";
import { legalTextPdf } from "@/public-pages/legal-pdf";

type Params = { params: Promise<{ text: string }> };

/**
 * « Télécharger en PDF » on Légal: a Legal Text Version (`?version=<YYYY-MM-DD>`, the one in effect by default) as a
 * PDF, in the page's language (`?lang=`). Public, like the page, so a substantial version still to come, served at its
 * dated address (#547), downloads too; 404 for a text not written yet, a date that is no version, or a minor version
 * before its effective date.
 */
export async function GET(request: Request, { params }: Params) {
  const { text } = await params;
  if (!isLegalTextId(text)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const query = new URL(request.url).searchParams;
  const lang = query.get("lang");
  const shown = legalText(text, isSupportedLocale(lang) ? lang : await getRequestLocale(), { on: parisDay(), version: query.get("version") ?? undefined });
  if (!shown) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const file = await legalTextPdf(shown.version);
  return new Response(new Blob([file.bytes as Uint8Array<ArrayBuffer>]), {
    headers: { "content-type": "application/pdf", "content-disposition": contentDisposition(file.fileName) },
  });
}
