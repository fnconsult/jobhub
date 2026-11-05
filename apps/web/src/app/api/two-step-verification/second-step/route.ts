import { NextResponse } from "next/server";
import { getSessionForSecondStep, isFromTrustedOrigin } from "@/auth/server";
import { secondStepRead } from "@/two-step-verification/pending-sessions";
import { getPendingSessions } from "@/two-step-verification/proxy-gate";
import { getTwoStepVerification } from "@/two-step-verification/server";

/**
 * What the session has to do before anything else (#688): its second step, with the account's passkeys and its
 * authenticator app when it has them, or the setup (an Administrator or a Human Coach with no factor yet), or nothing.
 * Read by the native app, which asks the step on its own screen; the web's page reads the same (secondStepRead).
 * 200 SecondStepRead (@jobhub/shared) · 401
 */
export async function GET(request: Request) {
  const current = await getSessionForSecondStep();
  if (!current) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const pending = await getPendingSessions().of(request.headers);
  const { factors } = pending?.step === "second_step" ? await getTwoStepVerification().status(current.user.id) : { factors: [] };
  return NextResponse.json(secondStepRead(pending, factors), { headers: { "Cache-Control": "no-store" } });
}

/**
 * The second step (ADR-0075): a code from the Candidate's authenticator app or a backup code. Done, the session is no
 * longer pending, and Mon compte may turn the verification off or renew the backup codes for 10 minutes. The one
 * endpoint a pending session reaches, besides sign-out. Body: { code }.
 * 200 { ok: true } · 400 { error: "invalid_code" } · 401 · 403 · 409 { error: "not_enabled" } · 429 { error: "locked", retryAt }
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const current = await getSessionForSecondStep();
  if (!current) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  const code = typeof body === "object" && body !== null && "code" in body && typeof body.code === "string" ? body.code : "";
  if (!code.trim()) return NextResponse.json({ error: "invalid_code" }, { status: 400 });

  const result = await getTwoStepVerification().verify({ candidateId: current.user.id, sessionId: current.session.id }, code.slice(0, 64));
  if (result.ok) return NextResponse.json({ ok: true });
  if (result.error === "locked") return NextResponse.json({ error: "locked", retryAt: result.retryAt }, { status: 429 });
  return NextResponse.json({ error: result.error }, { status: result.error === "not_enabled" ? 409 : 400 });
}
