import { NextResponse } from "next/server";
import type { TailoredDocumentsResult } from "./index";

/**
 * The HTTP response for drafting or editing a Tailored Document:
 * 200 ApplicationDrafts · 400 { errors } · 404 · 503 { error: "unavailable" }
 */
export function tailoredDocumentsResponse(result: TailoredDocumentsResult): NextResponse {
  if (result.ok) return NextResponse.json(result.drafts);
  if ("errors" in result) return NextResponse.json({ errors: result.errors }, { status: 400 });
  return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 503 });
}
