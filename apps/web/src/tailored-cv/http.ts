import { NextResponse } from "next/server";
import type { TailoredCvResult } from "./index";

/**
 * The HTTP response for proposing, answering or saving a Tailored CV:
 * 200 ApplicationTailoredCv · 400 { errors } · 404 · 409 { error: "master_cv_changed" | "proposal_changed" } · 503 { error: "unavailable" }
 */
export function tailoredCvResponse(result: TailoredCvResult): NextResponse {
  if (result.ok) return NextResponse.json(result.tailoredCv);
  if ("errors" in result) return NextResponse.json({ errors: result.errors }, { status: 400 });
  const status = { not_found: 404, master_cv_changed: 409, proposal_changed: 409, unavailable: 503 }[result.error];
  return NextResponse.json({ error: result.error }, { status });
}
