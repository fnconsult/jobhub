import { cache } from "react";
import { loadAiActivity } from "@/ai-activity/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { requireOwnJobDigest } from "@/job-digests/server";

export type Params = { params: Promise<{ id: string }> };

/**
 * Everything a Job Digest's page shows, loaded once per request (its layout, its page and what opens in the Work Pane
 * share it). Sends anonymous visitors to sign in, and answers 404 for a Job Digest that is not theirs.
 */
export const loadJobDigestPage = cache(async (id: string) => {
  const { candidateId, jobDigest } = await requireOwnJobDigest(id);
  const [t, locale, aiActivity] = await Promise.all([getServerT(), getRequestLocale(), loadAiActivity.jobDigest(candidateId, jobDigest)]);
  const inView = { kind: "job_digest", id: jobDigest.id, name: jobDigest.profile.name, profileId: jobDigest.profile.id } as const;
  return { candidateId, jobDigest, t, locale, aiActivity, inView };
});

export type JobDigestPageData = Awaited<ReturnType<typeof loadJobDigestPage>>;
