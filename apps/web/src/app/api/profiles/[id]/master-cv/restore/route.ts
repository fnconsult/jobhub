import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getProfiles } from "@/profiles/server";

type Params = { params: Promise<{ id: string }> };

/**
 * Restores an earlier version of a Profile's Master CV, saved as its next version.
 * Body: { version }.
 * 200 { version } (the new current version) · 401 · 403 · 404 (no such Profile or version)
 */
export async function POST(request: Request, { params }: Params) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  const version = body && typeof body === "object" && "version" in body ? body.version : undefined;
  const restored = typeof version === "number" ? await getProfiles().restoreMasterCv(candidate.id, (await params).id, version) : null;
  if (!restored) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ version: restored.masterCv.version });
}
