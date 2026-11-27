import { agentCall, agentJson } from "@/agent-keys/http";
import { getAgentKeys } from "@/agent-keys/server";
import { getSignalementTriage } from "@/signalements/server";

/**
 * Proposes the draft reply of a Signalement of triage's queue (#1141, ADR-0118), for an Agent Key of scope `signalements`
 * only: in French and in English, one of them the Candidate's Interface Language, kept « proposé par <key> » until
 * Support edits, sends or deletes it. The agent never sends it, and never sets « traité ». A new draft replaces the last.
 * Body: { fr, en }, each at most 2,000 characters.
 * 201 { draft: { fr, en, proposedBy, proposedAt, forCandidate } } · 400 { error: "invalid", errors } · 401 · 404
 * · 409 { error: "already_handled" } · 429
 */
export async function POST(request: Request, { params }: RouteContext<"/admin/api/signalements/[id]/brouillon">) {
  const call = await agentCall(request, "signalements", getAgentKeys());
  if (!call.ok) return call.response;
  const body: unknown = await request.json().catch(() => undefined);
  const done = await getSignalementTriage().proposeDraft((await params).id, call.key.name, body);
  if (done.ok) return agentJson({ draft: done.draft }, 201);
  if (done.error === "invalid") return agentJson({ error: "invalid", errors: done.errors }, 400);
  return agentJson({ error: done.error }, done.error === "not_found" ? 404 : 409);
}
