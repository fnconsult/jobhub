import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getTailoredCvs } from "@/tailored-cv/server";
import { getTailoredDocuments, getTailoredDocumentVersions } from "@/tailored-documents/server";

type Context = RouteContext<"/api/applications/[id]/document-versions">;

/** The versions of the Application's Tailored CV, Cover Letter and Outreach Message (#1079), newest first. 200 · 401 · 404 */
export async function GET(_request: Request, { params }: Context) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const versions = await getTailoredDocumentVersions().list(candidate.id, (await params).id);
  return versions ? NextResponse.json(versions) : NextResponse.json({ error: "not_found" }, { status: 404 });
}

/**
 * « Restaurer cette version »: an earlier version becomes the document's again, as a new version; nothing is deleted.
 * Body: { document: "tailored_cv" | "cover_letter" | "outreach_message", version }.
 * 200 { versions, drafts, tailoredCv } (the document as it now stands) · 400 { errors } · 401 · 403 · 404
 */
export async function POST(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  const { id } = await params;
  const restored = await getTailoredDocumentVersions().restore(candidate.id, id, body);
  if (!restored.ok) return "errors" in restored ? NextResponse.json({ errors: restored.errors }, { status: 400 }) : NextResponse.json({ error: restored.error }, { status: restored.error === "conflict" ? 409 : 404 });
  const [versions, drafts, tailoredCv] = await Promise.all([
    getTailoredDocumentVersions().list(candidate.id, id),
    getTailoredDocuments().get(candidate.id, id),
    getTailoredCvs().get(candidate.id, id),
  ]);
  return NextResponse.json({ versions, drafts, tailoredCv });
}
