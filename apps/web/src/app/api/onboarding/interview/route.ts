import { NextResponse } from "next/server";
import { getAi } from "@/ai/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { actionResponse, STOPPED } from "@/ndjson";
import { interviewInputSchema, nextInterviewTurn } from "@/onboarding-interview";
import { getPlaceSuggestions } from "@/places/server";
import { readIndustryReference } from "@/reference-data/server";
import { getTaskPlaybooks } from "@/task-playbooks/server";

/**
 * The onboarding interview's next turn (#1002, ADR-0106): without a CV, the AI Coach asks one question at a time,
 * challenges a vague answer and proposes what it deduces. Signed-in Candidates only: a Guest has no Profile to create.
 * No Plan Quota; its calls are counted in AI Usage (task `onboarding_interview`). Saves nothing, and the exchange is not
 * kept as a Coach Conversation: the page applies to the Profile only what the Candidate answers or validates.
 * Body: { language, draft: { masterCv, searchCriteria }, exchange: ExchangeTurn[], opener? }.
 * 200 { turn: InterviewTurn, provenance } · 200 { fallback: true }: the AI could not give a turn, the scripted questions
 * take over · 400 { error: "invalid" } · 401 · 403 · 499 { error: "stopped" }
 *
 * Live, with `Accept: application/x-ndjson`, as `/api/cv/draft`: the turn's step as it starts and ends, then
 * { type: "done", turn, provenance } or { type: "done", fallback: true } · { type: "stopped", error } · { type: "failed", … }.
 * Aborting the request is the Stop.
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const input = interviewInputSchema.safeParse(await request.json().catch(() => undefined));
  if (!input.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  return actionResponse(request, async ({ signal, onEvent }) => {
    const next = await nextInterviewTurn(input.data, {
      ai: getAi,
      candidateId: candidate.id,
      places: getPlaceSuggestions(),
      industries: readIndustryReference,
      taskPlaybooks: getTaskPlaybooks(),
      signal,
      ...(onEvent ? { onEvent } : {}),
    });
    if (signal.aborted) return { status: STOPPED, body: { error: "stopped" } };
    return { status: 200, body: next ?? { fallback: true } };
  });
}
