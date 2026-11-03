import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCoachConversations } from "@/coach-conversations/server";

/**
 * The ✕ of the conversations' welcome panel (the AI disclosure and the page's introduction): closed for the Candidate, on
 * every device, never shown again; the « Coach IA » badge by the box shows it on demand. 204 · 401 · 403
 */
export async function DELETE(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await getCoachConversations().closeWelcome(candidate.id);
  return new NextResponse(null, { status: 204 });
}
