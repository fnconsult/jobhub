import { cache } from "react";
import { loadAiActivity } from "@/ai-activity/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { requireOwnJobDigest } from "@/job-digests/server";
import { getOfferBox } from "@/offer-box/server";

export type Params = { params: Promise<{ id: string }> };

/**
 * Everything a Job Digest's page shows, the Candidate's offers à traiter included (#818), loaded once per request (its layout, its page and what opens in the Work Pane
 * share it). Sends anonymous visitors to sign in, and answers 404 for a Job Digest that is not theirs.
 */
export const loadJobDigestPage = cache(async (id: string) => {
  const { candidateId, jobDigest } = await requireOwnJobDigest(id);
  const [t, locale, aiActivity, offersToHandle] = await Promise.all([
    getServerT(),
    getRequestLocale(),
    loadAiActivity.jobDigest(candidateId, jobDigest),
    // « Il vous reste N offres à traiter » (#818): without it, the line is left out, the page still shows.
    getOfferBox()
      .toHandle(candidateId)
      .catch((error: unknown) => {
        console.error("[job-digests] could not count the offers à traiter", error);
        return 0;
      }),
  ]);
  const inView = { kind: "job_digest", id: jobDigest.id, name: jobDigest.profile.name, profileId: jobDigest.profile.id } as const;
  return { candidateId, jobDigest, t, locale, aiActivity, inView, offersToHandle };
});

export type JobDigestPageData = Awaited<ReturnType<typeof loadJobDigestPage>>;
