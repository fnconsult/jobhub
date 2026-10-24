import { NextResponse } from "next/server";
import { STOPPED, type ActionOutcome } from "../ndjson";
import type { TailoredDocumentsResult } from "./index";

/**
 * The HTTP response for drafting or editing a Tailored Document:
 * 200 ApplicationDrafts · 400 { errors } · 404 · 499 { error: "stopped" } · 503 { error: "unavailable", reason? } (its Failure Reason, #367)
 */
export function tailoredDocumentsOutcome(result: TailoredDocumentsResult): ActionOutcome {
  if (result.ok) return { status: 200, body: result.drafts };
  if ("errors" in result) return { status: 400, body: { errors: result.errors } };
  const reason = result.error === "unavailable" && result.reason ? { reason: result.reason } : {};
  return { status: { not_found: 404, unavailable: 503, stopped: STOPPED }[result.error], body: { error: result.error, ...reason } };
}

/** The same, as a JSON response. */
export function tailoredDocumentsResponse(result: TailoredDocumentsResult): NextResponse {
  const { status, body } = tailoredDocumentsOutcome(result);
  return NextResponse.json(body, { status });
}
