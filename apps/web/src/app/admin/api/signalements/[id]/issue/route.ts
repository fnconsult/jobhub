import { agentCall, agentJson } from "@/agent-keys/http";
import { getAgentKeys } from "@/agent-keys/server";
import { getSignalementTriage } from "@/signalements/server";

/**
 * Proposes the issue of a Signalement of triage's queue (#1141, ADR-0118), for an Agent Key of scope `signalements` only.
 * Jobbbox publishes it, never the agent: the text goes through Redaction, then the « Données du Candidate dans une
 * issue » Guardrail, always on, and only then to GitHub (labels needs-triage and signalement, the Signalement's id in
 * its body), and the issue is linked to the Signalement.
 * Body: { title, summary, steps?, expected?, environment?, version?, device? }, in the agent's own words, never quoting
 * the Candidate; or { commentOn: <issue number>, summary? } for a duplicate: a comment with the new Signalement's id.
 * One issue per Signalement (#1173): one already linked answers 409 `already_linked` with its issue. One « traité »
 * still takes its issue or comment, so the link outlives Support's reply.
 * 201 { issue: { number, url, kind } } · 400 { error: "invalid", errors } · 401 · 404 { error: "not_found", reason }
 * · 404 { error: "issue_not_found" } · 409 { error: "already_linked", issue: { number, url } }
 * · 422 { error: "blocked", guardrail, reasons, fields }: nothing published, write it again · 429 · 502 { error: "github", reason }
 * · 503 { error: "github", reason: "missing_token", checked: true }: the text passed Redaction and the Guardrail, nothing published
 */
export async function POST(request: Request, { params }: RouteContext<"/admin/api/signalements/[id]/issue">) {
  const call = await agentCall(request, "signalements", getAgentKeys());
  if (!call.ok) return call.response;
  const body: unknown = await request.json().catch(() => undefined);
  const done = await getSignalementTriage().proposeIssue((await params).id, call.key.name, body);
  if (done.ok) return agentJson({ issue: done.issue }, 201);
  switch (done.error) {
    case "not_found":
      return agentJson({ error: "not_found", reason: done.reason }, 404);
    case "already_linked":
      return agentJson({ error: "already_linked", issue: done.issue }, 409);
    case "invalid":
      return agentJson({ error: "invalid", errors: done.errors }, 400);
    case "blocked":
      return agentJson({ error: "blocked", guardrail: done.guardrail, reasons: done.reasons, fields: done.fields }, 422);
    case "github":
      if (done.reason === "not_found") return agentJson({ error: "issue_not_found" }, 404);
      // Only a text that passed Redaction and the Guardrail reaches GitHub: without the token, say so.
      if (done.reason === "missing_token") return agentJson({ error: "github", reason: done.reason, checked: true }, 503);
      return agentJson({ error: "github", reason: done.reason }, 502);
  }
}
