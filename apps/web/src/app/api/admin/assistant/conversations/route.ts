import { NextResponse } from "next/server";
import { backOfficeAdministrator } from "@/admin/server";
import { getAssistantConversations } from "@/back-office-assistant/server";

/** The Administrator's Back Office Assistant conversations, most recently active first. 200 { conversations } · 404 (not an Administrator) */
export async function GET() {
  const asking = await backOfficeAdministrator();
  if (!asking) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ conversations: await getAssistantConversations().list(asking.administrator.id) });
}
