import { scoreMatch, type JobOffer, type MatchScore } from "@jobhub/shared";
import type { Profile } from "../profiles";

/** A Profile, by name, and its Master CV's Match Score against the Job Offer with its Search Criteria. */
export interface ProfileMatch {
  profile: { id: string; name: string };
  matchScore: MatchScore;
}

/**
 * The Match Score a Job Offer page shows a signed-in Candidate:
 *  - not saved yet (`saved: false`): the Job Offer scored against each active
 *    Profile, in the order given, and the one to preselect (`profileId`);
 *  - saved: the score of its Application, against the Application's Profile.
 */
export type JobOfferMatch = { saved: false; profileId: string; matches: ProfileMatch[] } | ({ saved: true; applicationId: string } & ProfileMatch);

/**
 * Scores as Job Search results, Job Digests and the Application page do: the
 * Profile's current Master CV against the Job Offer and the Profile's Search
 * Criteria, so one offer and one Profile always get the same Match Score.
 * Showing it is not a Match Score the Candidate asked for: no Plan Quota is used.
 * Null when there is nothing to score: no Application and no active Profile.
 */
export function jobOfferMatch({
  jobOffer,
  profiles,
  applications,
  profileId,
}: {
  jobOffer: JobOffer;
  /** Every Profile of the Candidate. */
  profiles: readonly Profile[];
  /** The Candidate's Applications (any Job Offer). */
  applications: ReadonlyArray<{ id: string; jobOffer: { id: string }; profile: { id: string } }>;
  /** The Profile to preselect, if active (e.g. the Job Search's the Candidate came from); otherwise the first active one. */
  profileId?: string | undefined;
}): JobOfferMatch | null {
  const application = applications.find((candidate) => candidate.jobOffer.id === jobOffer.id);
  // An Application keeps its Profile, archived or not (Profiles go only with the account).
  const applicationProfile = application && profiles.find((profile) => profile.id === application.profile.id);
  if (application && applicationProfile) return { saved: true, applicationId: application.id, ...scored(jobOffer, applicationProfile) };

  const matches = profiles.filter((profile) => !profile.archived).map((profile) => scored(jobOffer, profile));
  if (matches.length === 0) return null;
  const preselected = matches.find((match) => match.profile.id === profileId) ?? matches[0]!;
  return { saved: false, profileId: preselected.profile.id, matches };
}

function scored(jobOffer: JobOffer, profile: Profile): ProfileMatch {
  return {
    profile: { id: profile.id, name: profile.name },
    matchScore: scoreMatch({ cv: profile.masterCv.content, searchCriteria: profile.searchCriteria, jobOffer }),
  };
}
