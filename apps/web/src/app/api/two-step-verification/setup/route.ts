import { NextResponse } from "next/server";
import { getSessionForSecondStep, isFromTrustedOrigin } from "@/auth/server";
import { getPendingSessions } from "@/two-step-verification/proxy-gate";
import { getTwoStepVerification, tellTwoStepChange } from "@/two-step-verification/server";

/**
 * The session on this request when it must set up Two-step verification before anything else (#665, ADR-0075): an
 * Administrator or a Human Coach signed in by magic link with no factor yet. Null for any other, whom this endpoint
 * does not answer: a Candidate sets it up from Mon compte.
 */
async function sessionToSetUp(request: Request) {
  const current = await getSessionForSecondStep();
  if (!current) return null;
  const pending = await getPendingSessions().of(request.headers);
  if (pending?.step !== "setup" || pending.sessionId !== current.session.id) return null;
  return current;
}

/**
 * Starts setting up an authenticator app on the second step's page, or starts again: the secret, as the QR code's
 * address and as the key to type. A session pending its setup reaches it.
 * 200 { secret, uri } · 403 { error: "forbidden" | "not_required" }
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const current = await sessionToSetUp(request);
  if (!current) return NextResponse.json({ error: "not_required" }, { status: 403 });
  return NextResponse.json(await getTwoStepVerification().startSetup(current.user.id, current.user.email), { headers: { "Cache-Control": "no-store" } });
}

/**
 * Turns Two-step verification on with the app's first code, which counts as the session's second step: it is no
 * longer pending. Emails the account. The 10 backup codes come back once. Body: { code }.
 * 200 { backupCodes } · 400 { error: "invalid_code" } · 403 { error: "forbidden" | "not_required" } · 409 { error: "no_setup" | "already_enabled" }
 */
export async function PUT(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const current = await sessionToSetUp(request);
  if (!current) return NextResponse.json({ error: "not_required" }, { status: 403 });
  const body: unknown = await request.json().catch(() => undefined);
  const code = typeof body === "object" && body !== null && "code" in body && typeof body.code === "string" ? body.code.slice(0, 64) : "";

  const result = await getTwoStepVerification().confirmSetup({ candidateId: current.user.id, sessionId: current.session.id }, code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "invalid_code" ? 400 : 409 });
  await tellTwoStepChange(current.user, "enabled");
  return NextResponse.json({ backupCodes: result.backupCodes }, { headers: { "Cache-Control": "no-store" } });
}
