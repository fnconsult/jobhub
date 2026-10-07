import { NextResponse } from "next/server";
import type { AddInterviewResult } from "./index";

/**
 * The HTTP response for the outcome of changing an Application:
 * 200 { id } · 400 { errors: ApplicationFieldError[] } · 404 · 409 { error: "not_in_interview" }
 */
export function applicationResponse(result: AddInterviewResult): NextResponse {
  if (result.ok) return NextResponse.json({ id: result.application.id });
  if ("errors" in result) return NextResponse.json({ errors: result.errors }, { status: 400 });
  return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 409 });
}
