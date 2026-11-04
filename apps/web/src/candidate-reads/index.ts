/**
 * The Candidate's reads over HTTP (ADR-0076, #684): what the GETs of the `/api/*` routes answer the Jobbbox app, the
 * menus' cards and the objects they lead to, each in its type from `@jobhub/shared/reads`.
 *
 * One deep module in front of the modules the pages already read: `createCandidateReads(deps)` gives one read per
 * GET, each calling the same module functions, and the same pure menus (applicationsMenu, jobSearchesMenu,
 * jobDigestsMenu), as the page it mirrors, then writing the answer as JSON: instants as ISO strings, absent values as
 * null. No query of its own: a rule a page applies (an Archived Profile left out of a card, the Match Score shown only
 * when computable) is the module's or the menu's, so the page and the app cannot disagree.
 *
 * Every read is scoped to the Candidate, as the modules are: one that names another Candidate's object gives null,
 * which the route answers 404. A session pending its second step never reaches it: the proxy answers it 401
 * `second_step_required` (ADR-0075), and getCurrentCandidate gives no Candidate for it.
 */
import { matchScoreReliability, type MatchScore } from "@jobhub/shared";
import type { ApplicationResponse, ApplicationsResponse, InterviewRead, JobOfferLine, RescheduleRead } from "@jobhub/shared/reads";
import type { Applications, Interview } from "../applications";
import { applicationsMenu } from "../applications/menu";
import type { FollowUps } from "../follow-ups";
import type { Reschedule } from "../reschedules";

export interface CandidateReads {
  /** Mes candidatures' card, latest saved first; the Archived Applications only when `showArchived`. */
  applications(candidateId: string, options?: { showArchived?: boolean }): Promise<ApplicationsResponse>;
  /** One of the Candidate's Applications with its Interviews; null when it is not theirs. */
  application(candidateId: string, applicationId: string): Promise<ApplicationResponse | null>;
}

export interface CandidateReadsDeps {
  applications: Pick<Applications, "list" | "get" | "matchScores">;
  followUps: Pick<FollowUps, "notices">;
  /** The clock « from now on » is read by (an Application's next deadline). Defaults to the real time. */
  now?: () => Date;
}

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null);

/** A Match Score's figure, null when it is not computable, as the cards show it. */
const figure = (score: MatchScore | undefined): number | null => (score && matchScoreReliability(score) !== "not_computable" ? score.score : null);

const reschedule = ({ previousAt, newAt, by, at }: Reschedule): RescheduleRead => ({ previousAt: iso(previousAt), newAt: isoOrNull(newAt), by, at: iso(at) });

const interview = (held: Interview): InterviewRead => ({
  id: held.id,
  scheduledAt: iso(held.scheduledAt),
  durationMinutes: held.durationMinutes,
  format: held.format,
  place: held.place,
  note: held.note,
  cancelledAt: isoOrNull(held.cancelledAt),
  reschedules: held.reschedules.map(reschedule),
});

/** The next Interview of an Application not cancelled, from `now` on: its next deadline. */
function nextDeadline(interviews: readonly Interview[], now: Date): string | null {
  const next = interviews.filter((held) => !held.cancelledAt && held.scheduledAt.getTime() >= now.getTime()).sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];
  return next ? iso(next.scheduledAt) : null;
}

type JobOfferFacts = { id: string; title: string; employer?: string; location?: string; source?: { url?: string }; postedAt?: Date; expiredAt?: Date };

const jobOfferLine = (offer: JobOfferFacts): JobOfferLine => ({
  id: offer.id,
  title: offer.title,
  employer: offer.employer ?? null,
  location: offer.location ?? null,
  url: offer.source?.url ?? null,
  postedAt: isoOrNull(offer.postedAt),
  expiredAt: isoOrNull(offer.expiredAt),
});

export function createCandidateReads(deps: CandidateReadsDeps): CandidateReads {
  const now = deps.now ?? (() => new Date());

  return {
    async applications(candidateId, { showArchived = false } = {}) {
      const [listed, notices, matchScores] = await Promise.all([
        deps.applications.list(candidateId),
        deps.followUps.notices(candidateId),
        deps.applications.matchScores(candidateId),
      ]);
      const menu = applicationsMenu({ applications: listed, notices, matchScores, showArchived });
      const byId = new Map(listed.map((application) => [application.id, application]));
      const today = now();
      return {
        applications: menu.rows.map((row) => {
          const application = byId.get(row.id)!;
          return {
            id: row.id,
            title: row.title,
            employer: row.employer,
            status: row.status,
            matchScore: row.matchScore,
            toHandle: row.toHandle,
            nextDeadline: nextDeadline(application.interviews, today),
            expired: row.expired,
            reportedByYou: row.reportedByYou,
            archived: application.profile.archived,
          };
        }),
        toHandle: menu.toHandle,
        archivedHidden: menu.archivedHidden,
      };
    },

    async application(candidateId, applicationId) {
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return null;
      return {
        id: application.id,
        status: application.status,
        statusChangedAt: iso(application.statusChangedAt),
        createdAt: iso(application.createdAt),
        jobOffer: jobOfferLine(application.jobOffer),
        profile: { id: application.profile.id, name: application.profile.name },
        matchScore: figure(application.matchScore),
        reportedUnavailableAt: isoOrNull(application.reportedUnavailableAt),
        interviews: application.interviews.map(interview),
      };
    },
  };
}
