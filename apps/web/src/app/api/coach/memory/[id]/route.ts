import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCoachMemory } from "@/coach-memory/server";

type Context = { params: Promise<{ id: string }> };

/** Edits an item of the Candidate's Coach Memory. Body: { kind, text }. 200 { item } · 400 { error: "invalid" } · 401 · 403 · 404 */
export async function PATCH(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  const result = await getCoachMemory().edit(candidate.id, (await params).id, body);
  if (result.ok) return NextResponse.json({ item: result.item });
  return NextResponse.json({ error: result.error }, { status: result.error === "invalid" ? 400 : 404 });
}

/** Deletes an item of the Candidate's Coach Memory. 204 · 401 · 403 · 404 */
export async function DELETE(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return (await getCoachMemory().delete(candidate.id, (await params).id))
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: "not_found" }, { status: 404 });
}
