import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { upgradePrompt } from "@/billing/upgrade-prompt";
import { localeOf } from "@/i18n/server";
import { getJobDigests } from "@/job-digests/server";

/**
 * Opts the Candidate in to (PUT { frequency: "daily" | "weekly" }), or changes the frequency of,
 * or opts them out of (DELETE) the Job Digest of one of their Profiles.
 * PUT: 200 { subscribed, frequency } · 400 { error: "invalid_frequency" } · 401
 *      · 402 { error: "not_included" | "above_plan", prompt } (the Plan has no Job Digest, or not that often) · 403 · 404 · 409 { error: "archived" }
 * DELETE: 200 { subscribed: false } · 401 · 403
 */
export async function PUT(request: Request, { params }: RouteContext<"/api/profiles/[id]/job-digest">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const frequency = typeof body === "object" && body !== null ? (body as Record<string, unknown>).frequency : undefined;
  const result = await getJobDigests().subscribe(candidate.id, (await params).id, frequency);
  if (result.ok) return NextResponse.json({ subscribed: result.settings.subscribed, frequency: result.settings.frequency });
  switch (result.error) {
    case "not_included":
    case "above_plan": {
      const { plan, planName, upgradeTo, upgradeToName } = result;
      const daily = result.error === "above_plan" ? ({ frequency: "daily" } as const) : {};
      const prompt = upgradePrompt({ quota: "jobDigest", plan, planName, limit: 0, upgradeTo, upgradeToName, ...daily }, localeOf(candidate));
      return NextResponse.json({ error: result.error, plan, upgradeTo, prompt }, { status: 402 });
    }
    case "invalid_frequency":
      return NextResponse.json({ error: result.error }, { status: 400 });
    case "archived":
      return NextResponse.json({ error: result.error }, { status: 409 });
    default:
      return NextResponse.json({ error: result.error }, { status: 404 });
  }
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/profiles/[id]/job-digest">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await getJobDigests().unsubscribe(candidate.id, (await params).id);
  return NextResponse.json({ subscribed: false });
}
