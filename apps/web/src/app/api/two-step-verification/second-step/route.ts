import { NextResponse } from "next/server";
import { getSessionForSecondStep, isFromTrustedOrigin } from "@/auth/server";
import { getTwoStepVerification } from "@/two-step-verification/server";

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
