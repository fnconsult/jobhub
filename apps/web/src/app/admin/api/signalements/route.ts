import { agentCall, agentJson } from "@/agent-keys/http";
import { getAgentKeys } from "@/agent-keys/server";
import { isSignalementStatus, type SignalementStatus } from "@/signalements/values";
import { getSignalementTriage } from "@/signalements/server";

/**
 * Signalement triage's queue (#1139, ADR-0118), for an Agent Key of scope `signalements` only (`Authorization: Bearer
 * jbx_agent_…`), never a session. Only the Signalements sent with the AI notice, « traité » ones included until their
 * purge, oldest first, each with the fixed keys of TRIAGE_KEYS, redacted, the page's path without ids, the issue linked
 * and the draft's signature and date, never its text (#1173); never the Candidate's email, name, Plan or id.
 * `?statut=nouveau` (or several, `?statut=nouveau,vu`): of those statuses only; every one without it.
 * 200 { signalements } · 400 { error: "invalid_status" } · 401 · 429
 */
export async function GET(request: Request) {
  const call = await agentCall(request, "signalements", getAgentKeys());
  if (!call.ok) return call.response;
  const asked = new URL(request.url).searchParams.getAll("statut").flatMap((each) => each.split(",")).map((each) => each.trim()).filter(Boolean);
  if (!asked.every(isSignalementStatus)) return agentJson({ error: "invalid_status" }, 400);
  const statuses = asked.length > 0 ? (asked as SignalementStatus[]) : undefined;
  return agentJson({ signalements: await getSignalementTriage().queue({ statuses }) });
}
