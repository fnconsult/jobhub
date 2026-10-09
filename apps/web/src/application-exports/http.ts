import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { contentDisposition, isCvTemplate, isExportFormat } from "@/export";
import type { ApplicationExportKind } from "./index";
import { getApplicationExports } from "./server";

/**
 * Downloads an Application's saved `document`, for the signed-in Candidate.
 * Query: format=pdf|docx, template=<CV Template>. Written in the document's Document Language.
 * 200 file · 400 { error: "invalid_format" | "invalid_template" } · 401 · 404 (no such Application for this Candidate, or nothing saved yet)
 */
export async function applicationExportResponse(request: Request, applicationId: string, document: ApplicationExportKind): Promise<Response> {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const query = new URL(request.url).searchParams;
  const format = query.get("format");
  const template = query.get("template");
  if (!isExportFormat(format)) return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  if (!isCvTemplate(template)) return NextResponse.json({ error: "invalid_template" }, { status: 400 });

  const file = await getApplicationExports().file(candidate.id, applicationId, document, { format, template });
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new Response(new Blob([file.bytes as Uint8Array<ArrayBuffer>]), {
    headers: {
      "content-type": file.contentType,
      "content-disposition": contentDisposition(file.fileName),
      "cache-control": "private, no-store",
    },
  });
}
