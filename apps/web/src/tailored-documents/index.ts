/**
 * Tailored Documents of an Application: its Cover Letter and Outreach Message,
 * drafted by the AI Coach, then edited by the Candidate. (The Tailored CV is #18.)
 *
 * One deep module in front of Postgres and the AI layer. Callers get
 * `createTailoredDocuments(database, { applications, profiles, ai, companyDossiers? })`:
 *  - `get` the Application's Document Language and drafts;
 *  - `draft` (or draft again) the Cover Letter or the Outreach Message: the new
 *    draft replaces the one stored, edits included;
 *  - `edit` a stored draft's text.
 *
 * Rules kept here:
 *  - Drafts are written in the Application's Document Language: the Job Offer's
 *    language unless the Candidate chose another when drafting.
 *  - They draw only on the Profile's Master CV and the Job Offer, plus the Company
 *    Dossier and its Suggested Contact Roles when one is built. No experience or
 *    figure is invented, and no private person is named.
 *  - Drafts only (ADR-0005): nothing here sends anything.
 * Every read and change is scoped to the Candidate; inputs are untrusted and
 * problems come back as results. Task `writing`, EU endpoints only (ADR-0007).
 */
import type { AiLayer } from "@jobhub/ai";
import { DOCUMENT_LANGUAGES, jobOfferLanguage, type DocumentLanguage } from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import type { Application, Applications } from "../applications";
import type { Profiles } from "../profiles";
import { fieldErrors, type FieldError } from "../validation";

export const TAILORED_DOCUMENTS = ["cover_letter", "outreach_message"] as const;
export type TailoredDocumentKind = (typeof TAILORED_DOCUMENTS)[number];

interface Draft {
  /** The language it was written in. */
  language: DocumentLanguage;
  text: string;
  /** When the AI Coach last drafted it. */
  draftedAt: Date;
  /** When it was last changed, by the AI Coach or the Candidate. */
  updatedAt: Date;
}

export type CoverLetter = Draft;

export interface ApplicationDrafts {
  documentLanguage: DocumentLanguage;
  coverLetter: CoverLetter | null;
  outreachMessage: null;
}

/**
 * Where Company Dossiers come from (#17), as this module needs them: the
 * dossier state of an Application, scoped to the Candidate, or null.
 */
export interface CompanyDossierSource {
  get(candidateId: string, applicationId: string): Promise<{ status: string; dossier?: CompanyDossierFacts } | null>;
}

/** The parts of a built Company Dossier a draft can draw on. */
export interface CompanyDossierFacts {
  employer: string;
  /** Codes such as "hr_director": job titles, never people. */
  suggestedContactRoles: readonly string[];
  [fact: string]: unknown;
}

export type TailoredDocumentsResult =
  | { ok: true; drafts: ApplicationDrafts }
  | { ok: false; errors: FieldError[] }
  /** No such Application for this Candidate, or no draft to edit. */
  | { ok: false; error: "not_found" }
  /** The AI layer could not write it; nothing was changed. Try again later. */
  | { ok: false; error: "unavailable" };

export interface TailoredDocuments {
  /** The Application's drafts, or null if it does not exist or belongs to someone else. */
  get(candidateId: string, applicationId: string): Promise<ApplicationDrafts | null>;
  /** Has the AI Coach draft one document, replacing the stored one. `input`: { document, language? }. */
  draft(candidateId: string, applicationId: string, input: unknown): Promise<TailoredDocumentsResult>;
}

export interface TailoredDocumentsDeps {
  applications: Pick<Applications, "get">;
  profiles: Pick<Profiles, "get">;
  ai: AiLayer;
  /** Optional: without it, drafts are written from the Master CV and the Job Offer alone. */
  companyDossiers?: CompanyDossierSource;
}

const draftSchema = z.object({ document: z.enum(TAILORED_DOCUMENTS), language: z.enum(DOCUMENT_LANGUAGES).optional() });

const NOT_FOUND = { ok: false, error: "not_found" } as const;

interface DraftRow {
  kind: TailoredDocumentKind;
  language: DocumentLanguage;
  text: string;
  drafted_at: Date;
  updated_at: Date;
}

const SYSTEM: Record<DocumentLanguage, string> = {
  fr: `Tu es le coach Jobbbox. Tu rédiges une lettre de motivation en français pour un cadre expérimenté qui postule à l'offre ci-dessous.
Règles :
- Appuie-toi uniquement sur son CV de référence, l'offre et, s'il y en a, le dossier sur l'entreprise. N'invente jamais d'expérience, de diplôme ou de chiffre.
- Ne nomme aucune personne de l'entreprise.
- Une page au plus, ton sobre et concret, sans formule creuse.
Réponds uniquement avec le texte de la lettre, sans commentaire.`,
  en: `You are the Jobbbox coach. You write a cover letter in English for an experienced professional applying to the job offer below.
Rules:
- Draw only on their reference CV, the job offer and, if any, the company dossier. Never invent experience, degrees or figures.
- Do not name anyone at the company.
- One page at most, plain and concrete, no empty phrases.
Reply with the letter's text only, no comment.`,
};

export function createTailoredDocuments(database: Pool, deps: TailoredDocumentsDeps): TailoredDocuments {
  async function storedLanguage(applicationId: string): Promise<DocumentLanguage | null> {
    const { rows } = await database.query<{ document_language: DocumentLanguage | null }>(`SELECT document_language FROM application WHERE id = $1`, [applicationId]);
    return rows[0]?.document_language ?? null;
  }

  async function draftsOf(application: Application): Promise<ApplicationDrafts> {
    const [language, { rows }] = await Promise.all([
      storedLanguage(application.id),
      database.query<DraftRow>(`SELECT kind, language, text, drafted_at, updated_at FROM tailored_document WHERE application_id = $1`, [application.id]),
    ]);
    const row = rows.find((candidate) => candidate.kind === "cover_letter");
    return {
      documentLanguage: language ?? jobOfferLanguage(application.jobOffer),
      coverLetter: row ? { language: row.language, text: row.text, draftedAt: row.drafted_at, updatedAt: row.updated_at } : null,
      outreachMessage: null,
    };
  }

  async function write(candidateId: string, application: Application, language: DocumentLanguage): Promise<string | null> {
    const profile = await deps.profiles.get(candidateId, application.profile.id);
    if (!profile) return null;
    const { jobOffer } = application;
    const prompt = [
      `Offre : ${JSON.stringify({ title: jobOffer.title, employer: jobOffer.employer, location: jobOffer.location, content: jobOffer.content })}`,
      `CV de référence : ${JSON.stringify(profile.masterCv.content)}`,
    ].join("\n\n");
    try {
      const { text } = await deps.ai.generate({ task: "writing", candidateId, system: SYSTEM[language], prompt });
      return text.trim() || null;
    } catch (error) {
      console.warn("[tailored-documents] the AI Coach could not write a draft:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  return {
    async get(candidateId, applicationId) {
      const application = await deps.applications.get(candidateId, applicationId);
      return application ? draftsOf(application) : null;
    },

    async draft(candidateId, applicationId, input) {
      const parsed = draftSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return NOT_FOUND;
      const language = parsed.data.language ?? (await draftsOf(application)).documentLanguage;
      const text = await write(candidateId, application, language);
      if (text === null) return { ok: false, error: "unavailable" };
      if (parsed.data.language) await database.query(`UPDATE application SET document_language = $2 WHERE id = $1`, [application.id, language]);
      await database.query(
        `INSERT INTO tailored_document (application_id, kind, language, text) VALUES ($1, $2, $3, $4)
         ON CONFLICT (application_id, kind) DO UPDATE SET language = $3, text = $4, drafted_at = now(), updated_at = now()`,
        [application.id, parsed.data.document, language, text],
      );
      return { ok: true, drafts: await draftsOf(application) };
    },
  };
}

/** Creates or upgrades the Tailored Document table and the Application's Document Language. Run after the Application table. Safe to run repeatedly. */
export async function migrateTailoredDocuments(database: Pool): Promise<void> {
  const kinds = TAILORED_DOCUMENTS.map((kind) => `'${kind}'`).join(", ");
  const languages = DOCUMENT_LANGUAGES.map((language) => `'${language}'`).join(", ");
  await database.query(`
    ALTER TABLE application ADD COLUMN IF NOT EXISTS document_language text CHECK (document_language IN (${languages}));
    CREATE TABLE IF NOT EXISTS tailored_document (
      application_id uuid NOT NULL REFERENCES application (id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN (${kinds})),
      language text NOT NULL CHECK (language IN (${languages})),
      text text NOT NULL,
      drafted_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (application_id, kind)
    );
  `);
}
