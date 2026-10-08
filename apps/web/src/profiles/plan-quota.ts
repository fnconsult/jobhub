/**
 * Profiles under the Plan Quota (ADR-0014): how many active Profiles the
 * Candidate's Plan allows, and the Upgrade Prompt to show when it allows no
 * more. Billing decides; the Profiles module counts and enforces.
 */
import type { Locale } from "@jobhub/shared/i18n";
import type { Billing } from "../billing";
import { upgradePrompt, type UpgradePrompt } from "../billing/upgrade-prompt";
import type { ProfileQuota, Profiles } from "./index";

/** The Plan's `profiles` limit (null: unlimited), for `createProfiles(database, { profileQuota })`. */
export function profilePlanQuota(billing: Pick<Billing, "entitlements">): ProfileQuota {
  return async (candidateId) => (await billing.entitlements(candidateId)).quotas.profiles;
}

/** The Upgrade Prompt if the Candidate's Plan allows no more active Profiles, otherwise null. */
export async function profileUpgradePrompt(
  billing: Pick<Billing, "allowsAnother">,
  profiles: Pick<Profiles, "list">,
  candidateId: string,
  locale: Locale,
): Promise<UpgradePrompt | null> {
  const active = (await profiles.list(candidateId)).filter((profile) => !profile.archived).length;
  const decision = await billing.allowsAnother(candidateId, "profiles", active);
  return decision.allowed ? null : upgradePrompt(decision, locale);
}
