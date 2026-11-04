/**
 * The Candidate's objects as the read Coach Actions find them (#714): through the domain modules the pages' routes use,
 * scoped to the Candidate, Archived Profiles and their Applications, Job Searches and Job Digests left out (not_found).
 * Each object is told as the Coach context tells it In view (../coach/context), without the Identity block, then fitted
 * to the room it is given by rule: the fullest telling that fits, else a shorter one (a Master CV without its job
 * descriptions, fewer Job Offers), else cut.
 */
import { NO_INDUSTRY_REFERENCE, type IndustryReference } from "@jobhub/shared";
import type { Applications } from "../applications";
import { criteriaTextOf, cvText, estimateTokens, type CoachAgendaSource } from "../coach/context";
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

export function candidateObjects(sources: CandidateObjectSources): CoachObjectReader {
  const criteriaText = async () => criteriaTextOf(await (sources.industries?.().catch(() => NO_INDUSTRY_REFERENCE) ?? NO_INDUSTRY_REFERENCE));

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
        default:
          return null;
      }
    },
  };
}
