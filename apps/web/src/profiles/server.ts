import { notFound, redirect } from "next/navigation";
import { sharedPool } from "@/database/pool";
import { getCurrentCandidate } from "@/auth/server";
import { getBilling } from "@/billing/server";
import type { UpgradePrompt } from "@/billing/upgrade-prompt";
import { localeOf } from "@/i18n/server";
import { routes } from "@/routes";
import { createProfiles, type Profile, type Profiles } from "./index";
import { profilePlanQuota, profileUpgradePrompt } from "./plan-quota";

let instance: Profiles | undefined;

/** The app's Profiles module, on the database named by DATABASE_URL, within the Candidates' Plan Quotas. */
export function getProfiles(): Profiles {
  instance ??= createProfiles(sharedPool(), { profileQuota: profilePlanQuota(getBilling()) });
  return instance;
}

/** The Upgrade Prompt, in the Candidate's Interface Language, if their Plan allows no more active Profiles; otherwise null. */
export function profileUpgradePromptFor(candidate: { id: string; interfaceLanguage?: unknown }): Promise<UpgradePrompt | null> {
  return profileUpgradePrompt(getBilling(), getProfiles(), candidate.id, localeOf(candidate));
}

/**
 * For a Profile's pages: the signed-in Candidate and their Profile `id`.
 * Sends anonymous visitors to sign in, and answers 404 for a Profile that is not theirs.
 */
export async function requireOwnProfile(id: string): Promise<{ candidateId: string; profile: Profile }> {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const profile = await getProfiles().get(candidate.id, id);
  if (!profile) notFound();
  return { candidateId: candidate.id, profile };
}
