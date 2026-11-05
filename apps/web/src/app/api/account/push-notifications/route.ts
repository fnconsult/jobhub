import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { PUSH_EVENT_IDS, type PushEvent } from "@/push-notifications";
import { getPushNotifications } from "@/push-notifications/server";

const body = z.object({ event: z.enum(PUSH_EVENT_IDS as [PushEvent, ...PushEvent[]]), enabled: z.boolean() });

/**
 * The person switches one Push notification event on or off (Mon compte, Rappels, on the web or in the app's WebView, #698).
 * Body: { event, enabled }.
 * 200 { event, enabled } · 400 · 401 · 403
 */
export async function PUT(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const person = await getCurrentCandidate();
  if (!person) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await getPushNotifications().setEnabled(person.id, parsed.data.event, parsed.data.enabled);
  return NextResponse.json(parsed.data);
}
