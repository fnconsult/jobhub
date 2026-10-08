import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { quotaExceededResponse } from "@/billing/upgrade-prompt";
import { localeOf } from "@/i18n/server";
import { getMatchScoring } from "@/match-score/server";

const STATUS = { invalid: 400, unauthorized: 401, not_found: 404 } as const;

/**
 * The Match Score of a CV against a Job Offer. Saves nothing.
 * Body: { jobOfferId, profileId } for a signed-in Candidate's Master CV, or
 *       { jobOfferId, cv, searchCriteria? } for a CV sent with the request
 *       (a Guest's CV, without an account, or a Tailored CV).
 * A signed-in Candidate's Match Scores count against their Plan Quota; a Guest's do not.
 * 200 MatchScore · 400 { error: "invalid", errors } · 401 · 402 { error: "quota_exceeded", prompt, … } · 403 · 404
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  const body: unknown = await request.json().catch(() => undefined);
  const result = await getMatchScoring().score(candidate?.id ?? null, body);
  if (!result.ok) {
    if (result.error === "quota_exceeded") return quotaExceededResponse(result.refusal, localeOf(candidate));
    const body = result.error === "invalid" ? { error: result.error, errors: result.errors } : { error: result.error };
    return NextResponse.json(body, { status: STATUS[result.error] });
  }
  return NextResponse.json(result.matchScore);
}
