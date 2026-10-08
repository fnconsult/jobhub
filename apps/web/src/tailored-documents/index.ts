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

/** How an Outreach Message reaches the contact: an email, or a LinkedIn InMail the Candidate sends themselves (ADR-0001). */
export const OUTREACH_CHANNELS = ["email", "inmail"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

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

export interface OutreachMessage extends Draft {
  channel: OutreachChannel;
  /** Empty when there is none. */
  subject: string;
  /**
   * Who to send it to: the Company Dossier's Suggested Contact Roles when it was
   * drafted, as job titles in its language. Empty when there was no dossier.
   */
  contactRoles: string[];
}

export interface ApplicationDrafts {
  documentLanguage: DocumentLanguage;
  coverLetter: CoverLetter | null;
  outreachMessage: OutreachMessage | null;
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
  /** Has the AI Coach draft one document, replacing the stored one. `input`: { document, language?, channel? (Outreach Message: "email" by default) }. */
  draft(candidateId: string, applicationId: string, input: unknown): Promise<TailoredDocumentsResult>;
}

export interface TailoredDocumentsDeps {
  applications: Pick<Applications, "get">;
  profiles: Pick<Profiles, "get">;
  ai: AiLayer;
  /** Optional: without it, drafts are written from the Master CV and the Job Offer alone. */
  companyDossiers?: CompanyDossierSource;
}

const draftSchema = z.object({
  document: z.enum(TAILORED_DOCUMENTS),
  language: z.enum(DOCUMENT_LANGUAGES).optional(),
  channel: z.enum(OUTREACH_CHANNELS).default("email"),
});

const NOT_FOUND = { ok: false, error: "not_found" } as const;

interface DraftRow {
  kind: TailoredDocumentKind;
  language: DocumentLanguage;
  channel: OutreachChannel | null;
  subject: string;
  contact_roles: string[];
  text: string;
  drafted_at: Date;
  updated_at: Date;
}

/** What to write, per document (and channel), in each Document Language. */
const WHAT: Record<DocumentLanguage, Record<TailoredDocumentKind | OutreachChannel, string>> = {
  fr: {
    cover_letter: "une lettre de motivation en français",
    outreach_message: "un message d'approche en français",
    email: "un e-mail d'approche en français, court (150 mots au plus), à un contact chez l'employeur",
    inmail: "un InMail LinkedIn d'approche en français, très court (100 mots au plus), à un contact chez l'employeur",
  },
  en: {
    cover_letter: "a cover letter in English",
    outreach_message: "an outreach message in English",
    email: "a short outreach email in English (150 words at most) to a contact at the employer",
    inmail: "a very short LinkedIn InMail in English (100 words at most) to a contact at the employer",
  },
};

const RULES: Record<DocumentLanguage, string> = {
  fr: `Règles :
- Appuie-toi uniquement sur son CV de référence, l'offre et, s'il y en a, le dossier sur l'entreprise. N'invente jamais d'expérience, de diplôme ou de chiffre.
- Ne nomme aucune personne de l'entreprise.
- Ton sobre et concret, sans formule creuse.`,
  en: `Rules:
- Draw only on their reference CV, the job offer and, if any, the company dossier. Never invent experience, degrees or figures.
- Do not name anyone at the company.
- Plain and concrete, no empty phrases.`,
};

const FORMAT: Record<DocumentLanguage, Record<TailoredDocumentKind, string>> = {
  fr: {
    cover_letter: "Une page au plus. Réponds uniquement avec le texte de la lettre, sans commentaire.",
    outreach_message: 'Réponds uniquement avec un objet JSON : {"subject": "objet du message", "text": "texte du message"}.',
  },
  en: {
    cover_letter: "One page at most. Reply with the letter's text only, no comment.",
    outreach_message: 'Reply with a JSON object only: {"subject": "the message subject", "text": "the message text"}.',
  },
};

function systemPrompt(language: DocumentLanguage, document: TailoredDocumentKind, channel: OutreachChannel): string {
  const what = WHAT[language][document === "outreach_message" ? channel : document];
  const intro =
    language === "fr"
      ? `Tu es le coach Jobbbox. Tu rédiges ${what} pour un cadre expérimenté qui postule à l'offre ci-dessous.`
      : `You are the Jobbbox coach. You write ${what} for an experienced professional applying to the job offer below.`;
  return [intro, RULES[language], FORMAT[language][document]].join("\n");
}

/** Suggested Contact Roles (#17) as job titles. A role not listed here is written as given. */
const CONTACT_ROLES: Record<DocumentLanguage, Record<string, string>> = {
  fr: {
    hiring_manager: "Responsable du poste à pourvoir",
    talent_acquisition: "Responsable du recrutement",
    hr_director: "Directeur ou directrice des ressources humaines",
    hr_manager: "Responsable des ressources humaines",
    chief_executive: "Dirigeant ou dirigeante de l'entreprise",
  },
  en: {
    hiring_manager: "Hiring manager",
    talent_acquisition: "Talent acquisition lead",
    hr_director: "HR director",
    hr_manager: "HR manager",
    chief_executive: "Chief executive",
  },
};

/** Labels for the facts a prompt is made of, in each Document Language. */
const LABELS: Record<DocumentLanguage, { offer: string; cv: string; dossier: string; contacts: string }> = {
  fr: { offer: "Offre", cv: "CV de référence", dossier: "Dossier sur l'entreprise", contacts: "Contacts à viser (des fonctions, jamais des personnes)" },
  en: { offer: "Job offer", cv: "Reference CV", dossier: "Company dossier", contacts: "Contacts to address (job titles, never people)" },
};

const outreachReply = z.object({ subject: z.string().catch(""), text: z.string() });

/** The subject and text of an Outreach Message reply: its JSON object, or else the whole reply as the text. */
function outreachIn(reply: string): { subject: string; text: string } {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = outreachReply.safeParse(JSON.parse(reply.slice(start, end + 1)));
      if (parsed.success && parsed.data.text.trim()) return { subject: parsed.data.subject.trim(), text: parsed.data.text.trim() };
    } catch {
      // Not JSON after all: the reply is the message.
    }
  }
  return { subject: "", text: reply.trim() };
}

export function createTailoredDocuments(database: Pool, deps: TailoredDocumentsDeps): TailoredDocuments {
  async function storedLanguage(applicationId: string): Promise<DocumentLanguage | null> {
    const { rows } = await database.query<{ document_language: DocumentLanguage | null }>(`SELECT document_language FROM application WHERE id = $1`, [applicationId]);
    return rows[0]?.document_language ?? null;
  }

  async function draftsOf(application: Application): Promise<ApplicationDrafts> {
    const [language, { rows }] = await Promise.all([
      storedLanguage(application.id),
      database.query<DraftRow>(`SELECT kind, language, channel, subject, contact_roles, text, drafted_at, updated_at FROM tailored_document WHERE application_id = $1`, [application.id]),
    ]);
    const draft = (row: DraftRow): Draft => ({ language: row.language, text: row.text, draftedAt: row.drafted_at, updatedAt: row.updated_at });
    const letter = rows.find((row) => row.kind === "cover_letter");
    const message = rows.find((row) => row.kind === "outreach_message");
    return {
      documentLanguage: language ?? jobOfferLanguage(application.jobOffer),
      coverLetter: letter ? draft(letter) : null,
      outreachMessage: message ? { ...draft(message), channel: message.channel ?? "email", subject: message.subject, contactRoles: message.contact_roles } : null,
    };
  }

  type Request = z.output<typeof draftSchema> & { language: DocumentLanguage };

  /** The built Company Dossier of the Application, if any. A dossier that cannot be read is done without. */
  async function dossierOf(candidateId: string, applicationId: string): Promise<CompanyDossierFacts | null> {
    try {
      const state = await deps.companyDossiers?.get(candidateId, applicationId);
      return state?.status === "built" && state.dossier ? state.dossier : null;
    } catch (error) {
      console.warn("[tailored-documents] the Company Dossier could not be read:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  /** The AI Coach's draft, or null when it could not write one. */
  async function write(
    candidateId: string,
    application: Application,
    request: Request,
  ): Promise<{ subject: string; text: string; contactRoles: string[] } | null> {
    const [profile, dossier] = await Promise.all([deps.profiles.get(candidateId, application.profile.id), dossierOf(candidateId, application.id)]);
    if (!profile) return null;
    const { language, document, channel } = request;
    const { jobOffer } = application;
    const label = LABELS[language];
    const contactRoles = (dossier?.suggestedContactRoles ?? []).map((role) => CONTACT_ROLES[language][role] ?? role);
    const parts = [
      `${label.offer} : ${JSON.stringify({ title: jobOffer.title, employer: jobOffer.employer, location: jobOffer.location, content: jobOffer.content })}`,
      `${label.cv} : ${JSON.stringify(profile.masterCv.content)}`,
    ];
    if (dossier) {
      // When it was built and where it came from tell the AI Coach nothing about the company.
      const { builtAt: _builtAt, sources: _sources, suggestedContactRoles: _roles, ...facts } = dossier;
      parts.push(`${label.dossier} : ${JSON.stringify(facts)}`);
      if (document === "outreach_message" && contactRoles.length > 0) parts.push(`${label.contacts} : ${contactRoles.join(" ; ")}`);
    }
    const prompt = parts.join("\n\n");
    try {
      const { text } = await deps.ai.generate({ task: "writing", candidateId, system: systemPrompt(language, document, channel), prompt });
      const written = document === "outreach_message" ? outreachIn(text) : { subject: "", text: text.trim() };
      return written.text ? { ...written, contactRoles: document === "outreach_message" ? contactRoles : [] } : null;
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
      const { document, channel } = parsed.data;
      const written = await write(candidateId, application, { ...parsed.data, language });
      if (!written) return { ok: false, error: "unavailable" };
      if (parsed.data.language) await database.query(`UPDATE application SET document_language = $2 WHERE id = $1`, [application.id, language]);
      await database.query(
        `INSERT INTO tailored_document (application_id, kind, language, channel, subject, contact_roles, text) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (application_id, kind) DO UPDATE
           SET language = $3, channel = $4, subject = $5, contact_roles = $6, text = $7, drafted_at = now(), updated_at = now()`,
        [application.id, document, language, document === "outreach_message" ? channel : null, written.subject, written.contactRoles, written.text],
      );
      return { ok: true, drafts: await draftsOf(application) };
    },
  };
}

/** Creates or upgrades the Tailored Document table and the Application's Document Language. Run after the Application table. Safe to run repeatedly. */
export async function migrateTailoredDocuments(database: Pool): Promise<void> {
  const kinds = TAILORED_DOCUMENTS.map((kind) => `'${kind}'`).join(", ");
  const channels = OUTREACH_CHANNELS.map((channel) => `'${channel}'`).join(", ");
  const languages = DOCUMENT_LANGUAGES.map((language) => `'${language}'`).join(", ");
  await database.query(`
    ALTER TABLE application ADD COLUMN IF NOT EXISTS document_language text CHECK (document_language IN (${languages}));
    CREATE TABLE IF NOT EXISTS tailored_document (
      application_id uuid NOT NULL REFERENCES application (id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN (${kinds})),
      language text NOT NULL CHECK (language IN (${languages})),
      -- Outreach Messages only.
      channel text CHECK (channel IN (${channels})),
      subject text NOT NULL DEFAULT '',
      contact_roles text[] NOT NULL DEFAULT '{}',
      text text NOT NULL,
      drafted_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (application_id, kind)
    );
  `);
}
