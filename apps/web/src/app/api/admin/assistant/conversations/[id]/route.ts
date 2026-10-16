import { NextResponse } from "next/server";
import { backOfficeAdministrator } from "@/admin/server";
import { isFromTrustedOrigin } from "@/auth/server";
import { getAssistantConversations } from "@/back-office-assistant/server";

type Context = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

/** One of the Administrator's Back Office Assistant conversations, with its messages. 200 { conversation } · 404 */
export async function GET(_request: Request, { params }: Context) {
  const asking = await backOfficeAdministrator();
  if (!asking) return notFound();
  const conversation = await getAssistantConversations().open(asking.administrator.id, (await params).id);
  return conversation ? NextResponse.json({ conversation }) : notFound();
}

/** Renames a conversation. Body: { title }. 200 { conversation } · 400 { error: "invalid" } · 403 · 404 */
export async function PATCH(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const asking = await backOfficeAdministrator();
  if (!asking) return notFound();
  const body = await request.json().catch(() => undefined);
  const result = await getAssistantConversations().rename(asking.administrator.id, (await params).id, body?.title);
  if (result.ok) return NextResponse.json({ conversation: result.conversation });
  return result.error === "invalid" ? NextResponse.json({ error: "invalid" }, { status: 400 }) : notFound();
}

/** Deletes a conversation and its messages. 204 · 403 · 404 */
export async function DELETE(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const asking = await backOfficeAdministrator();
  if (!asking) return notFound();
  return (await getAssistantConversations().delete(asking.administrator.id, (await params).id)) ? new NextResponse(null, { status: 204 }) : notFound();
}
