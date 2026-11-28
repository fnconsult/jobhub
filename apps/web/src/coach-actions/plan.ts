/**
 * The Candidate's Plan as `read_plan` tells it (ADR-0119 « Questions about Jobbbox », #1158): its name, the week's Plan
 * Quotas used and left, and their reset date, read from the billing module as « Mon abonnement » reads them (its
 * entitlements: this week's uses and the Plan's limits). A quota used up, or not included, names the Plan that gives
 * more of it, as the Upgrade Prompt does: the AI Coach proposes the change (the `plan` redirect), never makes it.
 *
 *   planRead(billing, now)(candidateId, maxTokens)   // what read_plan gives the AI Coach, in French
 *
 * Nothing in it is text the Candidate did not write: Jobbbox's own Plans and counters.
 */
import { nextMondayInParis, WEEKLY_QUOTAS, type WeeklyQuota } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import type { Billing } from "../billing";
import { fitted, type ReadObject } from "./reads";

/** What the Plan is read through: the Candidate's entitlements, the Plans' names, and the Plan a refused quota names. */
export type PlanSource = Pick<Billing, "entitlements" | "plans" | "allows">;

const PARIS = "Europe/Paris";
const resetDay = new Intl.DateTimeFormat("fr", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: PARIS });
const longDay = new Intl.DateTimeFormat("fr", { day: "numeric", month: "long", year: "numeric", timeZone: PARIS });

/** « 1 utilisé », « 3 utilisés »: the French plural, 0 and 1 singular. */
const counted = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;

export function planRead(billing: PlanSource, now: () => Date = () => new Date()) {
  const { t } = createI18n("fr");

  /** The Plan above the Candidate's that gives more of `quota`, as its refusal names it; null when none does. */
  const upgradeFor = async (candidateId: string, quota: WeeklyQuota) => {
    const decision = await billing.allows(candidateId, quota).catch(() => null);
    return decision && !decision.allowed ? (decision.upgradeToName?.fr ?? null) : null;
  };

  /** One weekly quota's line: used of its limit and what is left; unlimited; reached; or not in the Plan. */
  async function quotaLine(candidateId: string, quota: WeeklyQuota, used: number, limit: number | null): Promise<string> {
    const label = t(`billing.quotas.${quota}`);
    if (limit === null) return `- ${label} : ${counted(used, "utilisé")}, illimité.`;
    if (limit === 0) {
      const upgrade = await upgradeFor(candidateId, quota);
      return `- ${label} : non compris dans son offre${upgrade ? ` ; l'offre ${upgrade} les comprend` : ""}.`;
    }
    const left = Math.max(0, limit - used);
    const line = `- ${label} : ${counted(used, "utilisé")} sur ${limit}, ${counted(left, "restant")}`;
    if (left > 0) return `${line}.`;
    const upgrade = await upgradeFor(candidateId, quota);
    return `${line} : quota atteint${upgrade ? ` ; l'offre ${upgrade} en donne plus` : ""}.`;
  }

  return async (candidateId: string, maxTokens: number): Promise<ReadObject> => {
    const [{ plan, endsAt, quotas, usedThisWeek }, plans] = await Promise.all([billing.entitlements(candidateId), billing.plans()]);
    const name = plans.find((each) => each.key === plan)?.name.fr ?? plan;
    const kept = endsAt ? `, gardée jusqu'au ${longDay.format(endsAt)} (sa résiliation est programmée)` : "";
    const lines = await Promise.all(WEEKLY_QUOTAS.map((quota) => quotaLine(candidateId, quota, usedThisWeek[quota], quotas[quota])));
    const text = [
      `Offre du candidat : ${name}${kept}.`,
      `Quotas de la semaine, remis à zéro le ${resetDay.format(nextMondayInParis(now()))} à 0 h (heure de Paris) :`,
      ...lines,
      "Pour en avoir plus, il change d'offre lui-même depuis sa page « Abonnement » (renvoi plan).",
    ].join("\n");
    // Its page is the Candidate's account, not one Provenance names.
    return { text: fitted([text], maxTokens), pages: [], untrusted: false };
  };
}
