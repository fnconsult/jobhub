/**
 * A Candidate's own data, as a whole (ADR-0010): exported for them to keep, and
 * deleted with their account.
 *
 * One deep module. Callers get `createCandidateData(database, deps)`:
 *  - `export` everything the Candidate made: their Profiles (Search Criteria and
 *    every Master CV Version), their Applications (with their Job Offer and
 *    Interviews) and those Applications' Tailored Documents. Each item is read
 *    through the module that owns it, so the export shows what the app shows.
 */
import type { SearchCriteria } from "@jobhub/shared";
import type { Pool } from "pg";
import type { Application, Applications } from "../applications";
import type { MasterCvVersion, Profiles } from "../profiles";
import type { ApplicationTailoredCv, TailoredCvs } from "../tailored-cv";
import type { ApplicationDrafts, TailoredDocuments } from "../tailored-documents";

export interface ExportedProfile {
  id: string;
  name: string;
  archived: boolean;
  searchCriteria: SearchCriteria;
  /** Newest first. */
  masterCvVersions: MasterCvVersion[];
}

/** An Application as the Candidate keeps it: its Job Offer, Interviews and Tailored Documents. */
export interface ExportedApplication extends Omit<Application, "matchScore"> {
  tailoredDocuments: {
    documentLanguage: ApplicationDrafts["documentLanguage"];
    /** The Tailored CV saved on the Application, or null. */
    tailoredCv: ApplicationTailoredCv["saved"];
    /** A Tailored CV still under the Candidate's review, or null. */
    tailoredCvProposal: ApplicationTailoredCv["proposal"];
    coverLetter: ApplicationDrafts["coverLetter"];
    outreachMessage: ApplicationDrafts["outreachMessage"];
  };
}

/** Everything the Candidate made in Jobbbox, ready to be written out as JSON. */
export interface CandidateDataExport {
  exportedAt: Date;
  /** Oldest first, archived ones included. */
  profiles: ExportedProfile[];
  /** Newest first. */
  applications: ExportedApplication[];
}

export interface CandidateData {
  /** All the Candidate's data. */
  export(candidateId: string): Promise<CandidateDataExport>;
}

export interface CandidateDataDeps {
  profiles: Pick<Profiles, "list" | "get" | "masterCvVersions">;
  applications: Pick<Applications, "list" | "get">;
  tailoredCvs: Pick<TailoredCvs, "get">;
  tailoredDocuments: Pick<TailoredDocuments, "get">;
}

export function createCandidateData(_database: Pool, deps: CandidateDataDeps): CandidateData {
  async function exportProfiles(candidateId: string): Promise<ExportedProfile[]> {
    const summaries = await deps.profiles.list(candidateId);
    const exported = await Promise.all(
      summaries.map(async ({ id }) => {
        const [profile, versions] = await Promise.all([deps.profiles.get(candidateId, id), deps.profiles.masterCvVersions(candidateId, id)]);
        if (!profile || !versions) return null;
        return { id, name: profile.name, archived: profile.archived, searchCriteria: profile.searchCriteria, masterCvVersions: versions };
      }),
    );
    return exported.filter((profile) => profile !== null);
  }

  async function exportApplications(candidateId: string): Promise<ExportedApplication[]> {
    const summaries = await deps.applications.list(candidateId);
    const exported = await Promise.all(
      summaries.map(async ({ id }): Promise<ExportedApplication | null> => {
        const [application, tailoredCv, drafts] = await Promise.all([
          deps.applications.get(candidateId, id),
          deps.tailoredCvs.get(candidateId, id),
          deps.tailoredDocuments.get(candidateId, id),
        ]);
        if (!application || !tailoredCv || !drafts) return null;
        const { matchScore: _derived, ...kept } = application;
        return {
          ...kept,
          tailoredDocuments: {
            documentLanguage: drafts.documentLanguage,
            tailoredCv: tailoredCv.saved,
            tailoredCvProposal: tailoredCv.proposal,
            coverLetter: drafts.coverLetter,
            outreachMessage: drafts.outreachMessage,
          },
        };
      }),
    );
    return exported.filter((application) => application !== null);
  }

  return {
    async export(candidateId) {
      const [profiles, applications] = await Promise.all([exportProfiles(candidateId), exportApplications(candidateId)]);
      return { exportedAt: new Date(), profiles, applications };
    },
  };
}
