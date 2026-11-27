import { agentCall, agentJson } from "@/agent-keys/http";
import { getAgentKeys } from "@/agent-keys/server";
import { getSignalementTriage } from "@/signalements/server";

/**
 * Proposes the draft reply of a Signalement of triage's queue (#1141, ADR-0118), for an Agent Key of scope `signalements`
 * only: in French and in English, one of them the Candidate's Interface Language, kept « proposé par <key> » until
 * Support edits, sends or deletes it. The agent never sends it, and never sets « traité ». A new draft replaces the last.
 * The answer holds who proposed it and when, never its text nor the message (#1173).
 * Body: { fr, en }, each at most 2,000 characters.
 * 201 { id, brouillon: { proposePar, date } } · 400 { error: "invalid", errors } · 401 · 404 { error: "not_found", reason }
 * · 409 { error: "already_handled" } · 429
 */
export async function POST(request: Request, { params }: RouteContext<"/admin/api/signalements/[id]/brouillon">) {
  const call = await agentCall(request, "signalements", getAgentKeys());
  if (!call.ok) return call.response;
  const body: unknown = await request.json().catch(() => undefined);
  const done = await getSignalementTriage().proposeDraft((await params).id, call.key.name, body);
  if (done.ok) return agentJson(done.proposed, 201);
  switch (done.error) {
    case "invalid":
      return agentJson({ error: "invalid", errors: done.errors }, 400);
    case "not_found":
      return agentJson({ error: "not_found", reason: done.reason }, 404);
    case "already_handled":
      return agentJson({ error: "already_handled" }, 409);
  }
}
