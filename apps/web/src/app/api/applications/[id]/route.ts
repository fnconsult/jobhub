import { NextResponse } from "next/server";
import { applicationResponse } from "@/applications/http";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";

/** One of the Candidate's Applications. 200 Application · 401 · 404 */
export async function GET(_request: Request, { params }: RouteContext<"/api/applications/[id]">) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const application = await getApplications().get(candidate.id, (await params).id);
  if (!application) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(application);
}

/**
 * Changes one of the Candidate's Applications, by hand.
 * Body: { status } (an Application Status) · { profileId } (another of their Profiles).
 * 200 { id } · 400 { errors } · 401 · 403 · 404
 */
export async function PATCH(request: Request, { params }: RouteContext<"/api/applications/[id]">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  return applicationResponse(await getApplications().change(candidate.id, (await params).id, body));
}
