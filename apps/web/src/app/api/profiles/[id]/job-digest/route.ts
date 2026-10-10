import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { upgradePrompt } from "@/billing/upgrade-prompt";
import { localeOf } from "@/i18n/server";
import { getJobDigests } from "@/job-digests/server";

/**
 * Opts the Candidate in to (PUT) or out of (DELETE) the Job Digest of one of their Profiles.
 * PUT: 200 { subscribed, frequency } · 401 · 402 { error: "not_included", prompt } (the Plan has no Job Digest) · 403 · 404 · 409 { error: "archived" }
 * DELETE: 200 { subscribed: false } · 401 · 403
 */
export async function PUT(request: Request, { params }: RouteContext<"/api/profiles/[id]/job-digest">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await getJobDigests().subscribe(candidate.id, (await params).id);
  if (result.ok) return NextResponse.json({ subscribed: true, frequency: result.settings.frequency });
  if (result.error === "not_included") {
    const { plan, upgradeTo } = result;
    const prompt = upgradePrompt({ quota: "jobDigest", plan, limit: 0, upgradeTo }, localeOf(candidate));
    return NextResponse.json({ error: result.error, plan, upgradeTo, prompt }, { status: 402 });
  }
  return NextResponse.json({ error: result.error }, { status: result.error === "archived" ? 409 : 404 });
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/profiles/[id]/job-digest">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await getJobDigests().unsubscribe(candidate.id, (await params).id);
  return NextResponse.json({ subscribed: false });
}
