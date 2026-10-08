/**
 * ATS Fixes: minimal, single changes to a Master CV that raise its ATS Score,
 * and Senior Advice against age-related bias. Each is accepted or rejected on
 * its own. Like a Tailored CV (ADR-0006), a fix never invents a fact: it only
 * moves, splits, cleans or removes what the CV already says, and puts the
 * Candidate's own target role in the headline.
 */
import type { CvContent, CvExperience } from "../domain";
import { normalise } from "../text";
import { cvTexts, DECORATION, SKILL_SEPARATOR, scoreAts } from "./score";

export type AtsFixCategory = "readability" | "keywords" | "senior_advice";

/** Why the fix is proposed; the interface explains each one. */
export type AtsFixReason =
  | "headline_missing"
  | "skills_on_one_line"
  | "decorations"
  | "headline_without_role"
  | "keyword_not_listed"
  | "age"
  | "birth_date"
  | "experience_years"
  | "old_experience";

export type AtsFixChange =
  | { type: "set_headline"; headline: string }
  | { type: "list_skill"; skill: string }
  | { type: "split_skill"; skill: string; into: string[] }
  | { type: "remove_decorations" }
  /** Replaces `from` wherever the headline, the summary or a job's title or description says it. */
  | { type: "replace_text"; from: string; to: string }
  | { type: "remove_experience"; experience: Pick<CvExperience, "title" | "employer" | "period"> };

export interface AtsFix {
  /** The same fix proposed twice has the same id. */
  id: string;
  category: AtsFixCategory;
  reason: AtsFixReason;
  change: AtsFixChange;
}

export interface AtsFixInput {
  cv: CvContent;
  targetRole: string;
  /** Tells how old a job is. Defaults to now. */
  today?: Date;
}

/** A job more than this many years behind is "very old experience". */
const OLD_EXPERIENCE_YEARS = 20;
/** The most years of experience worth writing down. */
const EXPERIENCE_YEARS_CAP = 15;

const SEPARATOR = String.raw`[,;–—|•-]`;
const AGE = [
  new RegExp(String.raw`(?:^|\s*${SEPARATOR}\s*)\d{2}\s*ans(?=\s*$|\s*[,;.–—|•-])`, "iu"),
  /âgée? de \d{2} ans[.,;]?/iu,
];
const BIRTH_DATE = [
  new RegExp(String.raw`(?:${SEPARATOR}\s*)?n[ée]e?\s+le\s+\d{1,2}(?:\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}|\s+\p{L}+\s+\d{4})[.,;]?`, "iu"),
  new RegExp(String.raw`(?:${SEPARATOR}\s*)?n[ée]e?\s+en\s+(?:19|20)\d{2}[.,;]?`, "iu"),
  /date de naissance\s*:?\s*\d{1,2}(?:\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}|\s+\p{L}+\s+\d{4})[.,;]?/iu,
  /born (?:on |in )?[\p{L}\d ,/.-]*?(?:19|20)\d{2}[.,;]?/iu,
];
const EXPERIENCE_YEARS = [/(?:plus de\s+)?(\d{2})\s*\+?\s*ans\s+d(['’])\s?expérience/iu, /(?:over\s+|more than\s+)?(\d{2})\s*\+?\s*years\s+of\s+experience/iu];

const ONGOING = /aujourd|present|actuel|en cours|ce jour|now|current|today|depuis|since/;

const fix = (category: AtsFixCategory, reason: AtsFixReason, change: AtsFixChange): AtsFix => ({ id: idOf(change), category, reason, change });

function idOf(change: AtsFixChange): string {
  switch (change.type) {
    case "set_headline":
    case "remove_decorations":
      return change.type;
    case "list_skill":
    case "split_skill":
      return `${change.type}:${change.skill}`;
    case "replace_text":
      return `${change.type}:${change.from}`;
    case "remove_experience":
      return `${change.type}:${change.experience.title}|${change.experience.employer}|${change.experience.period}`;
  }
}

const same = (a: string, b: string) => normalise(a) === normalise(b);

function splitSkill(skill: string): string[] {
  return skill
    .split(SKILL_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The latest year a job ran to, today's for a current one; undefined for an undated one. */
function lastYear(job: CvExperience, today: Date): number | undefined {
  const years = [...job.period.matchAll(/\b(19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  if (ONGOING.test(normalise(job.period))) years.push(today.getFullYear());
  return years.length ? Math.max(...years) : undefined;
}

/** "Plus de 15 ans d'expérience", in the case and language of what it replaces. */
function cappedExperience(match: RegExpMatchArray, atSentenceStart: boolean): string | undefined {
  if (Number(match[1]) <= EXPERIENCE_YEARS_CAP) return undefined;
  const english = /years/i.test(match[0]);
  const capital = /^\p{Lu}/u.test(match[0]) || atSentenceStart;
  const phrase = english ? `over ${EXPERIENCE_YEARS_CAP} years of experience` : `plus de ${EXPERIENCE_YEARS_CAP} ans d${match[2] ?? "'"}expérience`;
  return capital ? phrase[0]!.toUpperCase() + phrase.slice(1) : phrase;
}

function seniorAdvice(cv: CvContent, today: Date): AtsFix[] {
  const fixes: AtsFix[] = [];
  for (const text of [cv.headline, cv.summary, ...cv.experience.map((job) => job.description)]) {
    for (const pattern of AGE) {
      const match = text.match(pattern);
      if (match) fixes.push(fix("senior_advice", "age", { type: "replace_text", from: match[0].trim(), to: "" }));
    }
    for (const pattern of BIRTH_DATE) {
      const match = text.match(pattern);
      if (match) fixes.push(fix("senior_advice", "birth_date", { type: "replace_text", from: match[0].trim(), to: "" }));
    }
    for (const pattern of EXPERIENCE_YEARS) {
      const match = text.match(pattern);
      const atSentenceStart = match?.index === 0 || /[.!?]\s*$/.test(text.slice(0, match?.index ?? 0));
      const to = match && cappedExperience(match, atSentenceStart);
      if (match && to) fixes.push(fix("senior_advice", "experience_years", { type: "replace_text", from: match[0], to }));
    }
  }
  for (const job of cv.experience) {
    const year = lastYear(job, today);
    if (year !== undefined && year < today.getFullYear() - OLD_EXPERIENCE_YEARS) {
      const { title, employer, period } = job;
      fixes.push(fix("senior_advice", "old_experience", { type: "remove_experience", experience: { title, employer, period } }));
    }
  }
  return fixes;
}

/**
 * The ATS Fixes worth proposing for a CV: Readability first, then keywords,
 * then Senior Advice. None when there is nothing to fix.
 */
export function proposeAtsFixes({ cv, targetRole, today = new Date() }: AtsFixInput): AtsFix[] {
  const role = targetRole.trim();
  const fixes: AtsFix[] = [];

  if (!cv.headline.trim()) fixes.push(fix("readability", "headline_missing", { type: "set_headline", headline: role }));
  for (const skill of cv.skills) {
    const into = splitSkill(skill);
    if (into.length > 1) fixes.push(fix("readability", "skills_on_one_line", { type: "split_skill", skill, into }));
  }
  if (cvTextsWithDecorations(cv)) fixes.push(fix("readability", "decorations", { type: "remove_decorations" }));

  if (cv.headline.trim() && !normalise(cv.headline).includes(normalise(role))) {
    fixes.push(fix("keywords", "headline_without_role", { type: "set_headline", headline: role }));
  }
  const { mentioned } = scoreAts({ cv, targetRole: role }).breakdown.keywords;
  for (const keyword of mentioned.filter((keyword) => keyword !== role)) {
    fixes.push(fix("keywords", "keyword_not_listed", { type: "list_skill", skill: keyword }));
  }

  fixes.push(...seniorAdvice(cv, today));
  return fixes.filter((item, index) => fixes.findIndex((other) => other.id === item.id) === index);
}

const DECORATIONS = new RegExp(`${DECORATION.source}️?`, "gu");

function cvTextsWithDecorations(cv: CvContent): boolean {
  return cvTexts(cv).some((text) => DECORATION.test(text));
}

/** Single spaces, no space before punctuation, no separator left dangling at either end. */
function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.;:!?)])/g, "$1")
    .replace(/^[\s,;:–—|•-]+/, "")
    .replace(/[\s,;:–—|•-]+$/, "")
    .trim();
}

/** Every text of the CV, each passed through `edit`; untouched fields keep their exact text. */
function editTexts(cv: CvContent, edit: (text: string) => string): CvContent {
  const apply = (text: string) => {
    const edited = edit(text);
    return edited === text ? text : tidy(edited);
  };
  return {
    ...cv,
    fullName: apply(cv.fullName),
    headline: apply(cv.headline),
    summary: apply(cv.summary),
    skills: cv.skills.map(apply).filter(Boolean),
    experience: cv.experience.map((job) => ({
      ...job,
      title: apply(job.title),
      employer: apply(job.employer),
      period: apply(job.period),
      description: apply(job.description),
    })),
    education: cv.education.map((item) => ({ ...item, degree: apply(item.degree), institution: apply(item.institution) })),
  };
}

function applyChange(cv: CvContent, change: AtsFixChange): CvContent | null {
  switch (change.type) {
    case "set_headline":
      return cv.headline === change.headline ? null : { ...cv, headline: change.headline };
    case "list_skill":
      return cv.skills.some((skill) => same(skill, change.skill)) ? null : { ...cv, skills: [...cv.skills, change.skill] };
    case "split_skill": {
      const index = cv.skills.indexOf(change.skill);
      if (index === -1) return null;
      const others = cv.skills.filter((_, at) => at !== index);
      const into = change.into.filter((skill) => !others.some((other) => same(other, skill)));
      return { ...cv, skills: [...cv.skills.slice(0, index), ...into, ...cv.skills.slice(index + 1)] };
    }
    case "remove_decorations":
      return cvTextsWithDecorations(cv) ? editTexts(cv, (text) => text.replace(DECORATIONS, "")) : null;
    case "replace_text": {
      const { from, to } = change;
      const says = (text: string) => from !== "" && text.includes(from);
      if (![cv.headline, cv.summary, ...cv.experience.flatMap((job) => [job.title, job.description])].some(says)) return null;
      const replace = (text: string) => (says(text) ? tidy(text.split(from).join(to)) : text);
      return {
        ...cv,
        headline: replace(cv.headline),
        summary: replace(cv.summary),
        experience: cv.experience.map((job) => ({ ...job, title: replace(job.title), description: replace(job.description) })),
      };
    }
    case "remove_experience": {
      const { title, employer, period } = change.experience;
      const index = cv.experience.findIndex((job) => job.title === title && job.employer === employer && job.period === period);
      return index === -1 ? null : { ...cv, experience: cv.experience.filter((_, at) => at !== index) };
    }
  }
}

/**
 * The CV with `fix` applied, or null when it no longer applies: what it
 * changes is gone, or it is already done. Changes nothing else.
 */
export function applyAtsFix(cv: CvContent, atsFix: AtsFix): CvContent | null {
  return applyChange(cv, atsFix.change);
}
