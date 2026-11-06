import type { Locale } from "@jobhub/shared/i18n";
import type { EnrichedContactsResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { quotaExceededResponse } from "../billing/upgrade-prompt";
import type { EnrichedContactsResult, EnrichedContactsState } from "./index";

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

/**
 * The Enriched Contacts as `GET /api/applications/:id/enriched-contacts` answers them, the Jobbbox app's read
 * (`@jobhub/shared/reads`, ADR-0076): each person's name and position, an Enriched Contact's details with its provider
 * and when they were obtained; never the provider's own id of the person.
 */
export function enrichedContactsRead(state: EnrichedContactsState): EnrichedContactsResponse {
  return {
    enabled: state.enabled,
    searchable: state.searchable,
    found: state.found.map(({ id, name, jobTitle }) => ({ id, name, jobTitle: jobTitle ?? null })),
    contacts: state.contacts.map(({ id, name, jobTitle, emails, phones, source }) => ({
      id,
      name,
      jobTitle: jobTitle ?? null,
      emails,
      phones,
      source: { provider: source.provider, retrievedAt: source.retrievedAt.toISOString() },
    })),
  };
}
