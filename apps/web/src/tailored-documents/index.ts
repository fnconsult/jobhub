/**
 * Tailored Documents of an Application: its Cover Letter and Outreach Message,
 * drafted by the AI Coach, then edited by the Candidate. (The Tailored CV is
 * `../tailored-cv`.)
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
 *    figure is invented, and no private person is named, but for the Enriched
 *    Contact (Premium) the Candidate addresses an Outreach Message to: only their
 *    name and job title reach the AI Coach.
 *  - A Cover Letter is drafted as its body only, in plain text: no Markdown, no
 *    `[…]` placeholders, and no sender block, date or signature, which the
 *    Application export adds from the Master CV (#162).
 *  - Drafts only (ADR-0005): nothing here sends anything.
 * Every read and change is scoped to the Candidate; inputs are untrusted and
 * problems come back as results. Task `writing`, EU endpoints only (ADR-0007).
 * The AI Coach's instructions and the AI drafting are the "cover-letter" and "outreach-message"
 * task Playbooks' (ADR-0026); who may be named and each document's format stay here.
 */
import { createProvenanceRecorder, type AiLayer, type ProvenanceRecorder } from "@jobhub/ai";
import { DOCUMENT_LANGUAGES, failureOf, readProvenance, type DocumentLanguage, type Provenance, type ProvenanceEvent } from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import type { Application, Applications } from "../applications";
import type { CompanyDossier, CompanyDossiers } from "../company-dossiers";
import type { EnrichedContact, EnrichedContacts } from "../enriched-contacts";
import type { Profiles } from "../profiles";
import { routes } from "../routes";
import { taskRun, type TaskPlaybookReader, type TaskRun } from "../task-playbooks";
import { fieldErrors, type FieldError } from "../validation";
import { coverLetterBody } from "./cover-letter-body";
import { documentLanguageOf, keepDocumentLanguage } from "./document-language";

import { OUTREACH_CHANNELS, TAILORED_DOCUMENTS, type OutreachChannel, type TailoredDocumentKind } from "./kinds";

export { OUTREACH_CHANNELS, TAILORED_DOCUMENTS, type OutreachChannel, type TailoredDocumentKind } from "./kinds";
export { coverLetterBody } from "./cover-letter-body";

interface Draft {
  /** The language it was written in. */
  language: DocumentLanguage;
  text: string;
  /** When the AI Coach last drafted it. */
  draftedAt: Date;
  /** When it was last changed, by the AI Coach or the Candidate. */
  updatedAt: Date;
  /** What served its drafting (ADR-0034, #334): the model, its tokens and time, the pages it drew on; null for one drafted before it was kept. */
  provenance: Provenance | null;
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
  /** The Enriched Contact it is addressed to, as when it was drafted; null when to no one in particular. */
  contact: OutreachContact | null;
}

/** Who an Outreach Message is for: an Enriched Contact's name, job title and first email. */
export interface OutreachContact {
  id: string;
  name: string;
  jobTitle?: string;
  email?: string;
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
export type CompanyDossierSource = Pick<CompanyDossiers, "get">;

/** Where Enriched Contacts come from (#23): one revealed contact of an Application, scoped to the Candidate, or null. */
export type EnrichedContactSource = Pick<EnrichedContacts, "contact">;

export type TailoredDocumentsResult =
  | { ok: true; drafts: ApplicationDrafts }
  | { ok: false; errors: FieldError[] }
  /** No such Application for this Candidate, or no draft to edit. */
  | { ok: false; error: "not_found" }
  /** The AI layer could not write it; nothing was changed. Try again later. */
  | { ok: false; error: "unavailable" }
  /** The Candidate stopped it (#334): the half-written draft is discarded, nothing was changed. */
  | { ok: false; error: "stopped" };

/**
 * How a drafting runs (#334): `signal`, the Candidate's Stop, aborts its AI call; `onEvent` hears each step start and end,
 * as AI Activity shows them live.
 */
export interface DraftOptions {
  signal?: AbortSignal;
  onEvent?: (event: ProvenanceEvent) => void;
}

export interface TailoredDocuments {
  /** The Application's drafts, or null if it does not exist or belongs to someone else. */
  get(candidateId: string, applicationId: string): Promise<ApplicationDrafts | null>;
  /**
   * Has the AI Coach draft one document, replacing the stored one. `input`: { document, language?, channel? (Outreach Message: "email"
   * by default), contactId? (Outreach Message: the Enriched Contact it is for; "not_found" if not one of the Application's) }.
   * Kept with its Provenance. Once `options.signal` aborts, "stopped": nothing is kept, the stored draft stays.
   */
  draft(candidateId: string, applicationId: string, input: unknown, options?: DraftOptions): Promise<TailoredDocumentsResult>;
  /**
   * The Candidate's edit of a draft the AI Coach wrote. `input`: { document, text, subject? (Outreach Message) }.
   * "not_found" also when there is no draft yet.
   */
  edit(candidateId: string, applicationId: string, input: unknown): Promise<TailoredDocumentsResult>;
}

export interface TailoredDocumentsDeps {
  applications: Pick<Applications, "get">;
  profiles: Pick<Profiles, "get">;
  ai: AiLayer;
  /** Optional: without it, drafts are written from the Master CV and the Job Offer alone. */
  companyDossiers?: CompanyDossierSource;
  /** Optional: without it, Outreach Messages are addressed to no one in particular. */
  enrichedContacts?: EnrichedContactSource;
  /** The "cover-letter" and "outreach-message" task Playbooks' served versions (ADR-0026); without it, their built-in text. */
  taskPlaybooks?: TaskPlaybookReader;
}

const draftSchema = z.object({
  document: z.enum(TAILORED_DOCUMENTS),
  language: z.enum(DOCUMENT_LANGUAGES).optional(),
  channel: z.enum(OUTREACH_CHANNELS).default("email"),
  contactId: z.uuid().optional(),
});

/** Longest text kept for a draft, in characters: a long letter is about 4,000. */
export const MAX_DRAFT_LENGTH = 10_000;
export const MAX_SUBJECT_LENGTH = 300;

const editSchema = z.object({
  document: z.enum(TAILORED_DOCUMENTS),
  text: z.string().trim().min(1).max(MAX_DRAFT_LENGTH),
  subject: z.string().trim().max(MAX_SUBJECT_LENGTH).optional(),
});

const NOT_FOUND = { ok: false, error: "not_found" } as const;

interface DraftRow {
  kind: TailoredDocumentKind;
  language: DocumentLanguage;
  channel: OutreachChannel | null;
  subject: string;
  contact_roles: string[];
  contact: OutreachContact | null;
  text: string;
  drafted_at: Date;
  updated_at: Date;
  provenance: unknown;
}

/** The format of each document, in each Document Language: the Cover Letter's body only, in plain text (#162); the Outreach Message's JSON. */
const FORMAT: Record<DocumentLanguage, Record<TailoredDocumentKind, string>> = {
  fr: {
    cover_letter:
      "Une page au plus. Écris uniquement le corps de la lettre, de la formule d'appel à la formule de politesse : ni coordonnées de l'expéditeur ou du destinataire, ni lieu et date, ni objet, ni signature, ajoutés à l'export depuis son CV. " +
      "En texte brut, sans Markdown (ni **, ni #), ni crochets à compléter. Réponds uniquement avec ce texte, sans commentaire.",
    outreach_message: 'Réponds uniquement avec un objet JSON : {"subject": "objet du message", "text": "texte du message"}.',
  },
  en: {
    cover_letter:
      "One page at most. Write the body of the letter only, from the salutation to the closing: no sender or recipient details, place and date, subject or signature, which the export adds from their CV. " +
      "In plain text, with no Markdown (no **, no #) and no brackets to fill in. Reply with that text only, no comment.",
    outreach_message: 'Reply with a JSON object only: {"subject": "the message subject", "text": "the message text"}.',
  },
};

/** Who may be named: no one at the company, or only the Enriched Contact the message is addressed to. */
const PEOPLE: Record<DocumentLanguage, { nobody: string; recipientOnly: string }> = {
  fr: {
    nobody: "Ne nomme aucune personne de l'entreprise.",
    recipientOnly: "Adresse le message au destinataire indiqué, par son nom. Ne nomme aucune autre personne de l'entreprise.",
  },
  en: {
    nobody: "Do not name anyone at the company.",
    recipientOnly: "Address the message to the recipient given, by name. Do not name anyone else at the company.",
  },
};

/** The task Playbook writing each document: one for the Cover Letter, one for the Outreach Message (ADR-0026). */
const TASK_PLAYBOOK = { cover_letter: "cover-letter", outreach_message: "outreach-message" } as const satisfies Record<TailoredDocumentKind, string>;

/**
 * The instructions: the task Playbook's section for the Document Language (and the Outreach Message's
 * channel), then who may be named and the document's format, which stay here.
 */
function systemPrompt(run: TaskRun, language: DocumentLanguage, document: TailoredDocumentKind, channel: OutreachChannel, addressed: boolean): string {
  const section = document === "outreach_message" ? `${language} ${channel}` : language;
  return [run.text(section), `- ${PEOPLE[language][addressed ? "recipientOnly" : "nobody"]}`, FORMAT[language][document]].join("\n");
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
const LABELS: Record<DocumentLanguage, { offer: string; cv: string; dossier: string; contacts: string; recipient: string }> = {
  fr: {
    offer: "Offre",
    cv: "CV de référence",
    dossier: "Dossier sur l'entreprise",
    contacts: "Contacts à viser (des fonctions, jamais des personnes)",
    recipient: "Destinataire",
  },
  en: { offer: "Job offer", cv: "Reference CV", dossier: "Company dossier", contacts: "Contacts to address (job titles, never people)", recipient: "Recipient" },
};

/** What an Outreach Message keeps of the Enriched Contact it is for. */
function outreachContactOf(contact: EnrichedContact): OutreachContact {
  const kept: OutreachContact = { id: contact.id, name: contact.name };
  if (contact.jobTitle) kept.jobTitle = contact.jobTitle;
  if (contact.emails[0]) kept.email = contact.emails[0];
  return kept;
}

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
  async function draftsOf(application: Application): Promise<ApplicationDrafts> {
    const [language, { rows }] = await Promise.all([
      documentLanguageOf(database, application),
      database.query<DraftRow>(`SELECT kind, language, channel, subject, contact_roles, contact, text, drafted_at, updated_at, provenance FROM tailored_document WHERE application_id = $1`, [application.id]),
    ]);
    const draft = (row: DraftRow): Draft => ({ language: row.language, text: row.text, draftedAt: row.drafted_at, updatedAt: row.updated_at, provenance: readProvenance(row.provenance) });
    const letter = rows.find((row) => row.kind === "cover_letter");
    const message = rows.find((row) => row.kind === "outreach_message");
    return {
      documentLanguage: language,
      coverLetter: letter ? draft(letter) : null,
      outreachMessage: message ? { ...draft(message), channel: message.channel ?? "email", subject: message.subject, contactRoles: message.contact_roles, contact: message.contact } : null,
    };
  }

  type Request = z.output<typeof draftSchema> & { language: DocumentLanguage; contact: OutreachContact | null };

  /** The built Company Dossier of the Application, if any. A dossier that cannot be read is done without. */
  async function dossierOf(candidateId: string, applicationId: string): Promise<CompanyDossier | null> {
    try {
      const state = await deps.companyDossiers?.get(candidateId, applicationId);
      return state?.status === "built" && state.dossier ? state.dossier : null;
    } catch (error) {
      console.warn("[tailored-documents] the Company Dossier could not be read:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * The AI Coach's draft, its steps and pages kept by `recorder`; null when it could not write one, "stopped" when the
   * Candidate stopped it.
   */
  async function write(
    candidateId: string,
    application: Application,
    request: Request,
    recorder: ProvenanceRecorder,
  ): Promise<{ subject: string; text: string; contactRoles: string[] } | "stopped" | null> {
    const [profile, dossier] = await Promise.all([deps.profiles.get(candidateId, application.profile.id), dossierOf(candidateId, application.id)]);
    if (!profile) return null;
    // The pages it draws on: the Job Offer's, the Master CV, and the Company Dossier when one is built.
    if (application.jobOffer.source.url) recorder.site(application.jobOffer.source.url);
    recorder.site(routes.editMasterCv(profile.id));
    if (dossier) recorder.site(routes.applicationSection(application.id, "dossier"));
    const { language, document, channel, contact } = request;
    const { jobOffer } = application;
    const label = LABELS[language];
    const contactRoles = (dossier?.suggestedContactRoles ?? []).map((role) => CONTACT_ROLES[language][role] ?? role);
    const parts = [
      `${label.offer} : ${JSON.stringify({ title: jobOffer.title, employer: jobOffer.employer, location: jobOffer.location, content: jobOffer.content })}`,
      `${label.cv} : ${JSON.stringify(profile.masterCv.content)}`,
    ];
    if (dossier) {
      // When it was built and where it came from tell the AI Coach nothing about the company.
      const facts = Object.fromEntries(Object.entries(dossier).filter(([key]) => !["builtAt", "sources", "suggestedContactRoles"].includes(key)));
      parts.push(`${label.dossier} : ${JSON.stringify(facts)}`);
      if (document === "outreach_message" && contactRoles.length > 0) parts.push(`${label.contacts} : ${contactRoles.join(" ; ")}`);
    }
    // Only who the message is for: the provider's data (emails, phones, source) never reaches the AI Coach.
    if (document === "outreach_message" && contact) parts.push(`${label.recipient} : ${[contact.name, contact.jobTitle].filter(Boolean).join(", ")}`);
    const prompt = parts.join("\n\n");
    try {
      const run = await taskRun(deps.taskPlaybooks, TASK_PLAYBOOK[document], deps.ai);
      const { text } = await recorder.ai.generate({
        task: "writing",
        candidateId,
        system: systemPrompt(run, language, document, channel, document === "outreach_message" && !!contact),
        ...run.agent,
        prompt,
        // The Master CV, identity block included: the draft speaks as the Candidate (ADR-0007).
        containsIdentity: true,
      });
      const written = document === "outreach_message" ? outreachIn(text) : { subject: "", text: coverLetterBody(text, profile.masterCv.content) };
      return written.text ? { ...written, contactRoles: document === "outreach_message" ? contactRoles : [] } : null;
    } catch (error) {
      if (failureOf(error).reason === "stopped") return "stopped";
      console.warn("[tailored-documents] the AI Coach could not write a draft:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  return {
    async get(candidateId, applicationId) {
      const application = await deps.applications.get(candidateId, applicationId);
      return application ? draftsOf(application) : null;
    },

    async draft(candidateId, applicationId, input, options = {}) {
      const parsed = draftSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return NOT_FOUND;
      const language = parsed.data.language ?? (await draftsOf(application)).documentLanguage;
      const { document, channel, contactId } = parsed.data;
      let contact: OutreachContact | null = null;
      if (document === "outreach_message" && contactId) {
        const enriched = await deps.enrichedContacts?.contact(candidateId, application.id, contactId);
        if (!enriched) return NOT_FOUND;
        contact = outreachContactOf(enriched);
      }
      const { signal, onEvent } = options;
      const recorder = createProvenanceRecorder(deps.ai, { ...(signal ? { signal } : {}), ...(onEvent ? { onEvent } : {}) });
      const written = await write(candidateId, application, { ...parsed.data, language, contact }, recorder);
      // A Stop discards the half-written draft (#334): nothing is kept, even when the AI call had just ended.
      if (written === "stopped" || signal?.aborted) return { ok: false, error: "stopped" };
      if (!written) return { ok: false, error: "unavailable" };
      if (parsed.data.language) await keepDocumentLanguage(database, application.id, language);
      await database.query(
        `INSERT INTO tailored_document (application_id, kind, language, channel, subject, contact_roles, contact, text, provenance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (application_id, kind) DO UPDATE
           SET language = $3, channel = $4, subject = $5, contact_roles = $6, contact = $7, text = $8, provenance = $9, drafted_at = now(), updated_at = now()`,
        [
          application.id,
          document,
          language,
          document === "outreach_message" ? channel : null,
          written.subject,
          written.contactRoles,
          contact ? JSON.stringify(contact) : null,
          written.text,
          JSON.stringify(recorder.provenance()),
        ],
      );
      return { ok: true, drafts: await draftsOf(application) };
    },

    async edit(candidateId, applicationId, input) {
      const parsed = editSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return NOT_FOUND;
      const { document, text, subject } = parsed.data;
      const { rowCount } = await database.query(
        `UPDATE tailored_document SET text = $3, subject = COALESCE($4, subject), updated_at = now() WHERE application_id = $1 AND kind = $2`,
        [application.id, document, text, document === "outreach_message" ? (subject ?? null) : null],
      );
      if (rowCount === 0) return NOT_FOUND;
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
    -- Outreach Messages only: the Enriched Contact it is addressed to (#23).
    ALTER TABLE tailored_document ADD COLUMN IF NOT EXISTS contact jsonb;
    -- What served the drafting (ADR-0034, #334), null before: « modèle non enregistré ». A Candidate's edit keeps it.
    ALTER TABLE tailored_document ADD COLUMN IF NOT EXISTS provenance jsonb;
  `);
}
