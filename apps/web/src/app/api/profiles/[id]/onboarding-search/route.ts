import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getJobSearches } from "@/job-searches/server";

type Params = { params: Promise<{ id: string }> };

/**
 * Starts, or starts again, the Job Search the onboarding offers a Profile it created (ADR-0105, #1000), outside the Plan
 * Quota: `/profils/nouveau` calls it once the Profile is born, then once more when its target role or locations change
 * (the first, still searching, is stopped). Only while the Profile's onboarding is in progress: a Profile created
 * otherwise, or whose onboarding is finished, is refused, as is a third call.
 * No body.
 * 201 { id, offered: "first" | "restart" } · 401 · 403 · 404 (also anyone else's) · 409 { error: "archived" | "not_onboarding" | "used_up" }
 */
export async function POST(request: Request, { params }: Params) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const started = await getJobSearches().startOffered(candidate.id, (await params).id);
  if (started.ok) return NextResponse.json({ id: started.jobSearch.id, offered: started.offered }, { status: 201 });
  return NextResponse.json({ error: started.error }, { status: started.error === "not_found" ? 404 : 409 });
}
