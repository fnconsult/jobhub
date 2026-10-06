import { NextResponse } from "next/server";
import type { ProfileChangeResult } from "./index";

/**
 * The HTTP response for the outcome of creating or changing a Profile:
 * `status` { id } · 400 { errors: ProfileFieldError[] } · 404 · 409 { error: "plan_quota_reached" }
 */
export function profileResponse(result: ProfileChangeResult, status = 200): NextResponse {
  if (result.ok) return NextResponse.json({ id: result.profile.id }, { status });
  if ("errors" in result) return NextResponse.json({ errors: result.errors }, { status: 400 });
  return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 409 });
}
