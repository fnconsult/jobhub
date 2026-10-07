/**
 * The Onboarding Questionnaire: the guided interview the AI Coach runs to build
 * a Master CV and Search Criteria when the Candidate has no CV to upload.
 *
 * One deep module, pure (it runs in the browser and on the server alike).
 * Callers get:
 *  - `startQuestionnaire()` — an interview with nothing answered yet;
 *  - `currentQuestion(q)` — the question to ask now, or null once it is over;
 *  - `answer(q, value)` — the interview with the current question answered, or
 *    an error code when the answer cannot be taken (`required`, `yes_or_no`);
 *  - `draftFromQuestionnaire(q)` — the answers as a `CvDraft`, the very shape
 *    `draftFromCv` gives for an uploaded CV, for the same review and save.
 * The order of questions, the loops over jobs and degrees and how a free-text
 * answer becomes a CV section all stay behind it. The questions' wording lives
 * in the interface catalogue (`questionnaire.questions.<id>`).
 */
import type { CvEducation, CvExperience, CvLanguage, MasterCvContent } from "@jobhub/shared";
import type { CvDraft } from "@/cv";

export type QuestionId =
  | "fullName"
  | "targetRole"
  | "location"
  | "email"
  | "phone"
  | "jobTitle"
  | "employer"
  | "jobLocation"
  | "period"
  | "jobDescription"
  | "moreExperience"
  | "degree"
  | "institution"
  | "year"
  | "moreEducation"
  | "skills"
  | "languages"
  | "summary";

export interface Question {
  id: QuestionId;
  /** "text" is one line, "multiline" a few sentences, "yesNo" takes only "yes" or "no". */
  kind: "text" | "multiline" | "yesNo";
  /** Whether the Candidate may skip it (answer with an empty string). */
  optional: boolean;
  /** Which job or degree a repeated question is about, from 1. */
  number?: number;
}

/** An interview in progress. Treat as opaque: only this module reads it. */
export interface Questionnaire {
  readonly answers: readonly string[];
}

export type AnswerError = "required" | "yes_or_no";
export type AnswerResult = { ok: true; questionnaire: Questionnaire } | { ok: false; error: AnswerError };

/** More jobs or degrees than this are added during the review, not asked one by one. */
const MAX_ENTRIES = 10;

const text = (id: QuestionId, optional: boolean, number?: number): Question => ({ id, kind: "text", optional, ...(number ? { number } : {}) });

/** Replays the answers given so far; returns the draft they make and the question to ask next. */
function replay(answers: readonly string[]): { draft: CvDraft; next: Question | null } {
  const cv: MasterCvContent = { fullName: "", headline: "", email: "", phone: "", location: "", summary: "", experience: [], education: [], skills: [], languages: [] };
  const criteria = { targetRole: "", location: "" };
  let index = 0;
  /** The next answer, or undefined when the interview has reached this question. */
  const take = () => (index < answers.length ? answers[index++]! : undefined);

  function* script(): Generator<Question, void, string> {
    cv.fullName = yield text("fullName", false);
    criteria.targetRole = cv.headline = yield text("targetRole", false);
    criteria.location = cv.location = yield text("location", false);
    cv.email = yield text("email", true);
    cv.phone = yield text("phone", true);

    for (let number = 1; number <= MAX_ENTRIES; number++) {
      const title = yield text("jobTitle", true, number);
      if (!title) break;
      const job: CvExperience = { title, employer: "", location: "", period: "", description: "" };
      cv.experience.push(job);
      job.employer = yield text("employer", true, number);
      job.location = yield text("jobLocation", true, number);
      job.period = yield text("period", true, number);
      job.description = yield { id: "jobDescription", kind: "multiline", optional: true, number };
      if (number === MAX_ENTRIES || (yield { id: "moreExperience", kind: "yesNo", optional: false, number }) === "no") break;
    }

    for (let number = 1; number <= MAX_ENTRIES; number++) {
      const degree = yield text("degree", true, number);
      if (!degree) break;
      const item: CvEducation = { degree, institution: "", year: "" };
      cv.education.push(item);
      item.institution = yield text("institution", true, number);
      item.year = yield text("year", true, number);
      if (number === MAX_ENTRIES || (yield { id: "moreEducation", kind: "yesNo", optional: false, number }) === "no") break;
    }

    cv.skills = splitList(yield { id: "skills", kind: "multiline", optional: true });
    cv.languages = splitList(yield { id: "languages", kind: "multiline", optional: true }).map(language);
    cv.summary = yield { id: "summary", kind: "multiline", optional: true };
  }

  const interview = script();
  let step = interview.next();
  while (!step.done) {
    const value = take();
    if (value === undefined) return { draft: { masterCv: cv, searchCriteria: criteria }, next: step.value };
    step = interview.next(value);
  }
  return { draft: { masterCv: cv, searchCriteria: criteria }, next: null };
}

/** "Consolidation, IFRS\nSAP" → ["Consolidation", "IFRS", "SAP"]. */
function splitList(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** "Anglais : courant" or "Espagnol - courant" → { name, level }; "Anglais" alone has no level. */
function language(value: string): CvLanguage {
  const match = /^(.+?)\s*(?::|\s-\s|–|—)\s*(.*)$/.exec(value);
  return match ? { name: match[1]!.trim(), level: match[2]!.trim() } : { name: value, level: "" };
}

export function startQuestionnaire(): Questionnaire {
  return { answers: [] };
}

export function currentQuestion(questionnaire: Questionnaire): Question | null {
  return replay(questionnaire.answers).next;
}

export function answer(questionnaire: Questionnaire, value: string): AnswerResult {
  const question = currentQuestion(questionnaire);
  if (!question) return { ok: true, questionnaire };
  const trimmed = value.trim();
  if (question.kind === "yesNo" && trimmed !== "yes" && trimmed !== "no") return { ok: false, error: "yes_or_no" };
  if (!question.optional && !trimmed) return { ok: false, error: "required" };
  return { ok: true, questionnaire: { answers: [...questionnaire.answers, trimmed] } };
}

export function draftFromQuestionnaire(questionnaire: Questionnaire): CvDraft {
  return replay(questionnaire.answers).draft;
}
