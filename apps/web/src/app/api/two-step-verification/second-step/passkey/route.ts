import { NextResponse } from "next/server";
import { getSessionForSecondStep, isFromTrustedOrigin } from "@/auth/server";
import { getTwoStepVerification } from "@/two-step-verification/server";

/**
 * The second step with a passkey (ADR-0075, #664), reached by a pending session as by a signed-in one (Mon compte asks a
 * second step before turning the verification off). Two calls, each a POST:
 *  - `{}`: what the browser is asked to sign, one of the account's own passkeys. 200 { options } · 409 { error: "no_passkey" }
 *  - `{ response }`: the browser's answer. Done, the session is no longer pending. A passkey of another account is
 *    refused, the session staying pending. 200 { ok: true } · 400 { error: "invalid_passkey" } · 409 { error: "not_enabled" } · 429 { error: "locked", retryAt }
 * 401 when signed out · 403 from another origin.
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const current = await getSessionForSecondStep();
  if (!current) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  const by = { candidateId: current.user.id, sessionId: current.session.id };
  const twoStep = getTwoStepVerification();

  if (typeof body !== "object" || body === null || !("response" in body)) {
    const options = await twoStep.passkeyChallenge(by);
    if (!options) return NextResponse.json({ error: "no_passkey" }, { status: 409 });
    return NextResponse.json({ options }, { headers: { "Cache-Control": "no-store" } });
  }

  const result = await twoStep.verifyPasskey(by, body.response);
  if (result.ok) return NextResponse.json({ ok: true });
  if (result.error === "locked") return NextResponse.json({ error: "locked", retryAt: result.retryAt }, { status: 429 });
  return NextResponse.json({ error: result.error }, { status: result.error === "not_enabled" ? 409 : 400 });
}
