import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { contentDisposition, exportDocument, isCvTemplate, isExportFormat } from "@/export";
import { getRequestLocale } from "@/i18n/server";
import { getProfiles } from "@/profiles/server";

type Params = { params: Promise<{ id: string }> };

/**
 * Downloads the current version of a Profile's Master CV.
 * Query: format=pdf|docx, template=<CV Template>. Headings are written in the
 * Candidate's Interface Language (a Master CV has no Job Offer to take a
 * Document Language from).
 * 200 file · 400 { error: "invalid_format" | "invalid_template" } · 401 · 404
 */
export async function GET(request: Request, { params }: Params) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const query = new URL(request.url).searchParams;
  const format = query.get("format");
  const template = query.get("template");
  if (!isExportFormat(format)) return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  if (!isCvTemplate(template)) return NextResponse.json({ error: "invalid_template" }, { status: 400 });

  const profile = await getProfiles().get(candidate.id, (await params).id);
  if (!profile) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const language = await getRequestLocale();
  const file = await exportDocument({ kind: "cv", content: profile.masterCv.content }, { format, template, language });
  return new Response(new Blob([file.bytes as Uint8Array<ArrayBuffer>]), {
    headers: {
      "content-type": file.contentType,
      "content-disposition": contentDisposition(file.fileName),
      "cache-control": "private, no-store",
    },
  });
}
