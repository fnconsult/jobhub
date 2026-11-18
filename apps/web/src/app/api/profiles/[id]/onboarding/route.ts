import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import type { FinishOnboardingResult } from "@/profiles";
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
  return answer(await getProfiles().finishOnboarding(candidate.id, (await params).id, body));
}

/**
 * « Continuer plus tard » (#1046): saves the answers given during the onboarding interview as the Master CV's next version
 * (none when unchanged) and the block it reached, where « Reprendre la création » reopens it; the onboarding stays in
 * progress. Its Search Criteria are saved as they are answered, by `PATCH /api/profiles/:id`.
 * Body: { basedOnVersion, masterCv: MasterCvContent, block: "criteria" | "career" | "skills" | "presentation", turns }.
 * Answers as POST.
 */
export async function PUT(request: Request, { params }: Params) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  return answer(await getProfiles().continueOnboardingLater(candidate.id, (await params).id, body));
}

function answer(result: FinishOnboardingResult) {
  if (result.ok) return NextResponse.json({ id: result.profile.id, version: result.profile.masterCv.version });
  if ("errors" in result) return NextResponse.json({ errors: result.errors }, { status: 400 });
  if ("conflict" in result) return NextResponse.json({ currentVersion: result.conflict.currentVersion }, { status: 409 });
  return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 409 });
}
