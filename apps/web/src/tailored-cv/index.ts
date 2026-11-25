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
 *  - `save` the proposal once reviewed, with only the changes the Candidate accepted: it becomes the Application's Tailored CV;
 *  - `revisable`, `reviseSaved`, `reviseProposal`, `answerAll`: what a change the AI Coach proposes from the Coach
 *    Conversation applies to, once the Candidate accepted it change by change on its card (ADR-0113, #1097): the saved
 *    Tailored CV, saved as its next version with the card as its Origin; or the proposal under review, reworked with its
 *    answers kept, never proposed again; or its answers, filled at once. Each from the version or revision seen.
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
 *    wrong is the Master CV's; a reply with no CV in it is no proposal, and
 *    is asked for once more before the AI Coach is told unavailable.
 *  - A rephrasing that brings in words of the Job Offer's title or text the
 *    Master CV does not say is kept, but flagged in the review for the Candidate
 *    to check (#68). In another Document Language, those words are found through
 *    an AI translation into the Master CV's language, and the Candidate is told so.
 *  - A requirement the Master CV lacks becomes a question to the Candidate, and
 *    is added to the skills only if they confirm it.
 *  - Each change is accepted or rejected by the Candidate: only the accepted ones
 *    are saved, every other keeps the Master CV's (#161). Which ones are accepted
 *    comes with the save, never guessed: a change flagged as taken from the Job
 *    Offer is saved only once the Candidate accepts it.
 *  - A Tailored CV saved from a Coach proposal's card keeps the card as its Origin (« Origine »); saved again from a
 *    proposal, or restored, it keeps none. A Declared Fact a Coach change brought into the proposal is marked in its review.
 * Every read and change is scoped to the Candidate; inputs are untrusted and
 * problems come back as results. Task `writing`, EU endpoints only (ADR-0007).
 * The AI Coach's instructions and the AI writing the proposal are the "tailored-cv" task
 * Playbook's (ADR-0026); the reply's shape stays here.
 */
import { createProvenanceRecorder, type AiLayer } from "@jobhub/ai";
import {
  DOCUMENT_LANGUAGES,
  jobOfferLanguage,
  normalise,
  periodIn,
  readProvenance,
  scoreMatch,
  textLanguage,
  withoutIdentity,
  type CvContent,
  type DocumentLanguage,
  type FailureReason,
  type Provenance,
  type ProvenanceEvent,
} from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import type { Application, Applications } from "../applications";
import { countUse, migrateConsumption } from "../consumption";
import { inTransaction } from "../database/pool";
import type { Profiles } from "../profiles";
import { routes } from "../routes";
import { taskRun, type TaskPlaybookReader, type TaskRun } from "../task-playbooks";
import { documentLanguageOf, keepDocumentLanguage } from "../tailored-documents/document-language";
import { keepVersion, latestVersion, migrateTailoredDocumentVersions } from "../tailored-documents/versions";
import { textsNotIn } from "./language";
import { fieldErrors, type FieldError } from "../validation";
import { cvChanges, flagOfferWording, markDeclared, stemOf, withChanges, wordsOf, type CvChange, type CvOrigins } from "./changes";
import { askForTailoredCv, type AiReply } from "./reply";
import { readOrigin, type Origin } from "../origin";

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
  /** What it changes in the Master CV it was derived from, each rephrasing with the Job Offer's words it adds. */
  changes: CvChange[];
  /** Whether the Job Offer's words were checked against the Master CV through a translation (another Document Language, #68). */
  offerWordingTranslated: boolean;
  /** Match Scores against the Job Offer, with the Profile's Search Criteria: that Master CV's, and this content's. */
  matchScore: { master: number; tailored: number };
  proposedAt: Date;
  /** What served it (ADR-0034, #334): the models, their tokens and time, the pages it drew on; null for one proposed before it was kept. */
  provenance: Provenance | null;
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
  /** The proposal's, copied when it was saved (#334); null for one saved before it was kept. */
  provenance: Provenance | null;
  /** The Coach proposal's card it was saved from (ADR-0113), behind « Origine »; null when the Candidate saved it from a proposal (absent: none). */
  origin?: Origin | null;
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
  /** The AI layer could not write it; nothing was changed. Try again later. `reason`: its Failure Reason (#367). */
  | { ok: false; error: "unavailable"; reason?: FailureReason }
  /** The Master CV (or the Application's Profile) changed since the proposal: it must be proposed again. */
  | { ok: false; error: "master_cv_changed" }
  /** The proposal was proposed again or answered since the Candidate reviewed it: nothing was saved. */
  | { ok: false; error: "proposal_changed" }
  /** The Candidate stopped the proposal (#334): the half-written one is discarded, nothing was changed. */
  | { ok: false; error: "stopped" };

/**
 * How a proposal runs (#334): `signal`, the Candidate's Stop, aborts its AI calls; `onEvent` hears each step start and end,
 * as AI Activity shows them live.
 */
export interface ProposeOptions {
  signal?: AbortSignal;
  onEvent?: (event: ProvenanceEvent) => void;
}

/** What a change the AI Coach proposes from the conversation applies to (ADR-0113): the saved Tailored CV, the proposal under review. */
export interface RevisableTailoredCv {
  /** The saved Tailored CV, its current version (Tailored Document Versions) and the Master CV it was derived from. */
  saved: { content: CvContent; language: DocumentLanguage; version: number; master: CvContent } | null;
  /**
   * The proposal under review: its revision, the AI Coach's adaptation (before any confirmed requirement), where its
   * items come from in the Master CV it was derived from (null for a proposal made before it was kept), that Master
   * CV, its questions and its Declared Facts.
   */
  proposal: {
    revision: string;
    language: DocumentLanguage;
    adapted: CvContent;
    origins: CvOrigins | null;
    master: CvContent;
    questions: TailoredCvQuestion[];
    declared: string[];
  } | null;
}

/** A proposal's adaptation, as `reviseProposal` puts it in place and gives it back. */
export interface ProposalAdaptation {
  adapted: CvContent;
  origins: CvOrigins | null;
  declared: string[];
}

export type ReviseResult<T> = ({ ok: true } & T) | { ok: false; error: "not_found" | "conflict" };

export interface TailoredCvs {
  /** The Application's Tailored CV, or null if it does not exist or belongs to someone else. */
  get(candidateId: string, applicationId: string): Promise<ApplicationTailoredCv | null>;
  /**
   * Has the AI Coach propose a Tailored CV, replacing the proposal under review. `input`: { language? }.
   * Kept with its Provenance. Once `options.signal` aborts, "stopped": nothing is kept, the proposal under review stays.
   */
  propose(candidateId: string, applicationId: string, input: unknown, options?: ProposeOptions): Promise<TailoredCvResult>;
  /**
   * The Candidate's answer to one question of the proposal: `input` { requirement, confirmed }.
   * Can be changed until the proposal is saved. "not_found" also when the proposal asks no such question.
   */
  answer(candidateId: string, applicationId: string, input: unknown): Promise<TailoredCvResult>;
  /**
   * The Candidate approves the proposal they reviewed: it becomes the Application's
   * Tailored CV, replacing the one saved before. Unanswered questions add nothing.
   * `input`: { revision, accepted } — the revision of the proposal they reviewed, and
   * the ids of the changes they accepted (`CvChange.id`): every other change keeps the
   * Master CV's, and an id naming no change of that proposal is ignored.
   * "not_found" when there is no proposal; "proposal_changed" when it is no longer
   * that revision; "master_cv_changed" when it was derived from a Master CV
   * Version that is no longer current.
   */
  save(candidateId: string, applicationId: string, input: unknown): Promise<TailoredCvResult>;
  /** What a Coach change applies to; null when the Application does not exist or is someone else's. */
  revisable(candidateId: string, applicationId: string): Promise<RevisableTailoredCv | null>;
  /**
   * Saves `content` as the Tailored CV's next version, from the version seen (`version`; changed since: a conflict), the
   * card kept as its Origin. Gives back the version made and the one before, which « Annuler » restores.
   */
  reviseSaved(candidateId: string, applicationId: string, revision: { version: number; content: CvContent }, options: { origin: Origin }): Promise<ReviseResult<{ version: number; before: number }>>;
  /**
   * Puts `adapted` in place of the proposal's adaptation, its questions and answers kept, from the revision seen
   * (answered, proposed again or saved since: a conflict). Gives back the proposal's revision now and the adaptation before.
   */
  reviseProposal(candidateId: string, applicationId: string, revision: { revision: string } & ProposalAdaptation): Promise<ReviseResult<{ revision: string; before: ProposalAdaptation }>>;
  /**
   * Sets the answers of the proposal's questions at once, from the revision seen; `null` unanswers one. "not_found" when
   * it asks no such question. Gives back the revision now and the answers before, which « Annuler » puts back.
   */
  answerAll(
    candidateId: string,
    applicationId: string,
    input: { revision: string; answers: TailoredCvQuestion[] },
  ): Promise<ReviseResult<{ revision: string; before: TailoredCvQuestion[] }>>;
}

export interface TailoredCvsDeps {
  applications: Pick<Applications, "get">;
  profiles: Pick<Profiles, "get">;
  ai: AiLayer;
  /** The "tailored-cv" task Playbook's served version (ADR-0026); without it, its built-in text. */
  taskPlaybooks?: TaskPlaybookReader;
}

const proposeSchema = z.object({ language: z.enum(DOCUMENT_LANGUAGES).optional() });
const answerSchema = z.object({ requirement: z.string().trim().min(1).max(200), confirmed: z.boolean() });
const saveSchema = z.object({ revision: z.string().min(1).max(64), accepted: z.array(z.string().max(500)).max(500) });

/** Most questions asked about one proposal. */
const MAX_QUESTIONS = 8;

const NOT_FOUND = { ok: false, error: "not_found" } as const;

/** Ids of the Master CV's jobs, diplomas, languages and skills in the prompt: j0, e0, l0, s0… */
const ID_PREFIX = { experience: "j", education: "e", languages: "l", skills: "s" } as const;

/**
 * The Master CV as the AI Coach is handed it: each job, diploma, language and skill with its id. A job is
 * found again by its id, not by its period as written, which a translation changes.
 */
function referenceCv(master: CvContent) {
  return {
    ...master,
    experience: master.experience.map((job, index) => ({ id: `${ID_PREFIX.experience}${index}`, ...job })),
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
 * A job's period in `language`: the AI Coach's when it is in that language with the Master CV's figures (its
 * years, in their order), else the Master CV's with its month names and words translated (`periodIn`).
 */
function periodOf(proposed: string | undefined, original: string, language: DocumentLanguage): string {
  const said = proposed?.trim();
  if (said && numbersIn(said).join(" ") === numbersIn(original).join(" ") && (textLanguage(said) ?? language) === language) return said;
  return periodIn(original, language);
}

/**
 * Whether a rephrased text states what the Master CV does not: a figure, or one
 * of the Job Offer's keywords (the usual way to push a Match Score up).
 */
function invents(rephrased: string, masterText: string, keywords: string[]): boolean {
  const said = normalise(rephrased);
  // The Master CV's figures read as the rephrasing's are: « +25 % », « 500k€ », « B2B2X » or « 1er » state 25, 500, 2 and 1,
  // which a translation writes « +25% », « €500k », « B2B2X » or « 1st » (#1077).
  const figures = new Set(numbersIn(masterText));
  if (numbersIn(rephrased).some((number) => !figures.has(number))) return true;
  return keywords.some((keyword) => said.includes(normalise(keyword)) && !masterText.includes(normalise(keyword)));
}

/**
 * The proposal rebuilt from the Master CV (ADR-0006): the AI Coach may rephrase
 * (or translate) the headline, the summary, each job's title and description and
 * each diploma, language and skill, translate each job's period and place, reorder
 * and cut jobs, diplomas, languages and skills, and nothing else. A job's period
 * keeps the Master CV's years (`periodOf`). A rephrased text that invents (see `invents`) is
 * replaced by the Master CV's. A Job Offer keyword (`keywords`: its skills) can
 * only be told missing from the Master CV in the Master CV's own language: in
 * another, only figures are checked, and every rephrased item is shown against
 * the Master CV's for the Candidate's review.
 */
function fromMasterCv(master: CvContent, reply: AiReply, keywords: string[], language: DocumentLanguage): { content: CvContent; origins: CvOrigins; untranslated: string[] } {
  const masterText = cvText(master);
  const translating = language !== cvLanguage(master);
  const checked = translating ? [] : keywords;
  const rephrased = (proposed: string | undefined, original: string) => (proposed?.trim() && !invents(proposed, masterText, checked) ? proposed.trim() : original);
  /**
   * The Master CV's texts kept as it writes them although the CV is asked in another language (#1133): a section the AI
   * Coach left out or wrote in another shape, taken as it is, or items it named by no id the Master CV has, left out.
   * Too short to tell their language (« Gestion d'équipe », « Recrutement »), `textsNotIn` would not find them.
   */
  const untranslated: string[] = [];
  /**
   * The Master CV's `items` the AI Coach kept, in its order, adapted; each found by its id (`prefix` and index), else by
   * `matches`. `texts`: what of an item is written, for `untranslated`.
   */
  const adapt = <T, W extends { id?: string }>(
    items: T[],
    prefix: string,
    wanted: W[] | undefined,
    matches: (item: T, wanted: W) => boolean,
    adapted: (item: T, wanted: W) => T,
    texts: (item: T) => string[],
  ) => {
    if (!wanted) {
      if (translating) untranslated.push(...items.flatMap(texts));
      return { kept: items, origins: items.map((_, index) => index) };
    }
    const origins: number[] = [];
    const kept: T[] = [];
    let unknown = 0;
    for (const option of wanted) {
      const byId = new RegExp(`^${prefix}(\\d+)$`).exec(option.id?.trim() ?? "");
      let index = byId ? Number(byId[1]) : items.findIndex((item, position) => !origins.includes(position) && matches(item, option));
      if (index >= items.length || origins.includes(index)) index = -1;
      if (index < 0) {
        unknown += 1;
        continue;
      }
      origins.push(index);
      kept.push(adapted(items[index]!, option));
    }
    // Translated without its id, an item is found nowhere: the Master CV's it translates is asked for again, not cut unseen.
    if (translating && unknown > 0) untranslated.push(...items.filter((_, index) => !origins.includes(index)).flatMap(texts));
    return { kept, origins };
  };
  // A job is found by its id, else by its employer and the years of its period, which a translation keeps.
  const experience = adapt(
    master.experience,
    ID_PREFIX.experience,
    reply.experience,
    (job, wanted) => same(job.employer, wanted.employer) && numbersIn(job.period).join(" ") === numbersIn(wanted.period).join(" "),
    (job, wanted) => ({
      ...job,
      title: rephrased(wanted.title, job.title),
      period: periodOf(wanted.period, job.period, language),
      ...(wanted.location !== undefined ? { location: rephrased(wanted.location, job.location) } : {}),
      description: rephrased(wanted.description, job.description),
    }),
    (job) => [job.title],
  );
  const education = adapt(
    master.education,
    ID_PREFIX.education,
    reply.education,
    (item, wanted) => same(item.degree, wanted.degree) && same(item.institution, wanted.institution),
    (item, wanted) => ({ ...item, degree: rephrased(wanted.degree, item.degree), institution: rephrased(wanted.institution, item.institution) }),
    (item) => [item.degree],
  );
  const skills = adapt(
    master.skills,
    ID_PREFIX.skills,
    reply.skills,
    (skill, wanted) => same(skill, wanted.text),
    (skill, wanted) => rephrased(wanted.text, skill),
    (skill) => [skill],
  );
  const languages = adapt(
    master.languages,
    ID_PREFIX.languages,
    reply.languages,
    (item, wanted) => same(item.name, wanted.name),
    (item, wanted) => ({ ...item, name: rephrased(wanted.name, item.name), level: rephrased(wanted.level, item.level) }),
    (item) => [item.name, item.level].filter(Boolean),
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
    origins: { experience: experience.origins, education: education.origins, skills: skills.origins, languages: languages.origins },
    untranslated,
  };
}

/**
 * The Document Language, in each Document Language, after the task Playbook's instructions, which stays in code: the
 * whole CV is written in it, whatever the Master CV's language, and translating is no adding (ADR-0006). A served
 * Playbook saying to keep a job's period « as it is » does not keep it in another language.
 */
const LANGUAGE: Record<DocumentLanguage, string> = {
  fr: `- Écris tout le CV en français : traduis chaque texte de son CV de référence écrit dans une autre langue (titre, résumé, intitulé, période, lieu et description de chaque poste, diplômes, compétences, langues et niveaux). Traduire n'est pas ajouter : ne change aucun fait ni aucun chiffre. Garde tels quels les noms propres (employeurs, écoles, produits) et l'"id" de chaque poste, diplôme, langue et compétence que tu gardes.`,
  en: `- Write every text of the CV in English: translate each text of their reference CV written in another language (headline, summary, each job's title, period, place and description, degrees, skills, languages and levels). Translating is not adding: change no fact and no figure. Keep proper nouns (employers, schools, products) as they are, and the "id" of each job, degree, language and skill you keep.`,
};

/** Told when a proposal is left partly in another language than the Document Language: the passages to write again. */
const NOT_IN: Record<DocumentLanguage, (passages: string[]) => string> = {
  fr: (passages) =>
    `Ta proposition précédente n'était pas entièrement en français. Propose de nouveau tout le CV en français, en traduisant aussi ces passages, sans rien changer aux faits ni aux chiffres, chaque poste, diplôme, langue et compétence avec son "id" :\n${passages.map((passage) => `« ${passage} »`).join("\n")}`,
  en: (passages) =>
    `Your previous proposal was not wholly in English. Propose the whole CV again in English, translating these passages too, changing no fact and no figure, each job, degree, language and skill with its "id":\n${passages.map((passage) => `"${passage}"`).join("\n")}`,
};

/** The reply's shape (`replyIn`), in each Document Language, after the task Playbook's instructions. */
const SHAPE: Record<DocumentLanguage, string> = {
  fr: `Réponds uniquement avec un objet JSON : {"headline": "", "summary": "", "experience": [{"id": "", "employer": "", "period": "", "location": "", "title": "", "description": ""}], "education": [{"id": "", "degree": "", "institution": "", "year": ""}], "skills": [{"id": "", "text": ""}], "languages": [{"id": "", "name": "", "level": ""}], "missing": [""]}.`,
  en: `Reply with a JSON object only: {"headline": "", "summary": "", "experience": [{"id": "", "employer": "", "period": "", "location": "", "title": "", "description": ""}], "education": [{"id": "", "degree": "", "institution": "", "year": ""}], "skills": [{"id": "", "text": ""}], "languages": [{"id": "", "name": "", "level": ""}], "missing": [""]}.`,
};

/** The instructions: the "tailored-cv" task Playbook's section for `language`, the Document Language, then the reply's shape. */
const systemPrompt = (run: TaskRun, language: DocumentLanguage): string => `${run.text(language)}\n${LANGUAGE[language]}\n${SHAPE[language]}`;

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
  /** Stems of the Job Offer's words the Master CV does not say (#68); absent from proposals made before it was kept. */
  offerWording?: string[];
  offerWordingTranslated?: boolean;
  proposedAt: string;
  /** Absent from proposals made before it was kept. */
  provenance?: unknown;
  /** The Declared Facts a Coach change brought into it (ADR-0113), marked in its review; absent when none. */
  declared?: string[];
}

interface SavedRow {
  language: DocumentLanguage;
  masterCvVersion: number;
  master: CvContent;
  content: CvContent;
  savedAt: string;
  /** The proposal's; absent from Tailored CVs saved before it was kept. */
  provenance?: unknown;
  /** The Coach proposal's card it was saved from (ADR-0113); absent when none. */
  origin?: unknown;
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

/** Most of the Job Offer's words sent for translation. */
const MAX_TRANSLATED_WORDS = 80;

/**
 * The stems of the Job Offer's words (its title and text) that the Master CV does not say, which a
 * rephrasing may only bring in for the Candidate to check (ADR-0006, #68). In another Document
 * Language than the Master CV's, the offer's words the adaptation uses are translated into the Master
 * CV's language by the AI Coach first, and kept when no word of their translation is in the Master CV;
 * when no translation comes, they all are.
 */
async function offerWording(ai: AiLayer, candidateId: string, master: CvContent, adapted: CvContent, application: Application, language: DocumentLanguage) {
  const masterStems = new Set(wordsOf(cvText(master)).map(stemOf));
  const offerWords = wordsOf(`${application.jobOffer.title} ${application.jobOffer.content}`);
  const masterLanguage = cvLanguage(master);
  if (language === masterLanguage) {
    return { offerWording: [...new Set(offerWords.map(stemOf))].filter((stem) => !masterStems.has(stem)), offerWordingTranslated: false };
  }
  const adaptedStems = new Set(wordsOf(cvText(adapted)).map(stemOf));
  const used = offerWords.filter((word) => adaptedStems.has(stemOf(word))).slice(0, MAX_TRANSLATED_WORDS);
  const translations = used.length ? await translateWords(ai, candidateId, used, masterLanguage) : {};
  // A word whose translation, any of its usual ones, the Master CV says is no word taken from the Job Offer: « manager » is « responsable » (#1077).
  const inMaster = (word: string) => {
    const translation = translations[word];
    const options = Array.isArray(translation) ? translation : [translation];
    return options.some((option) => typeof option === "string" && wordsOf(option).some((translated) => masterStems.has(stemOf(translated))));
  };
  return { offerWording: [...new Set(used.filter((word) => !inMaster(word)).map(stemOf))], offerWordingTranslated: true };
}

/** `words` translated into `language` by the AI Coach, word by word, each with its usual translations; {} when it gives no usable reply. */
async function translateWords(ai: AiLayer, candidateId: string, words: string[], language: DocumentLanguage): Promise<Record<string, unknown>> {
  const into = language === "fr" ? "French" : "English";
  try {
    const { text } = await ai.generate({
      task: "writing",
      candidateId,
      system: `Translate each word of the list into ${into}, as used in a job offer or a CV. Reply with a JSON object only, each word of the list as a key and, as the value, a list of its usual translations, up to 3 (for "manager": ["responsable", "manager", "gestionnaire"]).`,
      prompt: JSON.stringify(words),
    });
    const json: unknown = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  } catch (error) {
    console.warn("[tailored-cv] the Job Offer's words could not be translated:", error instanceof Error ? error.message : error);
    return {};
  }
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
        changes: markDeclared(flagOfferWording(cvChanges(row.master, content, row.origins), row.offerWording ?? []), row.declared ?? []),
        offerWordingTranslated: row.offerWordingTranslated ?? false,
        matchScore: { master: score(row.master), tailored: score(content) },
        proposedAt: new Date(row.proposedAt),
        provenance: readProvenance(row.provenance),
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
          provenance: readProvenance(kept.provenance),
          origin: readOrigin(kept.origin),
        }
      : null;
    return { documentLanguage, proposal, saved };
  }

  return {
    async get(candidateId, applicationId) {
      const application = await deps.applications.get(candidateId, applicationId);
      return application ? stateOf(candidateId, application) : null;
    },

    async propose(candidateId, applicationId, input, options = {}) {
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
        // Adapting needs the career, not the person: the identity block stays out of the prompt (ADR-0007).
        `${language === "fr" ? "CV de référence" : "Reference CV"} : ${JSON.stringify(referenceCv(withoutIdentity(master)))}`,
      ].join("\n\n");
      const { signal, onEvent } = options;
      const recorder = createProvenanceRecorder(deps.ai, { ...(signal ? { signal } : {}), ...(onEvent ? { onEvent } : {}) });
      // The pages it draws on: the Job Offer's and the Master CV.
      if (jobOffer.source.url) recorder.site(jobOffer.source.url);
      recorder.site(routes.editMasterCv(profile.id));
      const stopped = { ok: false, error: "stopped" } as const;
      const run = await taskRun(deps.taskPlaybooks, "tailored-cv", deps.ai);
      const asked = await askForTailoredCv(recorder.ai, { task: "writing", candidateId, system: systemPrompt(run, language), prompt, ...run.agent });
      if (signal?.aborted) return stopped;
      if (!asked.ok) return { ok: false, error: "unavailable", reason: asked.reason };
      let { reply } = asked;
      const built = fromMasterCv(master, reply, jobOffer.skills ?? [], language);
      let { content: adapted, origins } = built;
      // Left partly in another language (a description or bullet kept as the Master CV writes it, a section taken as it is,
      // a skill translated without its id): asked for once more, those passages named; the second proposal is kept when
      // it leaves fewer (#1077, #1133).
      const notInOf = (proposed: ReturnType<typeof fromMasterCv>) => [...new Set([...textsNotIn(proposed.content, language), ...proposed.untranslated])];
      const notIn = notInOf(built);
      if (notIn.length > 0) {
        const again = await askForTailoredCv(recorder.ai, { task: "writing", candidateId, system: systemPrompt(run, language), prompt: `${prompt}\n\n${NOT_IN[language](notIn)}`, ...run.agent });
        if (signal?.aborted) return stopped;
        if (again.ok) {
          const rebuilt = fromMasterCv(master, again.reply, jobOffer.skills ?? [], language);
          if (notInOf(rebuilt).length < notIn.length) ({ reply, content: adapted, origins } = { reply: again.reply, content: rebuilt.content, origins: rebuilt.origins });
        }
      }
      const proposal: ProposalRow = {
        language,
        profileId: profile.id,
        masterCvVersion: profile.masterCv.version,
        master,
        adapted,
        origins,
        questions: questionsFor(master, application, reply),
        ...(await offerWording(recorder.aiFor("tailored_cv_translation"), candidateId, master, adapted, application, language)),
        proposedAt: new Date().toISOString(),
      };
      // A Stop discards the half-written proposal (#334), even once it is written: its words were not all checked.
      if (signal?.aborted) return stopped;
      proposal.provenance = recorder.provenance();
      if (parsed.data.language) await keepDocumentLanguage(database, application.id, language);
      // The proposal and its Provenance saved: one Tailored CV in Consumption (#799), in the same transaction.
      await inTransaction(database, async (client) => {
        await client.query(
          `INSERT INTO tailored_cv (application_id, proposal) VALUES ($1, $2) ON CONFLICT (application_id) DO UPDATE SET proposal = $2`,
          [application.id, proposal],
        );
        await countUse(client, candidateId, "tailoredCv", new Date(proposal.proposedAt));
      });
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
      const { revision, accepted } = parsed.data;
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
        content: withChanges(proposal.master, withConfirmed(proposal.adapted, proposal.questions), accepted, proposal.origins),
        savedAt: new Date().toISOString(),
        ...(proposal.provenance !== undefined ? { provenance: proposal.provenance } : {}),
      };
      // Only the revision the Candidate reviewed: one proposed or answered since, even a moment ago, is not saved unseen.
      const rowCount = await inTransaction(database, async (client) => {
        const written = await client.query(`UPDATE tailored_cv SET saved = $2, proposal = NULL WHERE application_id = $1 AND md5(proposal::text) = $3`, [application.id, saved, revision]);
        // The Tailored CV saved before stays in « Versions » (#1079): this one is its next version.
        if (written.rowCount) await keepVersion(client, application.id, "tailored_cv", { source: "drafted" });
        return written.rowCount;
      });
      if (!rowCount) return { ok: false, error: "proposal_changed" };
      return { ok: true, tailoredCv: await stateOf(candidateId, application) };
    },

    async revisable(candidateId, applicationId) {
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return null;
      const { rows } = await database.query<{ proposal: ProposalRow | null; revision: string | null; saved: SavedRow | null; version: number | null }>(
        `SELECT proposal, md5(proposal::text) AS revision, saved,
                (SELECT max(version) FROM tailored_document_version v WHERE v.application_id = t.application_id AND v.document = 'tailored_cv') AS version
         FROM tailored_cv t WHERE application_id = $1`,
        [application.id],
      );
      const row = rows[0];
      const saved = row?.saved ? { content: row.saved.content, language: row.saved.language, version: row.version ?? 0, master: row.saved.master } : null;
      const kept = row?.proposal;
      const proposal = kept
        ? { revision: row.revision!, language: kept.language, adapted: kept.adapted, origins: kept.origins ?? null, master: kept.master, questions: kept.questions, declared: kept.declared ?? [] }
        : null;
      return { saved, proposal };
    },

    async reviseSaved(candidateId, applicationId, { version, content }, { origin }) {
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return NOT_FOUND;
      return inTransaction(database, async (client) => {
        const { rows } = await client.query<{ saved: SavedRow }>(`SELECT saved FROM tailored_cv WHERE application_id = $1 AND saved IS NOT NULL FOR UPDATE`, [application.id]);
        const saved = rows[0]?.saved;
        if (!saved) return NOT_FOUND;
        const before = await latestVersion(client, application.id, "tailored_cv");
        if (before !== version) return { ok: false, error: "conflict" } as const;
        const next: SavedRow = { ...saved, content, savedAt: new Date().toISOString(), origin: { ...origin, appliedAt: origin.appliedAt.toISOString() } };
        await client.query(`UPDATE tailored_cv SET saved = $2 WHERE application_id = $1`, [application.id, next]);
        // The Tailored CV before stays in « Versions » (#1079): this one is its next version, a Coach change applied.
        const kept = await keepVersion(client, application.id, "tailored_cv", { source: "coach" });
        return { ok: true, version: kept ?? before, before } as const;
      });
    },

    async reviseProposal(candidateId, applicationId, { revision, adapted, origins, declared }) {
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return NOT_FOUND;
      return inTransaction(database, async (client) => {
        const { rows } = await client.query<{ proposal: ProposalRow | null; revision: string | null }>(
          `SELECT proposal, md5(proposal::text) AS revision FROM tailored_cv WHERE application_id = $1 FOR UPDATE`,
          [application.id],
        );
        const proposal = rows[0]?.proposal;
        if (!proposal) return NOT_FOUND;
        if (rows[0]!.revision !== revision) return { ok: false, error: "conflict" } as const;
        const before: ProposalAdaptation = { adapted: proposal.adapted, origins: proposal.origins ?? null, declared: proposal.declared ?? [] };
        const next: ProposalRow = { ...proposal, adapted };
        if (origins) next.origins = origins;
        else delete next.origins;
        if (declared.length > 0) next.declared = declared;
        else delete next.declared;
        const updated = await client.query<{ revision: string }>(`UPDATE tailored_cv SET proposal = $2 WHERE application_id = $1 RETURNING md5(proposal::text) AS revision`, [application.id, next]);
        return { ok: true, revision: updated.rows[0]!.revision, before } as const;
      });
    },

    async answerAll(candidateId, applicationId, { revision, answers }) {
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return NOT_FOUND;
      return inTransaction(database, async (client) => {
        const { rows } = await client.query<{ proposal: ProposalRow | null; revision: string | null }>(
          `SELECT proposal, md5(proposal::text) AS revision FROM tailored_cv WHERE application_id = $1 FOR UPDATE`,
          [application.id],
        );
        const proposal = rows[0]?.proposal;
        if (!proposal) return NOT_FOUND;
        if (rows[0]!.revision !== revision) return { ok: false, error: "conflict" } as const;
        if (answers.some((answer) => !proposal.questions.some((question) => question.requirement === answer.requirement))) return NOT_FOUND;
        const before = proposal.questions.filter((question) => answers.some((answer) => answer.requirement === question.requirement));
        const questions = proposal.questions.map((question) => {
          const given = answers.find((answer) => answer.requirement === question.requirement);
          return given ? { ...question, answer: given.answer } : question;
        });
        const updated = await client.query<{ revision: string }>(`UPDATE tailored_cv SET proposal = $2 WHERE application_id = $1 RETURNING md5(proposal::text) AS revision`, [
          application.id,
          { ...proposal, questions },
        ]);
        return { ok: true, revision: updated.rows[0]!.revision, before } as const;
      });
    },
  };
}

/** Creates or upgrades the Tailored CV table. Run after migrateTailoredDocuments. Safe to run repeatedly. */
export async function migrateTailoredCvs(database: Pool): Promise<void> {
  // Each proposal saved counts in Consumption (#799).
  await migrateConsumption(database);
  await database.query(`
    CREATE TABLE IF NOT EXISTS tailored_cv (
      application_id uuid PRIMARY KEY REFERENCES application (id) ON DELETE CASCADE,
      -- The proposal under the Candidate's review, if any.
      proposal jsonb
    );
    -- The Tailored CV the Candidate saved, if any.
    ALTER TABLE tailored_cv ADD COLUMN IF NOT EXISTS saved jsonb;
  `);
  // Each saved Tailored CV's earlier versions (#1079): the ones already saved become their version 1.
  await migrateTailoredDocumentVersions(database);
}
