import { NextResponse } from "next/server";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";

/** The signed-in Candidate's Applications, newest first. 200 ApplicationSummary[] · 401 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await getApplications().list(candidate.id));
}

/**
 * Saves a Job Offer as an Application ("À postuler") with one of the Candidate's Profiles.
 * A Candidate has at most one Application per Job Offer: saving it again answers the one they have.
 * Body: { jobOfferId, profileId }.
 * 201 { id } (created) · 200 { id } (already saved) · 400 { errors } · 401 · 403 · 404
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  const saved = await getApplications().save(candidate.id, body);
  if (saved.ok) return NextResponse.json({ id: saved.application.id }, { status: saved.created ? 201 : 200 });
  if ("errors" in saved) return NextResponse.json({ errors: saved.errors }, { status: 400 });
  return NextResponse.json({ error: saved.error }, { status: 404 });
}
