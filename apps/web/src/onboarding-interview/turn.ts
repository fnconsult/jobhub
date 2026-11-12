/**
 * The onboarding interview the AI Coach leads without a CV (#1002, ADR-0106), as the page and the route share it: its
 * fields, a turn (what the coach asks, what it proposes, what it challenges), the Candidate's reply to a turn, and the
 * draft each reply makes. Pure, and safe in the browser.
 *
 *   replied(draft, turn, reply)       the draft after the Candidate's reply: an answer to the question asked, or a
 *                                     proposal they validated (« Oui, … »); a proposal they did not validate is never in it
 *   interviewDraft(cvDraft)           a draft from the page's CvDraft, its Search Criteria complete
 *   questionnaireDraft(draft)         what the scripted questions are given when they take over (the AI unavailable)
 *   foldedProvenance(earlier, later)  the interview's Provenance so far: one step per model, its calls counted
 *
 * Nothing enters the draft that does not come from the Candidate (ADR-0006): an answer, typed or a choice clicked, is
 * theirs; a proposal is the AI's until they validate it.
 */
import {
  CONTRACT_TYPES,
  distinctLocations,
  industryChoices,
  joinProvenance,
  MAX_SEARCH_LOCATIONS,
  REMOTE_WORK_OPTIONS,
  type CvLanguage,
  type MasterCvContent,
  type Provenance,
  type ProvenanceStep,
  type SearchCriteria,
} from "@jobhub/shared";
import type { CvDraft } from "@/cv";
import { language, splitList } from "@/questionnaire";

/** The Search Criteria fields the interview asks or proposes, in the order a Profile needs them. */
export const CRITERIA_FIELDS = ["targetRole", "locations", "contractTypes", "remoteWorkOptions", "minSalary", "sectors", "subsectors", "domains"] as const;
/** The Master CV fields; an entry of a section by `section.field` (a new job starts with its title, a new degree with its name). */
export const CV_FIELDS = [
  "fullName",
  "headline",
  "email",
  "phone",
  "location",
  "summary",
  "skills",
  "languages",
  "experience.title",
  "experience.employer",
  "experience.location",
  "experience.period",
  "experience.description",
  "education.degree",
  "education.institution",
  "education.year",
] as const;
export const INTERVIEW_FIELDS = [...CRITERIA_FIELDS, ...CV_FIELDS] as const;
export type InterviewField = (typeof INTERVIEW_FIELDS)[number];

export const isInterviewField = (field: unknown): field is InterviewField => typeof field === "string" && (INTERVIEW_FIELDS as readonly string[]).includes(field);

/** What a Profile cannot be born without (#999): never skipped. */
export const REQUIRED_FIELDS: readonly InterviewField[] = ["targetRole", "locations"];
/** Never proposed: the AI cannot deduce who the Candidate is or how to reach them. */
export const NOT_PROPOSED: readonly InterviewField[] = ["fullName", "email", "phone"];
/** The fields answered by a choice, and their choices: the codes the Search Criteria take. */
export const CHOICES = { contractTypes: CONTRACT_TYPES, remoteWorkOptions: REMOTE_WORK_OPTIONS } as const satisfies Partial<Record<InterviewField, readonly string[]>>;
export type ChoiceField = keyof typeof CHOICES;
export const isChoiceField = (field: InterviewField): field is ChoiceField => Object.hasOwn(CHOICES, field);
/** Codes of a nomenclature: only ever proposed, never typed. */
export const CODE_FIELDS = ["sectors", "subsectors", "domains"] as const satisfies readonly InterviewField[];
export const isCodeField = (field: InterviewField): field is (typeof CODE_FIELDS)[number] => (CODE_FIELDS as readonly string[]).includes(field);

/** The draft the interview builds: a Master CV, and Search Criteria with each of their fields. */
export interface InterviewDraft {
  masterCv: MasterCvContent;
  searchCriteria: SearchCriteria;
}

/** A proposed value: text, a list (places, codes, skills), or a whole number (a salary). */
export type ProposalValue = string | string[] | number;

/** What the coach asks: one field, its question in the Candidate's language, how it is answered. */
export interface InterviewAsk {
  field: InterviewField;
  question: string;
  kind: "text" | "multiline" | "choice";
  /** A choice field's codes, as the Search Criteria take them. */
  choices?: string[];
  /** May be skipped (« Passer »): everything but what the Profile is born with, once it is known. */
  optional: boolean;
}

/** What the coach deduced, for the Candidate to validate: checked by the code, `shown` written by it. */
export interface InterviewProposal {
  field: InterviewField;
  value: ProposalValue;
  /** Why it deduces it, in a sentence. */
  because: string;
  /** The value in words (labels, not codes), as « Oui, … » shows it. */
  shown: string;
}

/** One turn of the coach: the next question, maybe a deduction to validate, maybe why the last answer was too vague. */
export interface InterviewTurn {
  ask: InterviewAsk;
  proposal?: InterviewProposal;
  challenge?: string;
  /** Enough is known: the review follows. */
  done: boolean;
}

/**
 * The Candidate's reply to a turn: an answer typed (`declined` after « Non, plutôt… ») or a choice clicked (its code),
 * « Oui » to the proposal, or « Passer ».
 */
export type InterviewReply = { kind: "answer"; text: string; choice?: string; declined?: boolean } | { kind: "accepted" } | { kind: "skipped" };

/** A turn and its reply, as the page keeps them and sends them back to the route. */
export interface ExchangeTurn {
  ask: Pick<InterviewAsk, "field" | "question">;
  proposal?: Pick<InterviewProposal, "field" | "value" | "shown">;
  challenge?: string;
  reply: InterviewReply;
}

const EMPTY_CRITERIA: SearchCriteria = { targetRole: "", locations: [], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };

/** A draft from the page's CvDraft (a blank one, or a Profile's), its Search Criteria complete. */
export function interviewDraft(draft: CvDraft & { searchCriteria: Partial<SearchCriteria> }): InterviewDraft {
  return { masterCv: structuredClone(draft.masterCv), searchCriteria: { ...EMPTY_CRITERIA, ...structuredClone(draft.searchCriteria) } };
}

/** Whether a field already holds something. */
export function isFilled(draft: InterviewDraft, field: InterviewField): boolean {
  if ((CRITERIA_FIELDS as readonly string[]).includes(field)) {
    const value = draft.searchCriteria[field as (typeof CRITERIA_FIELDS)[number]];
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== "";
  }
  const [section, key] = field.split(".") as [string, string | undefined];
  if (section === "experience" || section === "education") {
    const last = draft.masterCv[section].at(-1) as Record<string, string> | undefined;
    return key !== undefined && Boolean(last?.[key]);
  }
  const value = draft.masterCv[field as keyof MasterCvContent];
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/**
 * Whether the Candidate may skip a question on `field`: all but the target role and a place, never skippable, even asked
 * again after a vague answer (the draft then holds that answer, which is not yet a target role the coach accepted).
 */
export const isOptional = (_draft: InterviewDraft, field: InterviewField): boolean => !REQUIRED_FIELDS.includes(field);

/** Whether the Profile can be born: a target role and a place (#999). */
export const canBeBorn = (draft: InterviewDraft): boolean => isFilled(draft, "targetRole") && isFilled(draft, "locations");

/**
 * The draft after the Candidate's reply to `turn`: only their answer, or the proposal they validated, changes it. A
 * proposal answered otherwise (an answer typed, « Non, plutôt… », « Passer », nothing) is never in it.
 */
export function replied(draft: InterviewDraft, turn: Pick<InterviewTurn, "ask" | "proposal">, reply: InterviewReply): InterviewDraft {
  switch (reply.kind) {
    case "skipped":
      return draft;
    case "accepted":
      return turn.proposal ? withValue(draft, turn.proposal.field, turn.proposal.value) : draft;
    case "answer":
      return answered(draft, turn.ask.field, reply);
  }
}

/** Text compared without case, accents nor spacing. */
const folded = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

/** The words that name each choice in an answer typed, in French and English. */
const CHOICE_WORDS: Record<string, readonly string[]> = {
  cdi: ["cdi", "permanent", "indetermine"],
  cdd: ["cdd", "fixed-term", "fixed term", "determine"],
  freelance: ["freelance", "independant", "free-lance", "consultant"],
  interim: ["interim", "temporaire", "temporary"],
  on_site: ["sur site", "presentiel", "on site", "on-site", "bureau"],
  hybrid: ["hybride", "hybrid", "partiel"],
  full_remote: ["teletravail complet", "100 % teletravail", "full remote", "remote", "a distance", "teletravail total"],
};

/** The choices an answer typed names: « CDI ou freelance » → ["cdi", "freelance"]. A word of none: none. */
export function choicesNamed(field: ChoiceField, text: string): string[] {
  const said = folded(text);
  // « indéterminée » holds « déterminée »: the longer words are looked for first, and taken out once found.
  const words = CHOICES[field].flatMap((choice) => (CHOICE_WORDS[choice] ?? [choice]).map((word) => [choice, word] as const)).sort((a, b) => b[1].length - a[1].length);
  let rest = said;
  const found = new Set<string>();
  for (const [choice, word] of words) {
    if (rest.includes(word)) {
      found.add(choice);
      rest = rest.split(word).join(" ");
    }
  }
  return CHOICES[field].filter((choice) => found.has(choice));
}

/** A gross annual salary typed (« 55 000 € », « 55k », « 55 ») in euros; null when none can be read. */
export function salaryNamed(text: string): number | null {
  const match = /(\d{1,3}(?:[\s.\u202f\u00a0]\d{3})+|\d+)(?:[,.]\d+)?\s*(k)?/i.exec(text);
  if (!match) return null;
  let amount = Number(match[1]!.replace(/[\s.\u202f\u00a0]/g, ""));
  if (match[2] || amount < 1000) amount *= 1000;
  return Number.isInteger(amount) && amount > 0 && amount <= 10_000_000 ? amount : null;
}

/** Places typed: « Lyon, Villeurbanne et Paris » → three. */
const placesNamed = (text: string): string[] => distinctLocations(text.split(/[,;/\n]|\s+(?:et|ou|and|or)\s+/i));

/** The draft with an answer to `field`, read as the field takes it: an answer the field cannot take changes nothing. */
function answered(draft: InterviewDraft, field: InterviewField, reply: { text: string; choice?: string }): InterviewDraft {
  const text = reply.text.trim();
  if (isChoiceField(field)) {
    const chosen = reply.choice !== undefined ? [reply.choice].filter((code) => (CHOICES[field] as readonly string[]).includes(code)) : choicesNamed(field, text);
    return chosen.length > 0 ? withValue(draft, field, chosen) : draft;
  }
  // A code is never typed: the coach proposes it, named in words, for the Candidate to validate.
  if (isCodeField(field)) return draft;
  if (!text) return draft;
  if (field === "minSalary") {
    const salary = salaryNamed(text);
    return salary === null ? draft : withValue(draft, field, salary);
  }
  if (field === "locations") return withValue(draft, field, placesNamed(text));
  if (field === "skills") return withValue(draft, field, splitList(text));
  if (field === "languages") return withValue(draft, field, splitList(text));
  return withValue(draft, field, text);
}

/** The draft with `value` on `field`: a list adds to what is there (places, skills, languages), a choice or codes replace it. */
function withValue(draft: InterviewDraft, field: InterviewField, value: ProposalValue): InterviewDraft {
  const next: InterviewDraft = structuredClone(draft);
  const { masterCv: cv, searchCriteria: criteria } = next;
  const list = Array.isArray(value) ? value.map(String) : [String(value)];
  const one = Array.isArray(value) ? value.join(", ") : String(value);
  switch (field) {
    case "targetRole":
      // The scripted questions made it the CV's title too: so does it here, unless the Candidate gave the CV another one.
      if (!cv.headline || cv.headline === criteria.targetRole) cv.headline = one;
      criteria.targetRole = one;
      break;
    case "locations": {
      criteria.locations = distinctLocations([...criteria.locations, ...list]).slice(0, MAX_SEARCH_LOCATIONS);
      cv.location ||= criteria.locations[0] ?? "";
      break;
    }
    case "minSalary": {
      const salary = typeof value === "number" ? value : salaryNamed(one);
      if (salary !== null) criteria.minSalary = salary;
      break;
    }
    case "contractTypes":
      criteria.contractTypes = CONTRACT_TYPES.filter((type) => list.includes(type));
      break;
    case "remoteWorkOptions":
      criteria.remoteWorkOptions = REMOTE_WORK_OPTIONS.filter((option) => list.includes(option));
      break;
    case "sectors":
    case "subsectors":
    case "domains":
      Object.assign(criteria, industryChoices({ sectors: criteria.sectors, subsectors: criteria.subsectors, domains: criteria.domains, [field]: list }));
      break;
    case "skills":
      cv.skills = [...new Set([...cv.skills, ...list.map((skill) => skill.trim()).filter(Boolean)])];
      break;
    case "languages":
      cv.languages = [...cv.languages, ...list.map(language).filter((item: CvLanguage) => !cv.languages.some((had) => folded(had.name) === folded(item.name)))];
      break;
    case "fullName":
    case "headline":
    case "email":
    case "phone":
    case "location":
    case "summary":
      cv[field] = one;
      break;
    default: {
      const [section, key] = field.split(".") as ["experience" | "education", string];
      // A job starts with its title, a degree with its name; anything else completes the last one (or starts one).
      const starts = key === "title" || key === "degree";
      if (section === "experience") {
        if (starts || cv.experience.length === 0) cv.experience.push({ title: "", employer: "", location: "", period: "", description: "" });
        (cv.experience.at(-1) as unknown as Record<string, string>)[key] = one;
      } else {
        if (starts || cv.education.length === 0) cv.education.push({ degree: "", institution: "", year: "" });
        (cv.education.at(-1) as unknown as Record<string, string>)[key] = one;
      }
    }
  }
  return next;
}

/** The interview's draft as the page's CvDraft: what the review and the scripted questions take. */
export function questionnaireDraft(draft: InterviewDraft): CvDraft {
  return { masterCv: draft.masterCv, searchCriteria: { targetRole: draft.searchCriteria.targetRole, locations: draft.searchCriteria.locations } };
}

/** Each answer given and each question skipped, as Activity counts them (a validated proposal is an answer). */
export function answerCounts(exchange: readonly ExchangeTurn[]): { answered: number; skipped: number } {
  const skipped = exchange.filter((turn) => turn.reply.kind === "skipped").length;
  return { answered: exchange.length - skipped, skipped };
}

/** The same model's calls, as one step: their count, time and tokens summed. */
const sameCall = (a: ProvenanceStep, b: ProvenanceStep) =>
  a.kind === "ai" && b.kind === "ai" && a.task === b.task && a.provider === b.provider && a.model === b.model && a.endpoint === b.endpoint && a.outcome === b.outcome;

/** The interview's Provenance so far, with a turn's (`later`): its calls folded, one step per model and Outcome. */
export function foldedProvenance(earlier: Provenance | null, later: Provenance | null): Provenance | null {
  const joined = joinProvenance(earlier, later);
  if (!joined) return null;
  const steps: ProvenanceStep[] = [];
  for (const step of joined.steps) {
    const same = steps.find((kept) => sameCall(kept, step));
    if (!same || same.kind !== "ai" || step.kind !== "ai") {
      steps.push(structuredClone(step));
      continue;
    }
    same.count += step.count;
    same.ms += step.ms;
    if (step.tokens) same.tokens = { input: (same.tokens?.input ?? 0) + step.tokens.input, output: (same.tokens?.output ?? 0) + step.tokens.output };
  }
  return { ...joined, steps };
}
