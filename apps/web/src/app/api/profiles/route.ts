import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getProfiles } from "@/profiles/server";

/**
 * Saves a CV draft the Candidate has reviewed as a new Profile.
 * Body: { masterCv, searchCriteria }.
 * 201 { id } · 400 { errors: ProfileFieldError[] } · 401 · 403
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  const created = await getProfiles().create(candidate.id, body);
  if (!created.ok) return NextResponse.json({ errors: created.errors }, { status: 400 });
  return NextResponse.json({ id: created.profile.id }, { status: 201 });
}
