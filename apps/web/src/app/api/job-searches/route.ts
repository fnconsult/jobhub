import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { quotaExceededResponse } from "@/billing/upgrade-prompt";
import { getRequestLocale } from "@/i18n/server";
import { getJobSearches } from "@/job-searches/server";

/**
 * Asks the AI Coach to search for Job Offers for one of the Candidate's Profiles.
 * Body: { profileId }.
 * 201 { id } · 400 { errors } · 401 · 402 { error: "quota_exceeded", prompt, … } · 403 · 404 · 409 { error: "archived" }
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  const started = await getJobSearches().start(candidate.id, body);
  if (started.ok) return NextResponse.json({ id: started.jobSearch.id }, { status: 201 });
  if ("errors" in started) return NextResponse.json({ errors: started.errors }, { status: 400 });
  if (started.error === "quota_exceeded") return quotaExceededResponse(started.refusal, await getRequestLocale());
  return NextResponse.json({ error: started.error }, { status: started.error === "not_found" ? 404 : 409 });
}
