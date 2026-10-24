import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { actionResponse } from "@/ndjson";
import { tailoredDocumentsOutcome, tailoredDocumentsResponse } from "@/tailored-documents/http";
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
 * The AI Coach drafts (again) the Cover Letter or the Outreach Message, replacing the stored one, with its Provenance.
 * Body: { document: "cover_letter" | "outreach_message", language?: "fr" | "en", channel?: "email" | "inmail", contactId? }.
 * Nothing is sent (ADR-0005). 200 · 400 { errors } · 401 · 403 · 404 · 499 { error: "stopped" } · 503 { error: "unavailable", reason? }
 *
 * Live (#334), with `Accept: application/x-ndjson`: each step as it starts and ends, then { type: "done", ...drafts }
 * · { type: "stopped", error } · { type: "failed", status, ... } (see actionResponse). Aborting the request is the Stop:
 * the AI call is aborted and the half-written draft discarded.
 */
export async function POST(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  const { id } = await params;
  return actionResponse(request, async (live) => tailoredDocumentsOutcome(await getTailoredDocuments().draft(candidate.id, id, body, live)));
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
