import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { tailoredCvResponse } from "@/tailored-cv/http";
import { getTailoredCvs } from "@/tailored-cv/server";

type Context = RouteContext<"/api/applications/[id]/tailored-cv/save">;

/**
 * The Candidate approves the proposal they reviewed: it is saved as the Application's Tailored CV.
 * Body: { revision } of the proposal reviewed.
 * 200 · 400 { errors } · 401 · 403 · 404 (no proposal) · 409 { error: "master_cv_changed" | "proposal_changed" }
 */
export async function POST(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  return tailoredCvResponse(await getTailoredCvs().save(candidate.id, (await params).id, body));
}
