import type { Locale } from "@jobhub/shared/i18n";
import { NextResponse } from "next/server";
import { quotaExceededResponse } from "../billing/upgrade-prompt";
import type { EnrichedContactsResult } from "./index";

const STATUS = { not_found: 404, disabled: 409, no_dossier: 409, search_unsupported: 409, no_details: 404, unavailable: 503 } as const;

/**
 * The HTTP response for finding or revealing Enriched Contacts:
 * 200 EnrichedContactsState · 402 { error: "quota_exceeded", prompt, … } · 404 { error: "not_found" | "no_details" }
 * · 409 { error: "disabled" | "no_dossier" | "search_unsupported" } · 503 { error: "unavailable" }
 */
export function enrichedContactsResponse(result: EnrichedContactsResult, locale: Locale): Response {
  if (result.ok) return NextResponse.json(result.state);
  if (result.error === "quota_exceeded") return quotaExceededResponse(result.refusal, locale);
  return NextResponse.json({ error: result.error }, { status: STATUS[result.error] });
}
