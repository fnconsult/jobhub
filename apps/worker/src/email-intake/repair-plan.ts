/** Read-only repair proposal: no database, queue, capture or application write capability. */
import { type AiLayer } from "@jobhub/ai";
import { believablePostingDate, isPostingTooOld, scoreMatch, type CvContent, type SearchCriteria } from "@jobhub/shared";
import { createEmailSourceReader } from "./source-reading";
import { offerLink } from "./offer-links";
import { EMAIL_OFFER_MIN_MATCH_SCORE } from "./index";

export const EMAIL_REPAIR_BATCH_LIMIT = 25;

/** Operator-selected incomplete email imports; existing identities stay fixed in the proposal. */
export interface EmailRepairInput {
  jobOfferId: string;
  sourceUrl: string | null;
  private: boolean;
  /** Every affected Candidate/Profile must be supplied by the authorized inventory, never searched externally. */
  profiles: { candidateId: string; profileId: string; cv: CvContent; searchCriteria: SearchCriteria }[];
}

/** A bounded dry-run: obtain the source details and recompute scores without reimporting or changing dossiers. */
export async function planEmailOfferRepairs(inputs: readonly EmailRepairInput[], options: { ai: AiLayer; now: Date; readSource?: ReturnType<typeof createEmailSourceReader> }) {
  if (inputs.length > EMAIL_REPAIR_BATCH_LIMIT) throw new Error("Email repair batch exceeds 25 offers");
  if (new Set(inputs.map((input) => input.jobOfferId)).size !== inputs.length) throw new Error("Duplicate offer in repair batch");
  const readSource = options.readSource ?? createEmailSourceReader();
  const plans = [];
  for (const input of inputs) {
    const link = input.sourceUrl ? offerLink(input.sourceUrl) : null;
    if (input.private || !link) {
      plans.push({ jobOfferId: input.jobOfferId, outcome: "skipped" as const, reason: input.private ? "private" : "missing_link" });
      continue;
    }
    try {
      const source = await readSource(link, options.ai);
      const postedAt = believablePostingDate(source.details.postedAt, options.now);
      if (isPostingTooOld(postedAt, options.now)) {
        plans.push({ jobOfferId: input.jobOfferId, outcome: "skipped" as const, reason: "too_old" });
        continue;
      }
      const scores = input.profiles.map((profile) => ({ candidateId: profile.candidateId, profileId: profile.profileId, matchScore: scoreMatch({ cv: profile.cv, searchCriteria: profile.searchCriteria, jobOffer: source.details, today: options.now }).score }));
      const assignments = [...new Set(scores.map((score) => score.candidateId))].map((candidateId) => {
        const best = scores.filter((score) => score.candidateId === candidateId).sort((a, b) => b.matchScore - a.matchScore)[0]!;
        return { ...best, profileId: best.matchScore >= EMAIL_OFFER_MIN_MATCH_SCORE ? best.profileId : null };
      });
      plans.push({ jobOfferId: input.jobOfferId, outcome: "proposed" as const, sourceUrl: source.url, details: { ...source.details, postedAt }, assignments });
    } catch {
      plans.push({ jobOfferId: input.jobOfferId, outcome: "skipped" as const, reason: "unread_source" });
    }
  }
  return plans;
}
