import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCoachConversations } from "@/coach-conversations/server";

type Context = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

/** One of the Candidate's Coach Conversations, with its messages. 200 { conversation } · 401 · 404 */
export async function GET(_request: Request, { params }: Context) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const conversation = await getCoachConversations().open(candidate.id, (await params).id);
  return conversation ? NextResponse.json({ conversation }) : notFound();
}

/** Renames a Coach Conversation. Body: { title }. 200 { conversation } · 400 { error: "invalid" } · 401 · 403 · 404 */
export async function PATCH(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => undefined);
  const result = await getCoachConversations().rename(candidate.id, (await params).id, body?.title);
  if (result.ok) return NextResponse.json({ conversation: result.conversation });
  return result.error === "invalid" ? NextResponse.json({ error: "invalid" }, { status: 400 }) : notFound();
}

/** Deletes a Coach Conversation and its messages. 204 · 401 · 403 · 404 */
export async function DELETE(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return (await getCoachConversations().delete(candidate.id, (await params).id)) ? new NextResponse(null, { status: 204 }) : notFound();
}
