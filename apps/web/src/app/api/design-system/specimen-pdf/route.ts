import { NextResponse } from "next/server";
import { componentTestPageServed } from "@/design/component-test-page";
import { specimenPdf } from "@/design/specimen-document";
import { contentDisposition } from "@/export";

/**
 * The Viewer's specimen (#468): a two-page CV as a PDF, for the Viewer's test page and the e2e suite. Served where the
 * components' test page is (the e2e suite and a developer's machine), 404 anywhere else.
 */
export async function GET() {
  if (!componentTestPageServed(process.env)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const file = await specimenPdf();
  return new Response(new Blob([file.bytes as Uint8Array<ArrayBuffer>]), {
    headers: { "content-type": "application/pdf", "content-disposition": contentDisposition(file.fileName) },
  });
}
