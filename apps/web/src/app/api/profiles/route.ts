import type { ProfilesResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCandidateReads } from "@/candidate-reads/server";
import { extensionCallOf } from "@/extension-events/server";
import { profileResponse } from "@/profiles/http";
import { getProfiles } from "@/profiles/server";

/**
 * The signed-in Candidate's active Profiles (archived ones left out), oldest first:
 * what the extension offers to save a captured Job Offer with, and the app's Profiles (#684).
 * 200 ProfilesResponse ({ id, name }[]) · 401
 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json<ProfilesResponse>(await getCandidateReads().profiles(candidate.id));
}

/**
 * Saves a CV draft the Candidate has reviewed as a new Profile. From the extension, it writes its Extension Event
 * `profile_created` with it (#924).
 * Body: { masterCv, searchCriteria }.
 * 201 { id } · 400 { errors: ProfileFieldError[] } · 401 · 403 · 409 { error: "plan_quota_reached", prompt }
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  const extension = await extensionCallOf(request, candidate.id);
  return profileResponse(await getProfiles().create(candidate.id, body, extension ? { extension } : {}), candidate, 201);
}
