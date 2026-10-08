import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { profileResponse } from "@/profiles/http";
import { getProfiles } from "@/profiles/server";

type Context = { params: Promise<{ id: string }> };

/**
 * Changes one of the Candidate's Profiles.
 * Body: { name } renames it · { archived: true | false } archives or restores it.
 * 200 { id } · 400 { errors: ProfileFieldError[] } · 401 · 403 · 404 · 409 { error: "plan_quota_reached", prompt }
 */
export async function PATCH(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body: unknown = await request.json().catch(() => undefined);
  const profiles = getProfiles();
  if (body && typeof body === "object" && "archived" in body) {
    const { archived } = body;
    if (typeof archived !== "boolean") return NextResponse.json({ errors: [{ field: "archived", code: "invalid" }] }, { status: 400 });
    return profileResponse(await (archived ? profiles.archive(candidate.id, id) : profiles.restore(candidate.id, id)), candidate);
  }
  return profileResponse(await profiles.rename(candidate.id, id, body), candidate);
}
