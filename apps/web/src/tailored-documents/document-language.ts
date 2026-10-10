/**
 * The Document Language an Application keeps for all its Tailored Documents:
 * the Job Offer's language until the Candidate chooses another.
 * Stored on the application row (see migrateTailoredDocuments).
 */
import { jobOfferLanguage, type DocumentLanguage } from "@jobhub/shared";
import type { Pool } from "pg";
import type { Application } from "../applications";

/** The Application's Document Language: the one the Candidate chose, else the Job Offer's. */
export async function documentLanguageOf(database: Pool, application: Pick<Application, "id" | "jobOffer">): Promise<DocumentLanguage> {
  const { rows } = await database.query<{ document_language: DocumentLanguage | null }>(`SELECT document_language FROM application WHERE id = $1`, [application.id]);
  return rows[0]?.document_language ?? jobOfferLanguage(application.jobOffer);
}

/** Keeps the Candidate's choice of Document Language for the Application's next Tailored Documents. */
export async function keepDocumentLanguage(database: Pool, applicationId: string, language: DocumentLanguage): Promise<void> {
  await database.query(`UPDATE application SET document_language = $2 WHERE id = $1`, [applicationId, language]);
}
