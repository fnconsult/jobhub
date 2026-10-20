import { NextResponse } from "next/server";
import { backOfficeAdministrator } from "@/admin/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getAssistantConversations } from "@/back-office-assistant/server";
import { guardrailLanguage } from "@/guardrails";
import { localeOf } from "@/i18n/server";

const STATUS = { invalid: 400, not_found: 404, unavailable: 503 } as const;

/**
 * The Administrator's next message to the Back Office Assistant, and its reply, both saved.
 * Body: { conversationId?, message }; without `conversationId` a new conversation starts.
 * A Guardrail message answers in the Administrator's Interface Language; `blocked` says whether the question and the reply are Blocked messages (#228).
 * 200 { conversation, reply, blocked: { message, reply } } · 400 { error: "invalid" } · 403 · 404 (not an Administrator, or { error: "not_found" }) · 503 { error: "unavailable" }
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const asking = await backOfficeAdministrator();
  if (!asking) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body: unknown = await request.json().catch(() => undefined);
  const result = await getAssistantConversations().send(asking, body, { language: guardrailLanguage(localeOf(await getCurrentCandidate())) });
  if (result.ok) return NextResponse.json({ conversation: result.conversation, reply: result.reply, blocked: result.blocked });
  return NextResponse.json({ error: result.error }, { status: STATUS[result.error] });
}
