import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { profileResponse } from "@/profiles/http";
import { getProfiles } from "@/profiles/server";

/**
 * Duplicates one of the Candidate's Profiles under a new name.
 * Body: { name }.
 * 201 { id } · 400 { errors: ProfileFieldError[] } · 401 · 403 · 404 · 409 { error: "plan_quota_reached" }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  return profileResponse(await getProfiles().duplicate(candidate.id, (await params).id, body), 201);
}
