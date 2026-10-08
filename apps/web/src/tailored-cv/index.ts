/**
 * Tailored CV of an Application: a copy of the Profile's Master CV adapted to
 * the Job Offer, proposed by the AI Coach, reviewed by the Candidate against the
 * Master CV, then saved on the Application.
 *
 * One deep module in front of Postgres and the AI layer. Callers get
 * `createTailoredCvs(database, { applications, profiles, ai })`:
 *  - `get` the Application's Document Language, the proposal under review and the saved Tailored CV;
 *  - `propose` (or propose again) a Tailored CV: it replaces the proposal under review, never the saved one;
 *  - `answer` the proposal's questions: the Job Offer's requirements the Master CV does not show;
 *  - `save` the proposal once reviewed: it becomes the Application's Tailored CV.
 *
 * Rules kept here (ADR-0006):
 *  - A Tailored CV only rephrases, reorders, cuts and emphasises facts of the
 *    Master CV. Whatever the AI Coach writes, the proposal is rebuilt from the
 *    Master CV: identity and contact details are copied, jobs, diplomas,
 *    languages and skills are kept only if the Master CV has them (each one is
 *    named by its id in the Master CV, so it can be translated into the
 *    Document Language), and a rephrased text stating a figure the Master CV
 *    lacks, or, in the Master CV's own language, a Job Offer keyword it lacks,
 *    is replaced by the Master CV's. A section the AI Coach leaves out or gets
 *    wrong is the Master CV's; a reply with no CV in it is no proposal.
 *  - A requirement the Master CV lacks becomes a question to the Candidate, and
 *    is added to the skills only if they confirm it.
 * Every read and change is scoped to the Candidate; inputs are untrusted and
 * problems come back as results. Task `writing`, EU endpoints only (ADR-0007).
 */
import type { AiLayer } from "@jobhub/ai";
import { DOCUMENT_LANGUAGES, jobOfferLanguage, normalise, scoreMatch, type CvContent, type DocumentLanguage } from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import type { Application, Applications } from "../applications";
import type { Profiles } from "../profiles";
import { documentLanguageOf, keepDocumentLanguage } from "../tailored-documents/document-language";
import { fieldErrors, type FieldError } from "../validation";
import { cvChanges, type CvChange, type CvOrigins } from "./changes";

export { CV_SECTIONS, type CvChange, type CvOrigins, type CvSection } from "./changes";

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
  /** Names this exact proposal, answers included: the Candidate saves the one they reviewed by it. */
  revision: string;
  /** The Master CV Version it was derived from, and reviewed against. */
  masterCvVersion: number;
  /** With the confirmed requirements. */
  content: CvContent;
  questions: TailoredCvQuestion[];
  /** What it changes in the Master CV it was derived from. */
  changes: CvChange[];
  /** Match Scores against the Job Offer, with the Profile's Search Criteria: that Master CV's, and this content's. */
  matchScore: { master: number; tailored: number };
  proposedAt: Date;
}

/** The Tailored CV the Candidate saved on the Application, once reviewed. */
export interface SavedTailoredCv {
  language: DocumentLanguage;
  /** The Master CV Version it was derived from. */
  masterCvVersion: number;
  content: CvContent;
  /** As for the proposal it was. */
  matchScore: { master: number; tailored: number };
  savedAt: Date;
}

export interface ApplicationTailoredCv {
  documentLanguage: DocumentLanguage;
  /** The proposal under review, or null. */
  proposal: TailoredCvProposal | null;
  /** The Tailored CV saved on the Application, or null. A new proposal leaves it until it is saved in turn. */
  saved: SavedTailoredCv | null;
}

export type TailoredCvResult =
  | { ok: true; tailoredCv: ApplicationTailoredCv }
  | { ok: false; errors: FieldError[] }
  /** No such Application for this Candidate. */
  | { ok: false; error: "not_found" }
  /** The AI layer could not write it; nothing was changed. Try again later. */
  | { ok: false; error: "unavailable" }
  /** The Master CV (or the Application's Profile) changed since the proposal: it must be proposed again. */
  | { ok: false; error: "master_cv_changed" }
  /** The proposal was proposed again or answered since the Candidate reviewed it: nothing was saved. */
  | { ok: false; error: "proposal_changed" };

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
  /**
   * The Candidate approves the proposal they reviewed: it becomes the Application's
   * Tailored CV, replacing the one saved before. Unanswered questions add nothing.
   * `input`: { revision } of the proposal they reviewed.
   * "not_found" when there is no proposal; "proposal_changed" when it is no longer
   * that revision; "master_cv_changed" when it was derived from a Master CV
   * Version that is no longer current.
   */
  save(candidateId: string, applicationId: string, input: unknown): Promise<TailoredCvResult>;
}

export interface TailoredCvsDeps {
  applications: Pick<Applications, "get">;
  profiles: Pick<Profiles, "get">;
  ai: AiLayer;
}

const proposeSchema = z.object({ language: z.enum(DOCUMENT_LANGUAGES).optional() });
const answerSchema = z.object({ requirement: z.string().trim().min(1).max(200), confirmed: z.boolean() });
const saveSchema = z.object({ revision: z.string().min(1).max(64) });

/** Most questions asked about one proposal. */
const MAX_QUESTIONS = 8;

const NOT_FOUND = { ok: false, error: "not_found" } as const;

/**
 * What the AI Coach replies: its adaptation of the Master CV. A section it leaves
 * out or gets wrong (any item of the wrong shape) is undefined, and taken from the
 * Master CV as it is. Diplomas, languages and skills carry the id the Master CV's
 * item was given in the prompt (see `referenceCv`).
 */
const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);
const text = z.string().catch("");
const id = z.string().optional().catch(undefined);
const aiReply = z.object({
  headline: optional(z.string()),
  summary: optional(z.string()),
  experience: optional(z.array(z.object({ id, employer: z.string(), period: z.string(), title: text, description: text }))),
  education: optional(z.array(z.object({ id, degree: z.string(), institution: text, year: text }))),
  skills: optional(z.array(z.union([z.string().transform((skill) => ({ id: undefined, text: skill })), z.object({ id, text: z.string() })]))),
  languages: optional(z.array(z.object({ id, name: z.string(), level: text }))),
  /** Requirements of the Job Offer the Master CV does not show. */
  missing: z.array(z.string()).catch([]),
});
type AiReply = z.output<typeof aiReply>;

/** Whether a reply has a CV in it at all: else it is no proposal (an empty or truncated reply). */
const hasCv = (reply: AiReply) => [reply.headline, reply.summary, reply.experience, reply.education, reply.skills, reply.languages].some((section) => section !== undefined);

/** Ids of the Master CV's diplomas, languages and skills in the prompt: e0, l0, s0… */
const ID_PREFIX = { education: "e", languages: "l", skills: "s" } as const;

/** The Master CV as the AI Coach is handed it: each diploma, language and skill with its id. */
function referenceCv(master: CvContent) {
  return {
    ...master,
    education: master.education.map((item, index) => ({ id: `${ID_PREFIX.education}${index}`, ...item })),
    skills: master.skills.map((skill, index) => ({ id: `${ID_PREFIX.skills}${index}`, text: skill })),
    languages: master.languages.map((item, index) => ({ id: `${ID_PREFIX.languages}${index}`, ...item })),
  };
}

/** The language the Master CV is written in, told as for a Job Offer. */
const cvLanguage = (cv: CvContent): DocumentLanguage =>
  jobOfferLanguage({ title: cv.headline, content: [cv.summary, ...cv.experience.flatMap((job) => [job.title, job.description]), ...cv.skills].join(" ") });

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
 * (or translate) the headline, the summary, each job's title and description and
 * each diploma, language and skill, reorder and cut jobs, diplomas, languages and
 * skills, and nothing else. A rephrased text that invents (see `invents`) is
 * replaced by the Master CV's. A Job Offer keyword (`keywords`: its skills) can
 * only be told missing from the Master CV in the Master CV's own language: in
 * another, only figures are checked, and every rephrased item is shown against
 * the Master CV's for the Candidate's review.
 */
function fromMasterCv(master: CvContent, reply: AiReply, keywords: string[], language: DocumentLanguage): { content: CvContent; origins: CvOrigins } {
  const masterText = cvText(master);
  const checked = language === cvLanguage(master) ? keywords : [];
  const rephrased = (proposed: string | undefined, original: string) => (proposed?.trim() && !invents(proposed, masterText, checked) ? proposed.trim() : original);
  /** The Master CV's `items` the AI Coach kept, in its order, adapted; each found by its id (`prefix` and index), else by `matches`. */
  const adapt = <T, W extends { id?: string }>(items: T[], prefix: string, wanted: W[] | undefined, matches: (item: T, wanted: W) => boolean, adapted: (item: T, wanted: W) => T) => {
    if (!wanted) return { kept: items, origins: items.map((_, index) => index) };
    const origins: number[] = [];
    const kept: T[] = [];
    for (const option of wanted) {
      const byId = new RegExp(`^${prefix}(\\d+)$`).exec(option.id?.trim() ?? "");
      let index = byId ? Number(byId[1]) : items.findIndex((item, position) => !origins.includes(position) && matches(item, option));
      if (index >= items.length || origins.includes(index)) index = -1;
      if (index < 0) continue;
      origins.push(index);
      kept.push(adapted(items[index]!, option));
    }
    return { kept, origins };
  };
  // A job is named by its employer and period, which the AI Coach keeps as they are.
  const experience = adapt(
    master.experience,
    "j",
    reply.experience,
    (job, wanted) => same(job.employer, wanted.employer) && same(job.period, wanted.period),
    (job, wanted) => ({ ...job, title: rephrased(wanted.title, job.title), description: rephrased(wanted.description, job.description) }),
  );
  const education = adapt(
    master.education,
    ID_PREFIX.education,
    reply.education,
    (item, wanted) => same(item.degree, wanted.degree) && same(item.institution, wanted.institution),
    (item, wanted) => ({ ...item, degree: rephrased(wanted.degree, item.degree), institution: rephrased(wanted.institution, item.institution) }),
  );
  const skills = adapt(master.skills, ID_PREFIX.skills, reply.skills, (skill, wanted) => same(skill, wanted.text), (skill, wanted) => rephrased(wanted.text, skill));
  const languages = adapt(
    master.languages,
    ID_PREFIX.languages,
    reply.languages,
    (item, wanted) => same(item.name, wanted.name),
    (item, wanted) => ({ ...item, name: rephrased(wanted.name, item.name), level: rephrased(wanted.level, item.level) }),
  );
  return {
    content: {
      ...master,
      headline: rephrased(reply.headline, master.headline),
      summary: rephrased(reply.summary, master.summary),
      experience: experience.kept,
      education: education.kept,
      skills: skills.kept,
      languages: languages.kept,
    },
    origins: { education: education.origins, skills: skills.origins, languages: languages.origins },
  };
}

function systemPrompt(language: DocumentLanguage): string {
  return language === "fr"
    ? `Tu es le coach Jobbbox. Tu adaptes le CV de référence d'un cadre expérimenté à l'offre ci-dessous, en français.
Règles :
- Tu peux seulement reformuler, réordonner, couper et mettre en avant ce que dit son CV de référence. N'ajoute jamais de compétence, d'expérience, de diplôme ou de chiffre.
- Garde l'employeur et la période de chaque poste tels quels, et l'"id" de chaque diplôme, langue et compétence que tu gardes.
- Dans "missing", liste les exigences de l'offre que son CV ne montre pas : le candidat dira s'il les a.
Réponds uniquement avec un objet JSON : {"headline": "", "summary": "", "experience": [{"employer": "", "period": "", "title": "", "description": ""}], "education": [{"id": "", "degree": "", "institution": "", "year": ""}], "skills": [{"id": "", "text": ""}], "languages": [{"id": "", "name": "", "level": ""}], "missing": [""]}.`
    : `You are the Jobbbox coach. You adapt an experienced professional's reference CV to the job offer below, in English.
Rules:
- You may only rephrase, reorder, cut and emphasise what their reference CV says. Never add a skill, experience, degree or figure.
- Keep each job's employer and period as they are, and the "id" of each degree, language and skill you keep.
- In "missing", list the job offer's requirements their CV does not show: the candidate will say whether they have them.
Reply with a JSON object only: {"headline": "", "summary": "", "experience": [{"employer": "", "period": "", "title": "", "description": ""}], "education": [{"id": "", "degree": "", "institution": "", "year": ""}], "skills": [{"id": "", "text": ""}], "languages": [{"id": "", "name": "", "level": ""}], "missing": [""]}.`;
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
  profileId: string;
  masterCvVersion: number;
  /** That version's content, to review the changes against. */
  master: CvContent;
  /** The AI Coach's adaptation, before any confirmed requirement. */
  adapted: CvContent;
  /** Where `adapted`'s diplomas, skills and languages come from in `master`; absent from proposals made before it was kept. */
  origins?: CvOrigins;
  questions: TailoredCvQuestion[];
  proposedAt: string;
}

interface SavedRow {
  language: DocumentLanguage;
  masterCvVersion: number;
  master: CvContent;
  content: CvContent;
  savedAt: string;
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
  async function stateOf(candidateId: string, application: Application): Promise<ApplicationTailoredCv> {
    const [documentLanguage, { rows }, profile] = await Promise.all([
      documentLanguageOf(database, application),
      database.query<{ proposal: ProposalRow | null; revision: string | null; saved: SavedRow | null }>(
        `SELECT proposal, md5(proposal::text) AS revision, saved FROM tailored_cv WHERE application_id = $1`,
        [application.id],
      ),
      deps.profiles.get(candidateId, application.profile.id),
    ]);
    const score = (cv: CvContent) => scoreMatch({ cv, searchCriteria: profile?.searchCriteria, jobOffer: application.jobOffer }).score;
    const row = rows[0]?.proposal ?? null;
    let proposal: TailoredCvProposal | null = null;
    if (row) {
      const content = withConfirmed(row.adapted, row.questions);
      proposal = {
        language: row.language,
        revision: rows[0]!.revision!,
        masterCvVersion: row.masterCvVersion,
        content,
        questions: row.questions,
        changes: cvChanges(row.master, content, row.origins),
        matchScore: { master: score(row.master), tailored: score(content) },
        proposedAt: new Date(row.proposedAt),
      };
    }
    const kept = rows[0]?.saved ?? null;
    const saved: SavedTailoredCv | null = kept
      ? {
          language: kept.language,
          masterCvVersion: kept.masterCvVersion,
          content: kept.content,
          matchScore: { master: score(kept.master), tailored: score(kept.content) },
          savedAt: new Date(kept.savedAt),
        }
      : null;
    return { documentLanguage, proposal, saved };
  }

  return {
    async get(candidateId, applicationId) {
      const application = await deps.applications.get(candidateId, applicationId);
      return application ? stateOf(candidateId, application) : null;
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
        `${language === "fr" ? "CV de référence" : "Reference CV"} : ${JSON.stringify(referenceCv(master))}`,
      ].join("\n\n");
      let reply: AiReply | null;
      try {
        reply = replyIn((await deps.ai.generate({ task: "writing", candidateId, system: systemPrompt(language), prompt })).text);
      } catch (error) {
        console.warn("[tailored-cv] the AI Coach could not propose a Tailored CV:", error instanceof Error ? error.message : error);
        reply = null;
      }
      if (!reply || !hasCv(reply)) return { ok: false, error: "unavailable" };
      if (parsed.data.language) await keepDocumentLanguage(database, application.id, language);
      const { content: adapted, origins } = fromMasterCv(master, reply, jobOffer.skills ?? [], language);
      const proposal: ProposalRow = {
        language,
        profileId: profile.id,
        masterCvVersion: profile.masterCv.version,
        master,
        adapted,
        origins,
        questions: questionsFor(master, application, reply),
        proposedAt: new Date().toISOString(),
      };
      await database.query(
        `INSERT INTO tailored_cv (application_id, proposal) VALUES ($1, $2) ON CONFLICT (application_id) DO UPDATE SET proposal = $2`,
        [application.id, proposal],
      );
      return { ok: true, tailoredCv: await stateOf(candidateId, application) };
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
      return { ok: true, tailoredCv: await stateOf(candidateId, application) };
    },

    async save(candidateId, applicationId, input) {
      const parsed = saveSchema.safeParse(input ?? {}, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return NOT_FOUND;
      const { revision } = parsed.data;
      const { rows } = await database.query<{ proposal: ProposalRow | null; revision: string | null }>(
        `SELECT proposal, md5(proposal::text) AS revision FROM tailored_cv WHERE application_id = $1`,
        [application.id],
      );
      const proposal = rows[0]?.proposal;
      if (!proposal) return NOT_FOUND;
      if (rows[0]!.revision !== revision) return { ok: false, error: "proposal_changed" };
      const profile = await deps.profiles.get(candidateId, application.profile.id);
      if (!profile || profile.id !== proposal.profileId || profile.masterCv.version !== proposal.masterCvVersion) return { ok: false, error: "master_cv_changed" };
      const saved: SavedRow = {
        language: proposal.language,
        masterCvVersion: proposal.masterCvVersion,
        master: proposal.master,
        content: withConfirmed(proposal.adapted, proposal.questions),
        savedAt: new Date().toISOString(),
      };
      // Only the revision the Candidate reviewed: one proposed or answered since, even a moment ago, is not saved unseen.
      const { rowCount } = await database.query(`UPDATE tailored_cv SET saved = $2, proposal = NULL WHERE application_id = $1 AND md5(proposal::text) = $3`, [application.id, saved, revision]);
      if (rowCount === 0) return { ok: false, error: "proposal_changed" };
      return { ok: true, tailoredCv: await stateOf(candidateId, application) };
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
    -- The Tailored CV the Candidate saved, if any.
    ALTER TABLE tailored_cv ADD COLUMN IF NOT EXISTS saved jsonb;
  `);
}
