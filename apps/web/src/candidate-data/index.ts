/**
 * A Candidate's own data, as a whole (ADR-0010): exported for them to keep, and
 * deleted with their account.
 *
 * One deep module. Callers get `createCandidateData(database, deps)`:
 *  - `export` everything the Candidate made: their account, their Profiles (Search Criteria and
 *    every Master CV Version), their Applications (with their Job Offer and
 *    Interviews) and those Applications' Tailored Documents. Each item is read
 *    through the module that owns it, so the export shows what the app shows.
 *  - `delete` the Candidate's account at once and for good: their billing is
 *    closed first (no paid Plan outlives the account), then the Candidate goes,
 *    and with them everything tied to them (every table holding their data
 *    hangs off theirs with ON DELETE CASCADE: Profiles, CVs, Applications,
 *    Tailored Documents, sessions...). Job Offers are not personal data and may
 *    be referenced by other Candidates: they are kept.
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

/** The Candidate's account itself. */
export interface ExportedAccount {
  email: string;
  name: string;
  interfaceLanguage: string;
  createdAt: Date;
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
  /** Null once the account is deleted. */
  account: ExportedAccount | null;
  /** Oldest first, archived ones included. */
  profiles: ExportedProfile[];
  /** Newest first. */
  applications: ExportedApplication[];
}

export interface CandidateData {
  /** All the Candidate's data. */
  export(candidateId: string): Promise<CandidateDataExport>;
  /**
   * Deletes the Candidate's account and everything tied to it, signing them out
   * everywhere. Throws, deleting nothing, if their billing could not be closed.
   * Deleting an account that no longer exists does nothing.
   */
  delete(candidateId: string): Promise<void>;
}

export interface CandidateDataDeps {
  profiles: Pick<Profiles, "list" | "get" | "masterCvVersions">;
  applications: Pick<Applications, "list" | "get">;
  tailoredCvs: Pick<TailoredCvs, "get">;
  tailoredDocuments: Pick<TailoredDocuments, "get">;
  /** Ends the Candidate's paid Plan, if any, before the account goes. Without it, there is nothing to close. */
  billing?: { closeAccount(candidateId: string): Promise<void> };
}

export function createCandidateData(database: Pool, deps: CandidateDataDeps): CandidateData {
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
        // The Match Score is worked out from the rest, not something the Candidate made.
        const { status, statusChangedAt, createdAt, jobOffer, profile, interviews } = application;
        return {
          id,
          status,
          statusChangedAt,
          createdAt,
          jobOffer,
          profile,
          interviews,
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

  async function exportAccount(candidateId: string): Promise<ExportedAccount | null> {
    const { rows } = await database.query<ExportedAccount>(
      `SELECT email, name, "interfaceLanguage", "createdAt" FROM candidate WHERE id = $1`,
      [candidateId],
    );
    return rows[0] ?? null;
  }

  return {
    async export(candidateId) {
      const [account, profiles, applications] = await Promise.all([exportAccount(candidateId), exportProfiles(candidateId), exportApplications(candidateId)]);
      return { exportedAt: new Date(), account, profiles, applications };
    },

    async delete(candidateId) {
      await deps.billing?.closeAccount(candidateId);
      await database.query(`DELETE FROM candidate WHERE id = $1`, [candidateId]);
    },
  };
}
