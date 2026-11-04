/**
 * The Candidate's objects as the read Coach Actions find them (#714): through the domain modules the pages' routes use,
 * scoped to the Candidate, Archived Profiles and their Applications, Job Searches and Job Digests left out (not_found).
 * Each object is told as the Coach context tells it In view (../coach/context), without the Identity block, then fitted
 * to the room it is given by rule: the fullest telling that fits, else a shorter one (a Master CV without its job
 * descriptions, fewer Job Offers), else cut.
 */
import { NO_INDUSTRY_REFERENCE, type IndustryReference } from "@jobhub/shared";
import type { Applications } from "../applications";
import { applicationDetails, criteriaTextOf, cvText, day, estimateTokens, JOB_SEARCH_STATUS, jobOfferText, matchScoreText, scoredResultLine, type CoachAgendaSource } from "../coach/context";
import type { JobDigests } from "../job-digests";
import type { JobSearches } from "../job-searches";
import type { Profiles } from "../profiles";
import { routes } from "../routes";
import type { TailoredCvs } from "../tailored-cv";
import type { TailoredDocuments } from "../tailored-documents";
import type { CoachObjectReader, ReadObject } from "./reads";

/** The domain modules the reads go through, each scoped to the Candidate. */
export interface CandidateObjectSources {
  profiles: Pick<Profiles, "get" | "list">;
  applications: Pick<Applications, "get" | "list">;
  jobSearches: Pick<JobSearches, "get" | "list">;
  jobDigests: Pick<JobDigests, "get" | "list">;
  agenda: CoachAgendaSource;
  tailoredDocuments: Pick<TailoredDocuments, "get">;
  tailoredCvs: Pick<TailoredCvs, "get">;
  /** The Sectors' and Domains' labels; without them none is named. */
  industries?: () => Promise<IndustryReference>;
  now?: () => Date;
}

const CUT = " […] (la suite est coupée)";

/** The first of `tellings` (fullest first) within `maxTokens`, else the last one cut to fit. */
export function fitted(tellings: readonly string[], maxTokens: number): string {
  const fits = tellings.find((text) => estimateTokens(text) <= maxTokens);
  if (fits !== undefined) return fits;
  const last = tellings.at(-1) ?? "";
  return last.slice(0, Math.max(0, maxTokens * 4 - CUT.length)) + CUT;
}

/**
 * `head` and as many of `lines` as fit in `maxTokens`, the first ones kept, saying how many were left out by `left(n)`.
 */
export function fittedLines(head: string, lines: readonly string[], maxTokens: number, left: (count: number) => string): string {
  const told = (count: number) => [head, ...lines.slice(0, count), ...(count < lines.length ? [left(lines.length - count)] : [])].join("\n");
  let count = lines.length;
  while (count > 0 && estimateTokens(told(count)) > maxTokens) count -= 1;
  return fitted([told(count)], maxTokens);
}

type ScoredResult = Parameters<typeof scoredResultLine>[0];

/** How many of the Candidate's latest Job Searches, and of their latest Job Digests, a Job Offer is looked for in. */
export const JOB_OFFER_LOOKUP = 10;

/** A Job Search's or Job Digest's Job Offers, best Match Score first, each with its id, within `maxTokens`. */
function resultsText(head: string, results: readonly ScoredResult[], maxTokens: number): string {
  if (results.length === 0) return `${head}\nAucune offre trouvée.`;
  const lines = [...results].sort((a, b) => b.matchScore.score - a.matchScore.score).map((result) => `- [offre ${result.jobOffer.id}] ${scoredResultLine(result)}`);
  return fittedLines(`${head}\nOffres, meilleur score d'abord :`, lines, maxTokens, (count) => `(${count} autres offres, moins bien notées, ne sont pas montrées.)`);
}

export function candidateObjects(sources: CandidateObjectSources): CoachObjectReader {
  const criteriaText = async () => criteriaTextOf(await (sources.industries?.().catch(() => NO_INDUSTRY_REFERENCE) ?? NO_INDUSTRY_REFERENCE));

  /** Whether `profileId` is one of the Candidate's active Profiles: an Archived Profile's objects are out of reach. */
  const isActive = async (candidateId: string, profileId: string) => (await sources.profiles.list(candidateId)).some((profile) => profile.id === profileId && !profile.archived);

  /**
   * A Job Offer one of the Candidate's objects shows, with its Match Score: their Application for it first, else the latest
   * of their JOB_OFFER_LOOKUP Job Searches, else of their JOB_OFFER_LOOKUP Job Digests (active Profiles only) that holds it.
   */
  async function jobOfferRead(candidateId: string, id: string, maxTokens: number): Promise<ReadObject | null> {
    const active = new Set((await sources.profiles.list(candidateId)).filter((profile) => !profile.archived).map((profile) => profile.id));
    const told = (head: string, result: ScoredResult) => fitted([[head, `${matchScoreText(result.matchScore)}.`, jobOfferText(result.jobOffer)].join("\n")], maxTokens);

    const saved = (await sources.applications.list(candidateId)).find((application) => application.jobOffer.id === id && active.has(application.profile.id));
    const application = saved ? await sources.applications.get(candidateId, saved.id) : null;
    if (application) {
      const head = `Offre d'emploi (id ${id}), enregistrée comme candidature (id ${application.id}), profil « ${application.profile.name} ».`;
      return { text: told(head, application), pages: [routes.application(application.id)], untrusted: true };
    }
    for (const summary of (await sources.jobSearches.list(candidateId)).filter((each) => active.has(each.profile.id)).slice(0, JOB_OFFER_LOOKUP)) {
      const jobSearch = await sources.jobSearches.get(candidateId, summary.id);
      const result = jobSearch?.results.find((each) => each.jobOffer.id === id);
      if (!jobSearch || !result) continue;
      const head = `Offre d'emploi (id ${id}), trouvée par la recherche d'offres (id ${jobSearch.id}) du ${day(jobSearch.startedAt)}, profil « ${jobSearch.profile.name} »${result.applicationId ? `, enregistrée comme candidature (id ${result.applicationId})` : ""}.`;
      return { text: told(head, result), pages: [routes.jobSearchOffer(jobSearch.id, id)], untrusted: true };
    }
    for (const summary of (await sources.jobDigests.list(candidateId)).filter((each) => active.has(each.profile.id)).slice(0, JOB_OFFER_LOOKUP)) {
      const jobDigest = await sources.jobDigests.get(candidateId, summary.id);
      const result = jobDigest?.results.find((each) => each.jobOffer.id === id);
      if (!jobDigest || !result) continue;
      const head = `Offre d'emploi (id ${id}), envoyée par le Job Digest (id ${jobDigest.id}) du ${day(jobDigest.sentAt)}, profil « ${jobDigest.profile.name} »${result.applicationId ? `, enregistrée comme candidature (id ${result.applicationId})` : ""}.`;
      return { text: told(head, result), pages: [routes.jobDigestOffer(jobDigest.id, id)], untrusted: true };
    }
    return null;
  }

  return {
    async index() {
      return [];
    },

    async read(candidateId, type, id, maxTokens): Promise<ReadObject | null> {
      switch (type) {
        case "profile": {
          const profile = await sources.profiles.get(candidateId, id);
          if (!profile || profile.archived) return null;
          const criteria = (await criteriaText())(profile.searchCriteria);
          const told = (descriptions: boolean) =>
            [`Profil « ${profile.name} » (id ${profile.id}).`, `Critères de recherche : ${criteria}.`, `CV de référence (version ${profile.masterCv.version}) :`, cvText(profile.masterCv.content, { descriptions })].join("\n");
          return { text: fitted([told(true), told(false)], maxTokens), pages: [routes.profile(profile.id)], untrusted: false };
        }
        case "application": {
          const application = await sources.applications.get(candidateId, id);
          if (!application || !(await isActive(candidateId, application.profile.id))) return null;
          const text = [`Candidature (id ${application.id}) avec le profil « ${application.profile.name} » (id ${application.profile.id}).`, applicationDetails(application)].join("\n");
          return { text: fitted([text], maxTokens), pages: [routes.application(application.id)], untrusted: true };
        }
        case "job_offer":
          return jobOfferRead(candidateId, id, maxTokens);
        case "job_search": {
          const jobSearch = await sources.jobSearches.get(candidateId, id);
          if (!jobSearch || !(await isActive(candidateId, jobSearch.profile.id))) return null;
          const head = `Recherche d'offres (id ${jobSearch.id}) lancée le ${day(jobSearch.startedAt)} pour le profil « ${jobSearch.profile.name} » (${JOB_SEARCH_STATUS[jobSearch.status]}).`;
          return { text: resultsText(head, jobSearch.results, maxTokens), pages: [routes.jobSearch(jobSearch.id)], untrusted: true };
        }
        case "job_digest": {
          const jobDigest = await sources.jobDigests.get(candidateId, id);
          if (!jobDigest || !(await isActive(candidateId, jobDigest.profile.id))) return null;
          const head = `Job Digest (id ${jobDigest.id}) envoyé le ${day(jobDigest.sentAt)} pour le profil « ${jobDigest.profile.name} ».`;
          return { text: resultsText(head, jobDigest.results, maxTokens), pages: [routes.jobDigest(jobDigest.id)], untrusted: true };
        }
        default:
          return null;
      }
    },
  };
}
