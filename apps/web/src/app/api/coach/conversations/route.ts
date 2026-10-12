import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getCoachConversations } from "@/coach-conversations/server";

/** The Candidate's Coach Conversations, most recently active first. 200 { conversations } · 401 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ conversations: await getCoachConversations().list(candidate.id) });
}
