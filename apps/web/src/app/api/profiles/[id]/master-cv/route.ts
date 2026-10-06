import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getProfiles } from "@/profiles/server";

type Params = { params: Promise<{ id: string }> };

/**
 * Saves the Candidate's edits to a Profile's Master CV as its next version.
 * Body: { basedOnVersion, content: MasterCvContent }.
 * 200 { version } · 400 { errors: ProfileFieldError[] } · 409 { currentVersion } · 401 · 403 · 404
 */
export async function PUT(request: Request, { params }: Params) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  const saved = await getProfiles().saveMasterCv(candidate.id, (await params).id, body);
  if (!saved) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (saved.ok) return NextResponse.json({ version: saved.profile.masterCv.version });
  if ("conflict" in saved) return NextResponse.json({ currentVersion: saved.conflict.currentVersion }, { status: 409 });
  return NextResponse.json({ errors: saved.errors }, { status: 400 });
}
