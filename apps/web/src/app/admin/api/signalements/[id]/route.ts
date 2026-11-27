import { agentCall, agentJson } from "@/agent-keys/http";
import { getAgentKeys } from "@/agent-keys/server";
import { getSignalementTriage } from "@/signalements/server";

/**
 * One Signalement of triage's queue (#1139, ADR-0118), for an Agent Key of scope `signalements` only: the same fixed
 * keys as the queue, redacted, with the issue linked and the draft's signature and date (#1173). One « traité » stays
 * readable until its purge. A 404 says why, never anything of the Candidate (#1173): `deleted` by the Candidate,
 * `treated` and purged, `no_ai_notice` (sent before the AI notice), or `unknown`.
 * 200 { signalement } · 401 · 404 { error: "not_found", reason } · 429
 */
export async function GET(request: Request, { params }: RouteContext<"/admin/api/signalements/[id]">) {
  const call = await agentCall(request, "signalements", getAgentKeys());
  if (!call.ok) return call.response;
  const found = await getSignalementTriage().one((await params).id);
  return found.ok ? agentJson({ signalement: found.signalement }) : agentJson({ error: found.error, reason: found.reason }, 404);
}
