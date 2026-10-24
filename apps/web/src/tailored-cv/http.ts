import { NextResponse } from "next/server";
import { STOPPED, type ActionOutcome } from "../ndjson";
import type { TailoredCvResult } from "./index";

/**
 * The HTTP response for proposing, answering or saving a Tailored CV:
 * 200 ApplicationTailoredCv · 400 { errors } · 404 · 409 { error: "master_cv_changed" | "proposal_changed" } · 499 { error: "stopped" }
 * · 503 { error: "unavailable", reason? } (its Failure Reason, #367)
 */
export function tailoredCvOutcome(result: TailoredCvResult): ActionOutcome {
  if (result.ok) return { status: 200, body: result.tailoredCv };
  if ("errors" in result) return { status: 400, body: { errors: result.errors } };
  const reason = result.error === "unavailable" && result.reason ? { reason: result.reason } : {};
  return { status: { not_found: 404, master_cv_changed: 409, proposal_changed: 409, unavailable: 503, stopped: STOPPED }[result.error], body: { error: result.error, ...reason } };
}

/** The same, as a JSON response. */
export function tailoredCvResponse(result: TailoredCvResult): NextResponse {
  const { status, body } = tailoredCvOutcome(result);
  return NextResponse.json(body, { status });
}
