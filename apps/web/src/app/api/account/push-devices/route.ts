import { NextResponse } from "next/server";
import { z } from "zod";
import { isFromTheApp } from "@/auth/app-requests";
import { getCurrentSession, isFromTrustedOrigin } from "@/auth/server";
import { getPushNotifications } from "@/push-notifications/server";

/** Whether a request may change the signed-in person's devices: the app's (its `expo-origin`), or the web app's own. */
const trusted = (request: Request) => isFromTheApp(request) || isFromTrustedOrigin(request);

/**
 * The app registers the device it runs on for Push notifications (#698, ADR-0076), at each start while signed in and
 * allowed to notify: the token its platform gave it, tied to this account and to the session signed in on it.
 * Body: { platform: "ios" | "android", token, language: "fr" | "en", environment?: "production" | "development" }.
 * 204 · 400 · 401 · 403
 */
export async function POST(request: Request) {
  if (!trusted(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const current = await getCurrentSession();
  if (!current) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const registered = await getPushNotifications().register({ id: current.user.id, sessionId: current.session.id }, await request.json().catch(() => undefined));
  return registered.ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "invalid" }, { status: 400 });
}

const forgotten = z.object({ token: z.string().min(1).max(4096) });

/**
 * The app forgets the device it runs on (signing out, or notifications turned off in its settings): nothing more is sent
 * to it. Signing out on the web app, or revoking its session from Mon compte, forgets it too.
 * Body: { token }.
 * 204 · 400 · 401 · 403
 */
export async function DELETE(request: Request) {
  if (!trusted(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const current = await getCurrentSession();
  if (!current) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = forgotten.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await getPushNotifications().forget(current.user.id, parsed.data.token);
  return new NextResponse(null, { status: 204 });
}
