import { NextResponse } from "next/server";
import { getCurrentSession, isFromTrustedOrigin } from "@/auth/server";
import { isRecentSecondStep } from "@/two-step-verification";
import { getTwoStepVerification, mustHaveIt, tellTwoStepChange } from "@/two-step-verification/server";

/**
 * Mon compte, « Sécurité » (#663): starts setting up an authenticator app, or starts again. The secret is shown once,
 * as the QR code's address and as the key to type.
 * 200 { secret, uri } · 401 · 403 · 409 { error: "already_enabled" }
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const current = await getCurrentSession();
  if (!current) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const twoStep = getTwoStepVerification();
  if (await twoStep.isEnabled(current.user.id)) return NextResponse.json({ error: "already_enabled" }, { status: 409 });
  return NextResponse.json(await twoStep.startSetup(current.user.id, current.user.email), { headers: { "Cache-Control": "no-store" } });
}

/**
 * Turns Two-step verification on (a second step done, too), and emails the account: with the app's first code, body
 * { code }, or with the passkeys just added in Mon compte (#664), body { passkey: true }. The 10 backup codes come back once.
 * 200 { backupCodes } · 400 { error: "invalid_code" } · 401 · 403 · 409 { error: "no_setup" | "no_passkey" | "already_enabled" }
 */
export async function PUT(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const current = await getCurrentSession();
  if (!current) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  const code = typeof body === "object" && body !== null && "code" in body && typeof body.code === "string" ? body.code.slice(0, 64) : "";

  const by = { candidateId: current.user.id, sessionId: current.session.id };
  const withPasskey = typeof body === "object" && body !== null && "passkey" in body && body.passkey === true;
  const result = withPasskey ? await getTwoStepVerification().enableWithPasskey(by) : await getTwoStepVerification().confirmSetup(by, code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "invalid_code" ? 400 : 409 });
  await tellTwoStepChange(current.user, "enabled");
  return NextResponse.json({ backupCodes: result.backupCodes }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Turns Two-step verification off, and emails the account. It takes a second step done less than 10 minutes ago in
 * this session (ADR-0075): the page asks for one first. An Administrator or a Human Coach cannot (#665).
 * 204 · 401 · 403 { error: "forbidden" | "mandatory" | "recent_second_step_required" } · 409 { error: "not_enabled" }
 */
export async function DELETE(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const current = await getCurrentSession();
  if (!current) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (await mustHaveIt(current.user.id)) return NextResponse.json({ error: "mandatory" }, { status: 403 });
  if (!isRecentSecondStep(current.session.twoStepVerifiedAt)) return NextResponse.json({ error: "recent_second_step_required" }, { status: 403 });

  if (!(await getTwoStepVerification().disable(current.user.id))) return NextResponse.json({ error: "not_enabled" }, { status: 409 });
  await tellTwoStepChange(current.user, "disabled");
  return new Response(null, { status: 204 });
}
