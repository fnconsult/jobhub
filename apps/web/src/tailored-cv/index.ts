/**
 * Tailored CV of an Application: a copy of the Profile's Master CV adapted to
 * the Job Offer, proposed by the AI Coach, reviewed by the Candidate against the
 * Master CV, then saved on the Application.
 *
 * One deep module in front of Postgres and the AI layer. Callers get
 * `createTailoredCvs(database, { applications, profiles, ai })`:
 *  - `get` the Application's Document Language, the proposal under review and the saved Tailored CV;
 *  - `propose` (or propose again) a Tailored CV: it replaces the proposal under review, never the saved one;
 *  - `answer` the proposal's questions: the Job Offer's requirements the Master CV does not show.
 *
 * Rules kept here (ADR-0006):
 *  - A Tailored CV only rephrases, reorders, cuts and emphasises facts of the
 *    Master CV. Whatever the AI Coach writes, the proposal is rebuilt from the
 *    Master CV: identity and contact details are copied, jobs, diplomas,
 *    languages and skills are kept only if the Master CV has them, and a
 *    rephrased text stating a figure or a Job Offer keyword the Master CV
 *    lacks is replaced by the Master CV's.
 *  - A requirement the Master CV lacks becomes a question to the Candidate, and
 *    is added to the skills only if they confirm it.
 * Every read and change is scoped to the Candidate; inputs are untrusted and
 * problems come back as results. Task `writing`, EU endpoints only (ADR-0007).
 */
import type { AiLayer } from "@jobhub/ai";
import { DOCUMENT_LANGUAGES, normalise, scoreMatch, type CvContent, type DocumentLanguage } from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import type { Application, Applications } from "../applications";
import type { Profiles } from "../profiles";
import { documentLanguageOf, keepDocumentLanguage } from "../tailored-documents/document-language";
import { fieldErrors, type FieldError } from "../validation";

/**
 * A requirement of the Job Offer the Master CV does not show, asked to the
 * Candidate. Once confirmed, it is added to the Tailored CV's skills.
 */
export interface TailoredCvQuestion {
  /** As the Job Offer words it, e.g. "Power BI". */
  requirement: string;
  /** Null until the Candidate answers. */
  answer: "confirmed" | "declined" | null;
}

/** A Tailored CV the AI Coach proposed, under the Candidate's review. */
export interface TailoredCvProposal {
  /** The language it is written in. */
  language: DocumentLanguage;
  /** The Master CV Version it was derived from, and reviewed against. */
  masterCvVersion: number;
  /** With the confirmed requirements. */
  content: CvContent;
  questions: TailoredCvQuestion[];
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
  /**
   * The Candidate's answer to one question of the proposal: `input` { requirement, confirmed }.
   * Can be changed until the proposal is saved. "not_found" also when the proposal asks no such question.
   */
  answer(candidateId: string, applicationId: string, input: unknown): Promise<TailoredCvResult>;
}

export interface TailoredCvsDeps {
  applications: Pick<Applications, "get">;
  profiles: Pick<Profiles, "get">;
  ai: AiLayer;
}

const proposeSchema = z.object({ language: z.enum(DOCUMENT_LANGUAGES).optional() });
const answerSchema = z.object({ requirement: z.string().trim().min(1).max(200), confirmed: z.boolean() });

/** Most questions asked about one proposal. */
const MAX_QUESTIONS = 8;

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
  /** Requirements of the Job Offer the Master CV does not show. */
  missing: z.array(z.string()).catch([]),
});
type AiReply = z.output<typeof aiReply>;

const same = (a: string, b: string) => normalise(a) === normalise(b);

/** Every text of a CV, normalised, as one string. */
function cvText(cv: CvContent): string {
  return normalise(
    [cv.headline, cv.summary, ...cv.skills, ...cv.experience.flatMap((job) => Object.values(job)), ...cv.education.flatMap((item) => Object.values(item)), ...cv.languages.flatMap((item) => Object.values(item))].join(" | "),
  );
}

const numbersIn = (text: string) => normalise(text).match(/\d+/g) ?? [];

/**
 * Whether a rephrased text states what the Master CV does not: a figure, or one
 * of the Job Offer's keywords (the usual way to push a Match Score up).
 */
function invents(rephrased: string, masterText: string, keywords: string[]): boolean {
  const said = normalise(rephrased);
  if (numbersIn(rephrased).some((number) => !masterText.includes(` ${number} `))) return true;
  return keywords.some((keyword) => said.includes(normalise(keyword)) && !masterText.includes(normalise(keyword)));
}

/**
 * The proposal rebuilt from the Master CV (ADR-0006): the AI Coach may rephrase
 * the headline, the summary and each job's title and description, reorder and
 * cut jobs, diplomas, languages and skills, and nothing else. A rephrased text
 * that invents (see `invents`) is replaced by the Master CV's. `keywords`: the Job Offer's skills.
 */
function fromMasterCv(master: CvContent, reply: AiReply, keywords: string[]): CvContent {
  const masterText = cvText(master);
  const rephrased = (proposed: string, original: string) => (proposed.trim() && !invents(proposed, masterText, keywords) ? proposed.trim() : original);
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
    return { ...job, title: rephrased(wanted.title, job.title), description: rephrased(wanted.description, job.description) };
  });
  return {
    ...master,
    headline: rephrased(reply.headline, master.headline),
    summary: rephrased(reply.summary, master.summary),
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
- Dans "missing", liste les exigences de l'offre que son CV ne montre pas : le candidat dira s'il les a.
Réponds uniquement avec un objet JSON : {"headline": "", "summary": "", "experience": [{"employer": "", "period": "", "title": "", "description": ""}], "education": [{"degree": "", "institution": "", "year": ""}], "skills": [""], "languages": [{"name": "", "level": ""}], "missing": [""]}.`
    : `You are the Jobbbox coach. You adapt an experienced professional's reference CV to the job offer below, in English.
Rules:
- You may only rephrase, reorder, cut and emphasise what their reference CV says. Never add a skill, experience, degree or figure.
- Keep each job's employer and period as they are.
- In "missing", list the job offer's requirements their CV does not show: the candidate will say whether they have them.
Reply with a JSON object only: {"headline": "", "summary": "", "experience": [{"employer": "", "period": "", "title": "", "description": ""}], "education": [{"degree": "", "institution": "", "year": ""}], "skills": [""], "languages": [{"name": "", "level": ""}], "missing": [""]}.`;
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
  /** The AI Coach's adaptation, before any confirmed requirement. */
  adapted: CvContent;
  questions: TailoredCvQuestion[];
  proposedAt: string;
}

/** The Job Offer's requirements the Master CV does not show: its skills, then what the AI Coach found in its text. */
function questionsFor(master: CvContent, application: Application, reply: AiReply): TailoredCvQuestion[] {
  const masterText = cvText(master);
  const offerSkills = scoreMatch({ cv: master, jobOffer: application.jobOffer }).breakdown.skills.missing;
  const requirements: string[] = [];
  for (const requirement of [...offerSkills, ...reply.missing].map((item) => item.trim())) {
    if (!requirement || requirement.length > 200 || masterText.includes(normalise(requirement))) continue;
    if (requirements.some((asked) => same(asked, requirement))) continue;
    requirements.push(requirement);
  }
  return requirements.slice(0, MAX_QUESTIONS).map((requirement) => ({ requirement, answer: null }));
}

/** The proposal's content: the adaptation plus the requirements the Candidate confirmed. */
function withConfirmed(adapted: CvContent, questions: TailoredCvQuestion[]): CvContent {
  const confirmed = questions.filter((question) => question.answer === "confirmed").map((question) => question.requirement);
  return { ...adapted, skills: [...adapted.skills, ...confirmed.filter((skill) => !adapted.skills.some((kept) => same(kept, skill)))] };
}

export function createTailoredCvs(database: Pool, deps: TailoredCvsDeps): TailoredCvs {
  async function stateOf(application: Application): Promise<ApplicationTailoredCv> {
    const [documentLanguage, { rows }] = await Promise.all([
      documentLanguageOf(database, application),
      database.query<{ proposal: ProposalRow | null }>(`SELECT proposal FROM tailored_cv WHERE application_id = $1`, [application.id]),
    ]);
    const row = rows[0]?.proposal ?? null;
    const proposal: TailoredCvProposal | null = row
      ? { language: row.language, masterCvVersion: row.masterCvVersion, content: withConfirmed(row.adapted, row.questions), questions: row.questions, proposedAt: new Date(row.proposedAt) }
      : null;
    return { documentLanguage, proposal, saved: null };
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
      const proposal: ProposalRow = {
        language,
        masterCvVersion: profile.masterCv.version,
        adapted: fromMasterCv(master, reply, jobOffer.skills ?? []),
        questions: questionsFor(master, application, reply),
        proposedAt: new Date().toISOString(),
      };
      await database.query(
        `INSERT INTO tailored_cv (application_id, proposal) VALUES ($1, $2) ON CONFLICT (application_id) DO UPDATE SET proposal = $2`,
        [application.id, proposal],
      );
      return { ok: true, tailoredCv: await stateOf(application) };
    },

    async answer(candidateId, applicationId, input) {
      const parsed = answerSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return NOT_FOUND;
      const { requirement, confirmed } = parsed.data;
      // In one statement, so two answers given at once both count.
      const { rowCount } = await database.query(
        `UPDATE tailored_cv SET proposal = jsonb_set(proposal, '{questions}', (
           SELECT jsonb_agg(CASE WHEN question->>'requirement' = $2 THEN jsonb_set(question, '{answer}', to_jsonb($3::text)) ELSE question END ORDER BY position)
           FROM jsonb_array_elements(proposal->'questions') WITH ORDINALITY AS asked (question, position)))
         WHERE application_id = $1 AND proposal->'questions' @> jsonb_build_array(jsonb_build_object('requirement', $2::text))`,
        [application.id, requirement, confirmed ? "confirmed" : "declined"],
      );
      if (rowCount === 0) return NOT_FOUND;
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
