import type { ShareCaptureAnswer } from "@jobhub/shared";
import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { localeOf } from "@/i18n/server";
import { getShareCaptures } from "@/share-captures/server";

const STATUS = { text_needed: 422, not_a_job_offer: 422, invalid: 400, unavailable: 503 } as const;

/**
 * Share capture (#697): a job posting the Candidate sent to the Jobbbox app from another app's share sheet becomes their
 * Private Job Offer, opened in a new Coach Conversation (see ../../../share-captures). A signed-in Candidate only.
 * Body: { url?, text? }, as shared and checked on the capture screen. The link is read here, never on the device.
 * Nothing of the body is kept but the Private Job Offer.
 * 200 { jobOffer: { id, title, employer }, conversation: { id, title } } · 400 { error: "invalid" } · 401 · 403
 * · 422 { error: "text_needed", reason: "forbidden_site" | "unreadable" | "not_a_job_offer" } (the screen asks for the
 * offer's text) · 422 { error: "not_a_job_offer" } · 503 { error: "unavailable" }.
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  const result = await getShareCaptures().capture(candidate.id, body, localeOf(candidate));
  if (!result.ok) {
    const answer: ShareCaptureAnswer = result.error === "text_needed" ? { error: result.error, reason: result.reason } : { error: result.error };
    return NextResponse.json(answer, { status: STATUS[result.error] });
  }
  const answer: ShareCaptureAnswer = { jobOffer: { id: result.jobOffer.id, title: result.jobOffer.title, employer: result.jobOffer.employer ?? null }, conversation: result.conversation };
  return NextResponse.json(answer);
}
