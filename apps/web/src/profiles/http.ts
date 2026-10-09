import { NextResponse } from "next/server";
import type { ChangeSearchCriteriaResult, ProfileChangeResult } from "./index";
import { profileUpgradePromptFor } from "./server";

/**
 * The HTTP response for the outcome of creating or changing a Profile:
 * `status` { id } · 400 { errors: ProfileFieldError[] } · 404 · 409 { error: "archived" } ·
 * 409 { error: "plan_quota_reached", prompt: UpgradePrompt | null } (the Upgrade Prompt, in the Candidate's Interface Language)
 */
export async function profileResponse(
  result: ProfileChangeResult | ChangeSearchCriteriaResult,
  candidate: { id: string; interfaceLanguage?: unknown },
  status = 200,
): Promise<NextResponse> {
  if (result.ok) return NextResponse.json({ id: result.profile.id }, { status });
  if ("errors" in result) return NextResponse.json({ errors: result.errors }, { status: 400 });
  if (result.error === "not_found") return NextResponse.json({ error: result.error }, { status: 404 });
  if (result.error === "archived") return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ error: result.error, prompt: await profileUpgradePromptFor(candidate) }, { status: 409 });
}
