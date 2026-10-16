import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCoachMemory } from "@/coach-memory/server";

/** The Candidate's Coach Memory, oldest item first. 200 { items } · 401 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ items: await getCoachMemory().list(candidate.id) });
}

/**
 * Saves one item the Candidate confirmed in their Coach Memory. Body: { kind: "goal" | "constraint" | "decision", text }.
 * 201 { item } · 400 { error: "invalid" } · 401 · 403 · 409 { error: "full" }
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  const result = await getCoachMemory().confirm(candidate.id, body);
  if (result.ok) return NextResponse.json({ item: result.item }, { status: 201 });
  return NextResponse.json({ error: result.error }, { status: result.error === "full" ? 409 : 400 });
}
