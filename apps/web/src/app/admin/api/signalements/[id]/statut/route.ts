import { agentCall, agentJson } from "@/agent-keys/http";
import { getAgentKeys } from "@/agent-keys/server";
import { getSignalementTriage } from "@/signalements/server";

/**
 * Marks a Signalement of triage's queue « vu » (#1139, ADR-0118), for an Agent Key of scope `signalements` only, signed
 * `key:<name>` (statutMajPar): the Back Office shows « vu par triage-beta ». Only « vu »: the agent never sets
 * « traité ». One already « vu » is left as it is. The answer holds its id, status and signature alone, never its
 * message (#1173).
 * Body: { statut: "vu" }.
 * 200 { id, statut, statutMajPar } · 400 { error: "only_vu" } · 401 · 404 { error: "not_found", reason }
 * · 409 { error: "already_handled" } · 429
 */
export async function POST(request: Request, { params }: RouteContext<"/admin/api/signalements/[id]/statut">) {
  const call = await agentCall(request, "signalements", getAgentKeys());
  if (!call.ok) return call.response;
  const body: unknown = await request.json().catch(() => undefined);
  if (!body || typeof body !== "object" || (body as { statut?: unknown }).statut !== "vu") return agentJson({ error: "only_vu" }, 400);
  const done = await getSignalementTriage().markSeen((await params).id, call.key.name);
  if (done.ok) return agentJson(done.seen);
  if (done.error === "not_found") return agentJson({ error: done.error, reason: done.reason }, 404);
  return agentJson({ error: done.error }, 409);
}
