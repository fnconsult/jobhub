/**
 * Tailored CV of an Application: a copy of the Profile's Master CV adapted to
 * the Job Offer, proposed by the AI Coach, reviewed by the Candidate against the
 * Master CV, then saved on the Application.
 *
 * One deep module in front of Postgres and the AI layer. Callers get
 * `createTailoredCvs(database, { applications, profiles, ai })`:
 *  - `get` the Application's Document Language, the proposal under review and the saved Tailored CV;
 *  - `propose` (or propose again) a Tailored CV: it replaces the proposal under review, never the saved one.
 *
 * Rules kept here (ADR-0006):
 *  - A Tailored CV only rephrases, reorders, cuts and emphasises facts of the
 *    Master CV. Whatever the AI Coach writes, the proposal is rebuilt from the
 *    Master CV: identity and contact details are copied, jobs, diplomas,
 *    languages and skills are kept only if the Master CV has them.
 * Every read and change is scoped to the Candidate; inputs are untrusted and
 * problems come back as results. Task `writing`, EU endpoints only (ADR-0007).
 */
import type { AiLayer } from "@jobhub/ai";
import { DOCUMENT_LANGUAGES, normalise, type CvContent, type DocumentLanguage } from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import type { Application, Applications } from "../applications";
import type { Profiles } from "../profiles";
import { documentLanguageOf, keepDocumentLanguage } from "../tailored-documents/document-language";
import { fieldErrors, type FieldError } from "../validation";

/** A Tailored CV the AI Coach proposed, under the Candidate's review. */
export interface TailoredCvProposal {
  /** The language it is written in. */
  language: DocumentLanguage;
  /** The Master CV Version it was derived from, and reviewed against. */
  masterCvVersion: number;
  content: CvContent;
  proposedAt: Date;
}

export interface ApplicationTailoredCv {
  documentLanguage: DocumentLanguage;
  /** The proposal under review, or null. */
  proposal: TailoredCvProposal | null;
  /** The Tailored CV saved on the Application, or null. */
  saved: null;
}

export type TailoredCvResult =
  | { ok: true; tailoredCv: ApplicationTailoredCv }
  | { ok: false; errors: FieldError[] }
  /** No such Application for this Candidate. */
  | { ok: false; error: "not_found" }
  /** The AI layer could not write it; nothing was changed. Try again later. */
  | { ok: false; error: "unavailable" };

export interface TailoredCvs {
  /** The Application's Tailored CV, or null if it does not exist or belongs to someone else. */
  get(candidateId: string, applicationId: string): Promise<ApplicationTailoredCv | null>;
  /** Has the AI Coach propose a Tailored CV, replacing the proposal under review. `input`: { language? }. */
  propose(candidateId: string, applicationId: string, input: unknown): Promise<TailoredCvResult>;
}

export interface TailoredCvsDeps {
  applications: Pick<Applications, "get">;
  profiles: Pick<Profiles, "get">;
  ai: AiLayer;
}

const proposeSchema = z.object({ language: z.enum(DOCUMENT_LANGUAGES).optional() });

const NOT_FOUND = { ok: false, error: "not_found" } as const;

/** What the AI Coach replies: its adaptation of the Master CV. Anything it leaves out or gets wrong is taken from the Master CV. */
const text = z.string().catch("");
const aiReply = z.object({
  headline: text,
  summary: text,
  experience: z.array(z.object({ employer: text, period: text, title: text, description: text })).catch([]),
  education: z.array(z.object({ degree: text, institution: text, year: text })).catch([]),
  skills: z.array(z.string()).catch([]),
  languages: z.array(z.object({ name: text, level: text })).catch([]),
});
type AiReply = z.output<typeof aiReply>;

const same = (a: string, b: string) => normalise(a) === normalise(b);

/**
 * The proposal rebuilt from the Master CV (ADR-0006): the AI Coach may rephrase
 * the headline, the summary and each job's title and description, reorder and
 * cut jobs, diplomas, languages and skills, and nothing else.
 */
function fromMasterCv(master: CvContent, reply: AiReply): CvContent {
  const pick = <T>(items: T[], wanted: unknown[], matches: (item: T, wanted: never) => boolean): T[] => {
    const kept: T[] = [];
    for (const candidate of wanted) {
      const item = items.find((option) => !kept.includes(option) && matches(option, candidate as never));
      if (item) kept.push(item);
    }
    return kept;
  };
  type Job = AiReply["experience"][number];
  const experience = pick(master.experience, reply.experience, (job, wanted: Job) => same(job.employer, wanted.employer) && same(job.period, wanted.period)).map((job) => {
    const wanted = reply.experience.find((option) => same(job.employer, option.employer) && same(job.period, option.period))!;
    return { ...job, title: wanted.title.trim() || job.title, description: wanted.description.trim() || job.description };
  });
  return {
    ...master,
    headline: reply.headline.trim() || master.headline,
    summary: reply.summary.trim() || master.summary,
    experience,
    education: pick(master.education, reply.education, (item, wanted: AiReply["education"][number]) => same(item.degree, wanted.degree) && same(item.institution, wanted.institution)),
    skills: pick(master.skills, reply.skills, (skill, wanted: string) => same(skill, wanted)),
    languages: pick(master.languages, reply.languages, (language, wanted: AiReply["languages"][number]) => same(language.name, wanted.name)),
  };
}

function systemPrompt(language: DocumentLanguage): string {
  return language === "fr"
    ? `Tu es le coach Jobbbox. Tu adaptes le CV de référence d'un cadre expérimenté à l'offre ci-dessous, en français.
Règles :
- Tu peux seulement reformuler, réordonner, couper et mettre en avant ce que dit son CV de référence. N'ajoute jamais de compétence, d'expérience, de diplôme ou de chiffre.
- Garde l'employeur et la période de chaque poste tels quels.
Réponds uniquement avec un objet JSON : {"headline": "", "summary": "", "experience": [{"employer": "", "period": "", "title": "", "description": ""}], "education": [{"degree": "", "institution": "", "year": ""}], "skills": [""], "languages": [{"name": "", "level": ""}]}.`
    : `You are the Jobbbox coach. You adapt an experienced professional's reference CV to the job offer below, in English.
Rules:
- You may only rephrase, reorder, cut and emphasise what their reference CV says. Never add a skill, experience, degree or figure.
- Keep each job's employer and period as they are.
Reply with a JSON object only: {"headline": "", "summary": "", "experience": [{"employer": "", "period": "", "title": "", "description": ""}], "education": [{"degree": "", "institution": "", "year": ""}], "skills": [""], "languages": [{"name": "", "level": ""}]}.`;
}

/** The JSON object in the AI Coach's reply, or null. */
function replyIn(reply: string): AiReply | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = aiReply.safeParse(JSON.parse(reply.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

interface ProposalRow {
  language: DocumentLanguage;
  masterCvVersion: number;
  content: CvContent;
  proposedAt: string;
}

export function createTailoredCvs(database: Pool, deps: TailoredCvsDeps): TailoredCvs {
  async function stateOf(application: Application): Promise<ApplicationTailoredCv> {
    const [documentLanguage, { rows }] = await Promise.all([
      documentLanguageOf(database, application),
      database.query<{ proposal: ProposalRow | null }>(`SELECT proposal FROM tailored_cv WHERE application_id = $1`, [application.id]),
    ]);
    const proposal = rows[0]?.proposal ?? null;
    return { documentLanguage, proposal: proposal ? { ...proposal, proposedAt: new Date(proposal.proposedAt) } : null, saved: null };
  }

  return {
    async get(candidateId, applicationId) {
      const application = await deps.applications.get(candidateId, applicationId);
      return application ? stateOf(application) : null;
    },

    async propose(candidateId, applicationId, input) {
      const parsed = proposeSchema.safeParse(input ?? {}, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return NOT_FOUND;
      const profile = await deps.profiles.get(candidateId, application.profile.id);
      if (!profile) return NOT_FOUND;
      const language = parsed.data.language ?? (await documentLanguageOf(database, application));
      const { jobOffer } = application;
      const master = profile.masterCv.content;
      const prompt = [
        `${language === "fr" ? "Offre" : "Job offer"} : ${JSON.stringify({ title: jobOffer.title, employer: jobOffer.employer, content: jobOffer.content, skills: jobOffer.skills })}`,
        `${language === "fr" ? "CV de référence" : "Reference CV"} : ${JSON.stringify(master)}`,
      ].join("\n\n");
      let reply: AiReply | null;
      try {
        reply = replyIn((await deps.ai.generate({ task: "writing", candidateId, system: systemPrompt(language), prompt })).text);
      } catch (error) {
        console.warn("[tailored-cv] the AI Coach could not propose a Tailored CV:", error instanceof Error ? error.message : error);
        reply = null;
      }
      if (!reply) return { ok: false, error: "unavailable" };
      if (parsed.data.language) await keepDocumentLanguage(database, application.id, language);
      const proposal: ProposalRow = { language, masterCvVersion: profile.masterCv.version, content: fromMasterCv(master, reply), proposedAt: new Date().toISOString() };
      await database.query(
        `INSERT INTO tailored_cv (application_id, proposal) VALUES ($1, $2) ON CONFLICT (application_id) DO UPDATE SET proposal = $2`,
        [application.id, proposal],
      );
      return { ok: true, tailoredCv: await stateOf(application) };
    },
  };
}

/** Creates or upgrades the Tailored CV table. Run after migrateTailoredDocuments. Safe to run repeatedly. */
export async function migrateTailoredCvs(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS tailored_cv (
      application_id uuid PRIMARY KEY REFERENCES application (id) ON DELETE CASCADE,
      -- The proposal under the Candidate's review, if any.
      proposal jsonb
    );
  `);
}
