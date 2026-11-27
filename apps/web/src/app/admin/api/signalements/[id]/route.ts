import { agentCall, agentJson } from "@/agent-keys/http";
import { getAgentKeys } from "@/agent-keys/server";
import { getSignalementTriage } from "@/signalements/server";

/**
 * One Signalement of triage's queue (#1139, ADR-0118), for an Agent Key of scope `signalements` only: the same fixed
 * keys as the queue, redacted. One sent before the AI notice is not found.
 * 200 { signalement } · 401 · 404 · 429
 */
export async function GET(request: Request, { params }: RouteContext<"/admin/api/signalements/[id]">) {
  const call = await agentCall(request, "signalements", getAgentKeys());
  if (!call.ok) return call.response;
  const signalement = await getSignalementTriage().one((await params).id);
  return signalement ? agentJson({ signalement }) : agentJson({ error: "not_found" }, 404);
}
