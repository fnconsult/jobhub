import { NextResponse } from "next/server";
import { getAi } from "@/ai/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { actionResponse, STOPPED } from "@/ndjson";
import { summaryChanges, summaryChangesInput } from "@/onboarding-summary";
import { getPlaceSuggestions } from "@/places/server";
import { getTaskPlaybooks } from "@/task-playbooks/server";

/**
 * « Modifier » on the onboarding's summary (#1005, ADR-0105): the Candidate's rewriting of the summary, translated by the
 * AI Coach into Search Criteria changes for them to validate. For a signed-in Candidate only (a Guest has no onboarding);
 * no Plan Quota. Saves nothing, and the rewriting is kept nowhere.
 * Body: { criteria, summaryText, rewritten }.
 * 200 { searchCriteria, changed, other, provenance } · 400 { error: "invalid" } · 401 · 403
 * · 422 { error: "unusable" | "too_many_locations", provenance } · 499 { error: "stopped" } · 500 { error: "failed", reason }
 *
 * Live (ADR-0034), with `Accept: application/x-ndjson`: its step as it starts and ends, then { type: "done", ... } (see
 * actionResponse). Aborting the request is the Stop.
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input = summaryChangesInput.safeParse(await request.json().catch(() => undefined));
  if (!input.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  return actionResponse(request, async ({ signal, onEvent }) => {
    const understood = await summaryChanges(input.data, {
      ai: getAi,
      candidateId: candidate.id,
      places: getPlaceSuggestions(),
      taskPlaybooks: getTaskPlaybooks(),
      signal,
      ...(onEvent ? { onEvent } : {}),
    });
    if (understood.ok) {
      const { searchCriteria, changed, other, provenance } = understood;
      return { status: 200, body: { searchCriteria, changed, other, provenance } };
    }
    if (understood.error === "stopped") return { status: STOPPED, body: { error: "stopped" } };
    return { status: 422, body: { error: understood.error, provenance: understood.provenance } };
  });
}
