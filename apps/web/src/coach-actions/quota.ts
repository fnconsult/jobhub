/**
 * A weekly Plan Quota as a Coach proposal's card says it (#720, ADR-0114): this week's uses, the Plan's limit, and the
 * refusal once there is no room, for the Upgrade prompt shown in place of the card's buttons.
 *
 *   weeklyQuotaOf(billing, "jobSearches")        // propose_job_search
 *   weeklyQuotaOf(billing, "enrichedContacts")   // propose_contact_search, propose_contact_reveal
 */
import type { WeeklyQuota } from "@jobhub/shared";
import type { Billing } from "../billing";
import type { QuotaRefusal } from "../billing/upgrade-prompt";

/** A weekly Plan Quota now: what is used, the limit (null: unlimited), and the refusal once used up (or not included). */
export interface WeeklyQuotaUse {
  used: number;
  limit: number | null;
  refusal: QuotaRefusal | null;
}

/** `quota` as the billing module keeps it for a Candidate. */
export function weeklyQuotaOf(billing: Pick<Billing, "entitlements" | "allows">, quota: WeeklyQuota): (candidateId: string) => Promise<WeeklyQuotaUse> {
  return async (candidateId) => {
    const { quotas, usedThisWeek } = await billing.entitlements(candidateId);
    const limit = quotas[quota];
    const used = usedThisWeek[quota];
    if (limit === null || used < limit) return { used, limit, refusal: null };
    const decision = await billing.allows(candidateId, quota);
    return { used, limit, refusal: decision.allowed ? null : decision };
  };
}
