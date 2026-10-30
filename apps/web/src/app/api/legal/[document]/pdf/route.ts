import { isLegalDocumentId, legalDocument } from "@jobhub/help";
import { isSupportedLocale } from "@jobhub/shared/i18n";
import { NextResponse } from "next/server";
import { contentDisposition } from "@/export";
import { getRequestLocale } from "@/i18n/server";
import { legalDocumentPdf } from "@/public-pages/legal-pdf";

type Params = { params: Promise<{ document: string }> };

/**
 * « Télécharger en PDF » on the Légal page (#470): a Legal Document's version (`?version=`, the one in effect by
 * default) as a PDF, in the page's language (`?lang=`). Public, like the page; 404 for a text not written yet.
 */
export async function GET(request: Request, { params }: Params) {
  const { document: id } = await params;
  if (!isLegalDocumentId(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const query = new URL(request.url).searchParams;
  const lang = query.get("lang");
  const shown = legalDocument(id, isSupportedLocale(lang) ? lang : await getRequestLocale(), { version: query.get("version") ?? undefined });
  if (!shown) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const file = await legalDocumentPdf(shown.document);
  return new Response(new Blob([file.bytes as Uint8Array<ArrayBuffer>]), {
    headers: { "content-type": "application/pdf", "content-disposition": contentDisposition(file.fileName) },
  });
}
