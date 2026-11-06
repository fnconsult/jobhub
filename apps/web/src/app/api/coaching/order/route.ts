import { isSupportedLocale, DEFAULT_LOCALE } from "@jobhub/shared/i18n";
import type { CoachingOrderResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { BillingError } from "@/billing";
import { getCandidateReads } from "@/candidate-reads/server";
import { getOrders } from "@/orders/server";

/**
 * The Order page of a Coaching Session in the Jobbbox app (#694, ADR-0074, ADR-0076): what the app shows before Stripe
 * Checkout, which it opens in its in-app browser (App Store guideline 3.1.3(d)).
 *
 * GET `?coach=<id>`: the Human Coach, the Candidate's Coaching Session Price and the CGV version to accept.
 * 200 CoachingOrderResponse · 401 · 404 (no such Human Coach to book, or Coaching Sessions not payable) · 503
 */
export async function GET(request: Request) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const coachId = new URL(request.url).searchParams.get("coach") ?? "";
  try {
    const order = coachId ? await getCandidateReads().coachingOrder(candidate.id, coachId) : null;
    if (!order) return NextResponse.json({ error: "not_orderable" }, { status: 404 });
    return NextResponse.json<CoachingOrderResponse>(order);
  } catch (error) {
    console.error("[coaching] Coaching Session order unavailable", error);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

/**
 * « Passer au paiement », from the app. Body: { coachId, cgv (the CGV version ticked), immediateExecution ("yes" when
 * ticked) }. The boxes are checked here as for the web's Order page (Orders.place); the Checkout Session it creates
 * returns to the app by its universal link, paid or not. The Coaching Session is recorded by Stripe's signed webhook alone.
 * 200 { url } (Stripe Checkout) · 400 { error: "cgv_required" } · 401 · 403 · 404 { error: "not_orderable" } ·
 * 503 { error: "unavailable" } (payments not configured) · 502 { error: "failed" } (Stripe refused or unreachable)
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  const { coachId, cgv, immediateExecution } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof coachId !== "string" || !coachId) return NextResponse.json({ error: "not_orderable" }, { status: 404 });
  const language: unknown = (candidate as { interfaceLanguage?: unknown }).interfaceLanguage;
  try {
    const placed = await getOrders().place(candidate, { kind: "coachingSession", coachId, inApp: true }, { cgv, immediateExecution }, isSupportedLocale(language) ? language : DEFAULT_LOCALE);
    if (placed.ok) return NextResponse.json({ url: placed.url });
    return NextResponse.json({ error: placed.error }, { status: placed.error === "cgv_required" ? 400 : 404 });
  } catch (error) {
    console.error("[coaching] checkout from the app failed", error);
    const unavailable = error instanceof BillingError && (error.code === "stripe_not_configured" || error.code === "coaching_sessions_not_configured");
    return NextResponse.json({ error: unavailable ? "unavailable" : "failed" }, { status: unavailable ? 503 : 502 });
  }
}
