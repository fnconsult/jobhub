import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { tailoredDocumentsResponse } from "@/tailored-documents/http";
import { getTailoredDocuments } from "@/tailored-documents/server";

type Context = RouteContext<"/api/applications/[id]/tailored-documents">;

/** The Application's Document Language, Cover Letter and Outreach Message. 200 · 401 · 404 */
export async function GET(_request: Request, { params }: Context) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const drafts = await getTailoredDocuments().get(candidate.id, (await params).id);
  return drafts ? NextResponse.json(drafts) : NextResponse.json({ error: "not_found" }, { status: 404 });
}

/**
 * The AI Coach drafts (again) the Cover Letter or the Outreach Message, replacing the stored one.
 * Body: { document: "cover_letter" | "outreach_message", language?: "fr" | "en", channel?: "email" | "inmail" }.
 * Nothing is sent (ADR-0005). 200 · 400 { errors } · 401 · 403 · 404 · 503 { error: "unavailable" }
 */
export async function POST(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  return tailoredDocumentsResponse(await getTailoredDocuments().draft(candidate.id, (await params).id, body));
}

/**
 * The Candidate's edit of a draft. Body: { document, text, subject? }.
 * 200 · 400 { errors } · 401 · 403 · 404 (also when there is no draft yet)
 */
export async function PATCH(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  return tailoredDocumentsResponse(await getTailoredDocuments().edit(candidate.id, (await params).id, body));
}
