import { APP_DEVICE_HEADER } from "@jobhub/shared";
import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getSignalements } from "@/signalements/server";

/**
 * Sends a Signalement for the signed-in Candidate (#374). Read by the Jobbbox team only: never sent to an AI.
 * Body: { type: "bug" | "idee" | "question", message, path, textSize, attachedQuestion?, attachedCoachReply? }
 * (a Question needs both). The browser is read from the request's User-Agent and kept only as « Chrome 141, Mac »; from
 * the Jobbbox app, its version and system from APP_DEVICE_HEADER instead (« App Jobbbox 1.4.0, iOS 18.6 », #690);
 * the path is kept without its query string or `#…`.
 * 201 { signalement } · 400 { errors: FieldError[] } · 401 · 403
 * · 429 { error: "too_many" } (10 already sent in the last 24 hours: « Vous avez envoyé beaucoup de signalements aujourd'hui, réessayez demain »)
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await getSignalements().send(candidate.id, await request.json().catch(() => undefined), {
    userAgent: request.headers.get("user-agent"),
    appDevice: request.headers.get(APP_DEVICE_HEADER),
    interfaceLanguage: candidate.interfaceLanguage,
  });
  if (result.ok) return NextResponse.json({ signalement: result.signalement }, { status: 201 });
  if ("refused" in result) return NextResponse.json({ error: result.refused }, { status: 429 });
  return NextResponse.json({ errors: result.errors }, { status: 400 });
}
