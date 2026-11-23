/**
 * An Exchange's check (#1099, ADR-0115): before it is kept or offered, its text goes through the « Contenu piégé dans un
 * email » Guardrail as Email intake's reading does (ADR-0052: fixed rules, then one model check, in the EU, unless
 * switched off). Its sender was authenticated on arrival (the inbound route ties no other). Blocked, nothing of it is
 * kept; let through or flagged, it is kept on its Application, or offered to the Candidate. The worker runs it for each
 * job of EXCHANGE_CHECK_QUEUE.
 *
 *   await checkExchange({ exchanges, guardrails }, exchangeId); // "kept" | "offered" | "dropped" | null (none waiting)
 */
import type { OfferEmailReading } from "@jobhub/ai";
import type { Guardrails } from "../guardrails";
import type { Exchanges } from "./index";

/** An Exchange is read for no offer: the reading's output rules have nothing to check. */
const NOTHING_READ: OfferEmailReading = { kind: "other", offers: [] };

export interface ExchangeCheckDeps {
  exchanges: Pick<Exchanges, "toCheck" | "checked">;
  guardrails: Pick<Guardrails, "guardEmail">;
}

export async function checkExchange(deps: ExchangeCheckDeps, id: string): Promise<"kept" | "offered" | "dropped" | null> {
  const waiting = await deps.exchanges.toCheck(id);
  if (!waiting) return null;
  const guarded = await deps.guardrails.guardEmail({ candidateId: waiting.candidateId, email: { text: waiting.text, authenticated: true }, read: async () => NOTHING_READ });
  return deps.exchanges.checked(id, guarded.outcome === "blocked" ? "blocked" : "passed");
}
