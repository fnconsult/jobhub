import { NextResponse } from "next/server";
import { getAtsScoring } from "@/ats-score/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { quotaExceededResponse } from "@/billing/upgrade-prompt";
import { localeOf } from "@/i18n/server";

type Params = { params: Promise<{ id: string }> };

/**
 * Computes the ATS Score of the Profile's current Master CV, keeps it for the
 * Profile page and proposes the ATS Fixes as Action Cards. Counts against the
 * Candidate's Plan Quota.
 * 200 { version, score, computedAt } · 401 · 402 { error: "quota_exceeded", prompt, … } · 403 · 404
 */
export async function POST(request: Request, { params }: Params) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const locale = localeOf(candidate);
  const result = await getAtsScoring().analyse(candidate.id, (await params).id, locale);
  if (result.ok) return NextResponse.json(result.atsScore);
  if (result.error === "quota_exceeded") return quotaExceededResponse(result.refusal, locale);
  return NextResponse.json({ error: result.error }, { status: 404 });
}
