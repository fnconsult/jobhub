import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCoach } from "@/coach/server";

/**
 * The AI Coach's next reply in the Coach Panel.
 * Body: { messages: { from: "candidate" | "coach", text }[], focus?: { kind: "profile" | "application", id } }.
 * 200 { reply } · 400 { error: "invalid" } · 401 · 403 · 503 { error: "unavailable" }
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  const result = await getCoach().reply(candidate.id, body);
  if (result.ok) return NextResponse.json({ reply: result.reply });
  return NextResponse.json({ error: result.error }, { status: result.error === "invalid" ? 400 : 503 });
}
