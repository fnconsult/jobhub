import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { actionResponse } from "@/ndjson";
import { tailoredCvOutcome, tailoredCvResponse } from "@/tailored-cv/http";
import { getTailoredCvs } from "@/tailored-cv/server";

type Context = RouteContext<"/api/applications/[id]/tailored-cv">;

/** The Application's Document Language, its Tailored CV proposal under review and its saved Tailored CV. 200 · 401 · 404 */
export async function GET(_request: Request, { params }: Context) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tailoredCv = await getTailoredCvs().get(candidate.id, (await params).id);
  return tailoredCv ? NextResponse.json(tailoredCv) : NextResponse.json({ error: "not_found" }, { status: 404 });
}

/**
 * The AI Coach proposes (again) a Tailored CV, replacing the proposal under review, with its Provenance.
 * Body: { language?: "fr" | "en" }. 200 · 400 { errors } · 401 · 403 · 404 · 499 { error: "stopped" } · 503 { error: "unavailable", reason? }
 *
 * Live (#334), with `Accept: application/x-ndjson`: each step as it starts and ends, then { type: "done", ...tailoredCv }
 * · { type: "stopped", error } · { type: "failed", status, ... } (see actionResponse). Aborting the request is the Stop:
 * every AI call is aborted and the half-written proposal discarded.
 */
export async function POST(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => ({}));
  const { id } = await params;
  return actionResponse(request, async (live) => tailoredCvOutcome(await getTailoredCvs().propose(candidate.id, id, body, live)));
}

/**
 * The Candidate's answer to one question of the proposal. Body: { requirement, confirmed: boolean }.
 * 200 · 400 { errors } · 401 · 403 · 404 (also when the proposal asks no such question)
 */
export async function PATCH(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  return tailoredCvResponse(await getTailoredCvs().answer(candidate.id, (await params).id, body));
}
