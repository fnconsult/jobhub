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
import type { FollowUpDelays } from "../follow-ups";
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
  /** Follow-ups sent (a Follow-up card accepted, or "Relancée" set), oldest first. */
  followUps: { sentAt: Date }[];
}

/** Everything the Candidate made in Jobbbox, ready to be written out as JSON. */
export interface CandidateDataExport {
  exportedAt: Date;
  /** Null once the account is deleted. */
  account: ExportedAccount | null;
  /** The Candidate's EU AI consent (ADR-0007), or null when they have not given it (or withdrew it). */
  euAiConsent: { givenAt: Date } | null;
  /** The Follow-up Delays the Candidate set, or null while they keep the defaults. */
  followUpDelays: FollowUpDelays | null;
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

  /** Rows of one of the Candidate's tables, as `{ key, ...item }`, grouped by key (e.g. the Application they belong to). */
  async function grouped<T extends object>(sql: string, candidateId: string): Promise<(key: string) => T[]> {
    const { rows } = await database.query<T & { key: string }>(sql, [candidateId]);
    const groups = new Map<string, T[]>();
    for (const { key, ...item } of rows) groups.set(key, [...(groups.get(key) ?? []), item as unknown as T]);
    return (key) => groups.get(key) ?? [];
  }

  async function exportApplications(candidateId: string): Promise<ExportedApplication[]> {
    const followUpsOf = await grouped<{ sentAt: Date }>(
      `SELECT s.application_id AS key, s.sent_at AS "sentAt" FROM follow_up_sent s JOIN application a ON a.id = s.application_id
        WHERE a.candidate_id = $1 ORDER BY s.sent_at`,
      candidateId,
    );
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
          followUps: followUpsOf(id),
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

  async function exportEuAiConsent(candidateId: string): Promise<CandidateDataExport["euAiConsent"]> {
    const { rows } = await database.query<{ givenAt: Date }>(`SELECT given_at AS "givenAt" FROM eu_ai_consent WHERE candidate_id = $1`, [candidateId]);
    return rows[0] ?? null;
  }

  async function exportFollowUpDelays(candidateId: string): Promise<FollowUpDelays | null> {
    const { rows } = await database.query<FollowUpDelays>(
      `SELECT after_applied AS "afterApplied", after_follow_up AS "afterFollowUp" FROM follow_up_delay WHERE candidate_id = $1`,
      [candidateId],
    );
    return rows[0] ?? null;
  }

  return {
    async export(candidateId) {
      const [account, euAiConsent, followUpDelays, profiles, applications] = await Promise.all([
        exportAccount(candidateId),
        exportEuAiConsent(candidateId),
        exportFollowUpDelays(candidateId),
        exportProfiles(candidateId),
        exportApplications(candidateId),
      ]);
      return { exportedAt: new Date(), account, euAiConsent, followUpDelays, profiles, applications };
    },

    async delete(candidateId) {
      await deps.billing?.closeAccount(candidateId);
      await database.query(`DELETE FROM candidate WHERE id = $1`, [candidateId]);
    },
  };
}
