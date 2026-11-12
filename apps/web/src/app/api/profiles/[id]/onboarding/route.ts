import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getProfiles } from "@/profiles/server";

type Params = { params: Promise<{ id: string }> };

/**
 * Finishes the onboarding of a Profile born during it on `/profils/nouveau` (ADR-0106, #999): saves the Master CV the
 * Candidate reviewed as its next version (one for the whole onboarding, none when unchanged) and marks it done. Its Search
 * Criteria are changed beforehand by `PATCH /api/profiles/:id`.
 * Body: { basedOnVersion, masterCv: MasterCvContent }.
 * 200 { id, version } · 400 { errors: ProfileFieldError[] } · 401 · 403 · 404 (also anyone else's) ·
 * 409 { currentVersion } · 409 { error: "archived" | "finished" }
 */
export async function POST(request: Request, { params }: Params) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  const finished = await getProfiles().finishOnboarding(candidate.id, (await params).id, body);
  if (finished.ok) return NextResponse.json({ id: finished.profile.id, version: finished.profile.masterCv.version });
  if ("errors" in finished) return NextResponse.json({ errors: finished.errors }, { status: 400 });
  if ("conflict" in finished) return NextResponse.json({ currentVersion: finished.conflict.currentVersion }, { status: 409 });
  return NextResponse.json({ error: finished.error }, { status: finished.error === "not_found" ? 404 : 409 });
}
