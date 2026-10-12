import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCoachConversations } from "@/coach-conversations/server";

const STATUS = { invalid: 400, not_found: 404, unavailable: 503 } as const;

/**
 * The Candidate's next message in a Coach Conversation, and the AI Coach's reply, both saved.
 * Body: { conversationId?, message, focus?: { kind: "profile" | "application", id } };
 * without `conversationId` a new Coach Conversation starts, attached to the Profile in view.
 * 200 { conversation, reply } · 400 { error: "invalid" } · 401 · 403 · 404 { error: "not_found" } · 503 { error: "unavailable" }
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  const result = await getCoachConversations().send(candidate.id, body);
  if (result.ok) return NextResponse.json({ conversation: result.conversation, reply: result.reply });
  return NextResponse.json({ error: result.error }, { status: STATUS[result.error] });
}
