import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { profileResponse } from "@/profiles/http";
import { getProfiles } from "@/profiles/server";

/**
 * The signed-in Candidate's active Profiles (archived ones left out), oldest first:
 * what the extension offers to save a captured Job Offer with.
 * 200 { id, name }[] · 401
 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const profiles = await getProfiles().list(candidate.id);
  return NextResponse.json(profiles.filter((profile) => !profile.archived).map(({ id, name }) => ({ id, name })));
}

/**
 * Saves a CV draft the Candidate has reviewed as a new Profile.
 * Body: { masterCv, searchCriteria }.
 * 201 { id } · 400 { errors: ProfileFieldError[] } · 401 · 403 · 409 { error: "plan_quota_reached", prompt }
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  return profileResponse(await getProfiles().create(candidate.id, body), candidate, 201);
}
