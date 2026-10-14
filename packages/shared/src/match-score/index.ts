/**
 * Match Score: how well a CV (Master or Tailored) fits a Job Offer, 0–100,
 * with an explained breakdown. Pure and synchronous, so the web app and the
 * extension's Guest flow compute it the same way, without an account.
 */
import type { ContractType, CvContent, JobOfferDetails, SalaryRange, SearchCriteria } from "../domain";
import { normalise } from "../text";


export type CriterionStatus = "match" | "partial" | "mismatch" | "unknown";

export interface SkillsBreakdown {
  status: CriterionStatus;
  /** The Job Offer's skills the CV shows, as the Job Offer writes them. */
  covered: string[];
  /** The Job Offer's skills the CV does not show. */
  missing: string[];
}

export interface SeniorityBreakdown {
  status: CriterionStatus;
  /** Years from the CV's earliest dated job to its latest (today for a current job). */
  cvYears?: number;
  /** Years of experience the Job Offer asks for. */
  requiredYears?: number;
}

/** One criterion compared with the Search Criteria: what the Job Offer says, and what is wanted. */
export interface CriterionBreakdown<T> {
  status: CriterionStatus;
  offer?: T;
  wanted?: T;
}

/** The Job Offer's salary range against the Search Criteria's minimum salary. */
export interface SalaryBreakdown {
  status: CriterionStatus;
  offer?: SalaryRange;
  wanted?: number;
}

export interface MatchScore {
  score: number;
  breakdown: {
    skills: SkillsBreakdown;
    seniority: SeniorityBreakdown;
    location: CriterionBreakdown<string>;
    salary: SalaryBreakdown;
    contractType: CriterionBreakdown<ContractType>;
  };
}

export interface MatchInput {
  cv: CvContent;
  jobOffer: JobOfferDetails;
  /** The Profile's Search Criteria; for a Guest without them, the CV's own location is used. */
  searchCriteria?: SearchCriteria;
  /** For a current job ("2015 – aujourd'hui"). Defaults to now. */
  today?: Date;
}

/**
 * Skills that mean the same thing: common French/English equivalents and abbreviations.
 * Each line is one skill; any of its wordings on the CV covers any other in the Job Offer.
 * Wordings are compared in skill form (see `words`), so accents, case, plurals and
 * small words ("de la", "d'", "of the") do not need listing. A wording written in
 * capitals is an abbreviation, and only stands for its skill where the text writes it
 * in capitals too: "IA" is artificial intelligence, the "ai" of "j'ai" is not.
 */
const SYNONYMS: readonly (readonly string[])[] = [
  ["gestion de projet", "conduite de projet", "pilotage de projet", "management de projet", "project management"],
  ["gestion de la chaîne d'approvisionnement", "chaîne d'approvisionnement", "chaîne logistique", "supply chain", "supply chain management", "SCM"],
  ["P&L", "compte de résultat", "profit and loss", "profit & loss"],
  ["conduite du changement", "gestion du changement", "accompagnement du changement", "change management"],
  ["contrôle de gestion", "management control", "controlling"],
  ["comptabilité", "accounting"],
  ["trésorerie", "treasury", "cash management"],
  ["achats", "procurement", "purchasing"],
  ["logistique", "logistics"],
  ["entrepôt", "warehouse", "warehousing"],
  ["prévisions", "prévision des ventes", "forecasting", "demand planning"],
  ["S&OP", "PIC", "plan industriel et commercial", "sales and operations planning"],
  ["ressources humaines", "RH", "human resources", "HR"],
  ["paie", "payroll"],
  ["recrutement", "recruitment", "recruiting", "talent acquisition"],
  ["gestion des talents", "talent management"],
  ["management d'équipe", "encadrement d'équipe", "team management", "people management"],
  ["gestion budgétaire", "budget management", "budgeting"],
  ["fusions acquisitions", "fusions et acquisitions", "M&A", "mergers and acquisitions"],
  ["fiscalité", "tax", "taxation"],
  ["gestion des risques", "risk management"],
  ["audit interne", "internal audit"],
  ["indicateurs de performance", "indicateurs clés de performance", "KPI", "key performance indicators"],
  ["business intelligence", "BI", "informatique décisionnelle"],
  ["gestion de la relation client", "CRM", "customer relationship management"],
  ["service client", "customer service"],
  ["développement commercial", "business development"],
  ["négociation", "negotiation"],
  ["ventes", "sales"],
  ["marketing digital", "marketing numérique", "digital marketing"],
  ["transformation digitale", "transformation numérique", "digital transformation"],
  ["intelligence artificielle", "IA", "artificial intelligence", "AI"],
  ["amélioration continue", "continuous improvement"],
  ["RSE", "responsabilité sociétale des entreprises", "responsabilité sociale des entreprises", "CSR", "corporate social responsibility"],
  ["recherche et développement", "R&D", "research and development"],
  ["e-commerce", "ecommerce", "commerce en ligne"],
  ["anglais", "english"],
  ["français", "french"],
];

/** Small words that do not change what a skill means: "gestion de la chaîne" is "gestion chaîne". */
const SMALL_WORDS = new Set(["a", "au", "aux", "d", "de", "des", "du", "en", "et", "l", "la", "le", "les", "and", "for", "in", "of", "the"]);

/** "Comptes" → "compte", "canaux" → "canal": the singular of a plural word of four letters or more. */
function singular(word: string): string {
  if (word.length < 4) return word;
  if (word.endsWith("aux")) return `${word.slice(0, -3)}al`;
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** A word in skill form, and whether the text wrote it in capitals, as an abbreviation is written ("IA", "S&OP"). */
interface Word {
  text: string;
  capitals: boolean;
}

/**
 * A text in skill form: normalised words, singular, without small words, with an
 * abbreviation joined by "&" kept as one word ("P&L" → "pl", "S&OP" → "sop").
 * Each word keeps whether it was written in capitals, which `normalise` alone would lose.
 */
function words(text: string): Word[] {
  const joined = text.replace(/(?<!\p{L})(\p{L}{1,2}) ?& ?(\p{L}{1,3})(?!\p{L})/gu, "$1$2");
  return joined
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^\p{L}\p{N}+#]+/u)
    .map((raw) => ({ text: normalise(raw).trim(), capitals: /^\p{Lu}{2,}$/u.test(raw) }))
    .filter((word) => word.text && !SMALL_WORDS.has(word.text))
    .map((word) => ({ ...word, text: singular(word.text) }));
}

/** Every wording of every synonym, longest first, with the line it belongs to and whether it is an abbreviation. */
const WORDINGS = SYNONYMS.flatMap((line, index) =>
  line.map((wording) => {
    const list = words(wording);
    return { words: list.map((word) => word.text), abbreviation: list.every((word) => word.capitals), id: `~${index}` };
  }),
).sort((a, b) => b.words.length - a.words.length);

const startsWith = (list: string[], at: number, prefix: string[]) => prefix.every((word, offset) => list[at + offset] === word);

/**
 * The same words with each synonym replaced by its line, so "project management" and "gestion de projets"
 * read alike. An abbreviation only counts where it is written in capitals: "AI", not the "ai" of "j'ai".
 */
function canonical(list: Word[]): string[] {
  const texts = list.map((word) => word.text);
  const result: string[] = [];
  for (let at = 0; at < list.length; ) {
    const wording = WORDINGS.find(
      (candidate) =>
        startsWith(texts, at, candidate.words) &&
        (!candidate.abbreviation || list.slice(at, at + candidate.words.length).every((word) => word.capitals)),
    );
    result.push(wording ? wording.id : texts[at]!);
    at += wording ? wording.words.length : 1;
  }
  return result;
}

const contains = (list: string[], phrase: string[]) =>
  phrase.length > 0 && list.some((_, at) => at + phrase.length <= list.length && startsWith(list, at, phrase));

/** A CV field (or a Job Offer skill) in both forms: its own words, and its words with synonyms resolved. */
interface SkillText {
  plain: string[];
  canonical: string[];
}

function skillText(text: string): SkillText {
  const list = words(text);
  return { plain: list.map((word) => word.text), canonical: canonical(list) };
}

/** Each field of the CV that can show a skill, so a skill is never read across two fields. */
function cvFields(cv: CvContent): SkillText[] {
  return [
    cv.headline,
    cv.summary,
    ...cv.skills,
    ...cv.experience.flatMap((job) => [job.title, job.description]),
    ...cv.education.map((item) => item.degree),
  ].map(skillText);
}

/** The CV shows a skill when one of its fields holds the skill's words, as written or through a synonym. */
function shows(fields: SkillText[], skill: string): boolean {
  const wanted = skillText(skill);
  return fields.some((field) => contains(field.plain, wanted.plain) || contains(field.canonical, wanted.canonical));
}

function scoreSkills(cv: CvContent, jobOffer: JobOfferDetails): SkillsBreakdown {
  const fields = cvFields(cv);
  const wanted = jobOffer.skills ?? [];
  const covered = wanted.filter((skill) => shows(fields, skill));
  const missing = wanted.filter((skill) => !covered.includes(skill));
  const status: CriterionStatus =
    wanted.length === 0 ? "unknown" : missing.length === 0 ? "match" : covered.length === 0 ? "mismatch" : "partial";
  return { status, covered, missing };
}

/** A period that runs to today: "2015 – présent", or one that only says when it began ("Depuis 2015", "Since 2015"). */
const ONGOING = /aujourd|present|actuel|en cours|ce jour|now|current|today|depuis|since/;

function cvYears(cv: CvContent, today: Date): number | undefined {
  const years: number[] = [];
  for (const { period } of cv.experience) {
    const text = normalise(period);
    years.push(...[...text.matchAll(/\b(19|20)\d{2}\b/g)].map((match) => Number(match[0])));
    if (ONGOING.test(text)) years.push(today.getFullYear());
  }
  return years.length === 0 ? undefined : Math.max(...years) - Math.min(...years);
}

const REQUIRED_YEARS = [/(\d{1,2}) ?\+? ?ans? (?:minimum )?d ?(?:experience|exp)/, /(\d{1,2}) ?\+? ?years? (?:of )?(?:relevant |professional )?experience/];

function requiredYears(jobOffer: JobOfferDetails): number | undefined {
  if (jobOffer.requiredExperienceYears !== undefined) return jobOffer.requiredExperienceYears;
  const text = normalise(jobOffer.content);
  for (const pattern of REQUIRED_YEARS) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function scoreSeniority(cv: CvContent, jobOffer: JobOfferDetails, today: Date): SeniorityBreakdown {
  const breakdown: SeniorityBreakdown = { status: "unknown" };
  const has = cvYears(cv, today);
  const wanted = requiredYears(jobOffer);
  if (has !== undefined) breakdown.cvYears = has;
  if (wanted !== undefined) breakdown.requiredYears = wanted;
  if (has !== undefined && wanted !== undefined) {
    breakdown.status = has >= wanted ? "match" : has >= wanted * 0.75 ? "partial" : "mismatch";
  }
  return breakdown;
}

/** Compares what the Job Offer says with what is wanted; unknown when either is missing. */
function compare<T>(offer: T | undefined, wanted: T | undefined, status: (offer: T, wanted: T) => CriterionStatus): CriterionBreakdown<T> {
  const breakdown: CriterionBreakdown<T> = { status: "unknown" };
  if (offer !== undefined) breakdown.offer = offer;
  if (wanted !== undefined) breakdown.wanted = wanted;
  if (offer !== undefined && wanted !== undefined) breakdown.status = status(offer, wanted);
  return breakdown;
}

const blankToUndefined = (text: string | undefined) => (text?.trim() ? text.trim() : undefined);

function scoreLocation(cv: CvContent, jobOffer: JobOfferDetails, searchCriteria: SearchCriteria | undefined) {
  return compare(blankToUndefined(jobOffer.location), blankToUndefined(searchCriteria?.location ?? cv.location), (offer, wanted) => {
    if (jobOffer.remoteWork === "full_remote") return "match";
    const [a, b] = [normalise(offer), normalise(wanted)];
    return a.includes(b) || b.includes(a) ? "match" : "mismatch";
  });
}

function scoreSalary(jobOffer: JobOfferDetails, searchCriteria: SearchCriteria | undefined): SalaryBreakdown {
  const range = jobOffer.salary?.min !== undefined || jobOffer.salary?.max !== undefined ? jobOffer.salary : undefined;
  const breakdown: SalaryBreakdown = { status: "unknown" };
  if (range) breakdown.offer = range;
  const wanted = searchCriteria?.minSalary;
  if (wanted !== undefined) breakdown.wanted = wanted;
  if (range && wanted !== undefined) {
    const top = Math.max(range.min ?? 0, range.max ?? 0);
    breakdown.status = top >= wanted ? "match" : top >= wanted * 0.9 ? "partial" : "mismatch";
  }
  return breakdown;
}

/** How much each criterion weighs in the score, out of 100 when all are known. */
const WEIGHTS = { skills: 40, seniority: 20, location: 15, contractType: 15, salary: 10 } as const;

function fulfilment(criterion: { status: CriterionStatus }): number {
  if ("covered" in criterion && criterion.status === "partial") {
    const { covered, missing } = criterion as SkillsBreakdown;
    return covered.length / (covered.length + missing.length);
  }
  return { match: 1, partial: 0.5, mismatch: 0, unknown: 0 }[criterion.status];
}

/** The weighted share of the known criteria that the CV fulfils, 0–100; 0 when nothing is known. */
function overall(breakdown: MatchScore["breakdown"]): number {
  let earned = 0;
  let possible = 0;
  for (const name of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) {
    if (breakdown[name].status === "unknown") continue;
    earned += WEIGHTS[name] * fulfilment(breakdown[name]);
    possible += WEIGHTS[name];
  }
  return possible === 0 ? 0 : Math.round((earned / possible) * 100);
}

export function scoreMatch({ cv, jobOffer, searchCriteria, today = new Date() }: MatchInput): MatchScore {
  const skills = scoreSkills(cv, jobOffer);
  const seniority = scoreSeniority(cv, jobOffer, today);
  const location = scoreLocation(cv, jobOffer, searchCriteria);
  const salary = scoreSalary(jobOffer, searchCriteria);
  const contractType = compare(jobOffer.contractType, searchCriteria?.contractType, (offer, wanted) => (offer === wanted ? "match" : "mismatch"));
  const breakdown = { skills, seniority, location, salary, contractType };
  return { score: overall(breakdown), breakdown };
}
