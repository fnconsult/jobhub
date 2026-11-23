/**
 * A CV change the AI Coach proposes (#719, ADR-0077), reviewed change by change like a Tailored CV (ADR-0006): a list
 * of edits on what the CV already says (rephrase, cut, reorder, put forward), never an item it does not have, never a
 * job's employer or dates, never a figure it does not state. `masterCvReview` tells the edits as the changes the
 * Candidate accepts or rejects one by one (`CvChange`, the Tailored CV Review's), a rephrasing that brings words of the
 * Candidate's Job Offers the CV lacks flagged (a Flagged Change, « Reprend les mots de l'offre »); `acceptedMasterCv`
 * gives the CV with only the changes accepted, sent explicitly, every other keeping what the CV says.
 *
 * The same edits rework a Tailored CV (ADR-0113, #1097): the CV edited is then the Tailored CV (saved, or the proposal
 * under review), and `reference` its Master CV, whose items and figures count as said: an item the Tailored CV cut
 * can be added back.
 *
 * A Declared Fact (ADR-0113): a skill, a language or its level, a diploma the Candidate states in the Coach Conversation
 * (`declared`: their own messages there, never the Job Offer's nor the AI Coach's). It may be added (`add`) or put in
 * place of what the CV says, marked `declared` (« Fait déclaré par vous »). Not in the CV nor declared, it is refused:
 * `not_declared` for an addition or a language level, `added_item` for a skill rephrased into another one.
 * Safe to use in the browser.
 *
 *   const review = masterCvReview(master, edits, { offers, declared });   // { ok, changes, edits } | { ok: false, error }
 *   acceptedMasterCv(master, review.edits, accepted, { declared })        // the next Master CV Version's content
 */
import { jobOfferLanguage, normalise, textLanguage, type DocumentLanguage, type MasterCvContent } from "@jobhub/shared";
import { cvChanges, flagOfferWording, markDeclared, stemOf, withChangesTraced, wordsOf, type CvChange, type CvOrigins } from "../tailored-cv/changes";

export const MASTER_CV_EDIT_KINDS = ["rephrase", "cut", "reorder", "highlight", "add"] as const;
export const MASTER_CV_EDIT_SECTIONS = ["headline", "summary", "experience", "education", "skills", "languages"] as const;
export type ListSection = Exclude<(typeof MASTER_CV_EDIT_SECTIONS)[number], "headline" | "summary">;

/**
 * One edit, as the AI Coach proposes it:
 *  - `rephrase` the headline or summary (`text`), a job (`item`, its new `title` and/or `description`) or a skill (`item`, `text`);
 *  - `cut` an item of a list section;
 *  - `reorder` a list section (`order`: its items named in the new order, the others after them as they were);
 *  - `highlight` an item: put forward, first of its section;
 *  - `rephrase` a language's `level` (`item`, its name): a Declared Fact;
 *  - `add` a skill (`text`), a language (`item`, its name, and its `level`) or a diploma (`text`, its degree, with its
 *    `institution` and `year`): a Declared Fact, or an item of the reference CV the CV does not have.
 * `item` names an item as the Master CV writes it: a job by its title or employer, a diploma by its degree, a skill, a language.
 */
export type MasterCvEdit = {
  kind: (typeof MASTER_CV_EDIT_KINDS)[number];
  section: (typeof MASTER_CV_EDIT_SECTIONS)[number];
  item?: string;
  text?: string;
  title?: string;
  description?: string;
  order?: string[];
  level?: string;
  institution?: string;
  year?: string;
};

/**
 * Why edits make no proposal: an item the Master CV does not have, a skill rephrased into another one or into several
 * (an item added under cover of a rephrasing), a figure it does not state, a text in another language than the Master
 * CV's (a translation by edits leaves its diplomas, languages and dates in its own: half translated), an edit that does
 * not read, or nothing changed.
 */
export type MasterCvReviewRefusal =
  | { ok: false; error: "unknown_item"; item: string }
  | { ok: false; error: "added_item"; text: string }
  | { ok: false; error: "invented_figure"; text: string }
  | { ok: false; error: "translated"; text: string }
  | { ok: false; error: "invalid_edit"; edit: number }
  /** A fact to add or correct (a skill, a language level, a diploma) the CV does not say and the Candidate never declared. */
  | { ok: false; error: "not_declared"; text: string; section: ListSection }
  | { ok: false; error: "no_change" };

export type MasterCvReview = { ok: true; changes: CvChange[]; edits: MasterCvEdit[] } | MasterCvReviewRefusal;

/** Text compared without case, accents nor punctuation. */
const same = (a: string, b: string) => normalise(a) === normalise(b);

/** What names each item of a list section, as the AI Coach may write it. */
const NAMES: { [S in ListSection]: (item: MasterCvContent[S][number]) => string[] } = {
  experience: (job) => [job.title, job.employer, [job.title, job.employer].filter(Boolean).join(" · "), [job.title, job.employer].filter(Boolean).join(" chez ")],
  education: (item) => [item.degree, item.institution, [item.degree, item.institution].filter(Boolean).join(" · ")],
  skills: (skill) => [skill],
  languages: (item) => [item.name],
};

/** The index in the Master CV of the item `name` names, or -1: none or several. */
function indexOf<S extends ListSection>(master: MasterCvContent, section: S, name: string): number {
  const names = NAMES[section] as (item: MasterCvContent[S][number]) => string[];
  const items = master[section] as MasterCvContent[S][number][];
  const found = items.flatMap((item, index) => (names(item).some((each) => each && same(each, name)) ? [index] : []));
  return found.length === 1 ? found[0]! : -1;
}

/** Every text of the Master CV, normalised, as one string, padded so a figure is found as a whole word. */
const masterText = (cv: MasterCvContent) =>
  ` ${normalise([cv.headline, cv.summary, ...cv.skills, ...cv.experience.flatMap((job) => Object.values(job)), ...cv.education.flatMap((item) => Object.values(item)), ...cv.languages.flatMap((item) => Object.values(item))].join(" | "))} `;

/** The language the Master CV is written in, told as for a Job Offer. */
const masterLanguage = (cv: MasterCvContent): DocumentLanguage =>
  jobOfferLanguage({ title: cv.headline, content: [cv.summary, ...cv.experience.flatMap((job) => [job.title, job.description]), ...cv.skills].join(" ") });

const figuresIn = (text: string) => normalise(text).match(/\d+/g) ?? [];

/** A figure the text states that the Master CV does not, each read the same way in both (« +25 % », « 500k€ », « 1er »): a fact it lacks. */
const inventedFigure = (text: string, master: string) => {
  const stated = new Set(figuresIn(master));
  return figuresIn(text).some((figure) => !stated.has(figure));
};

/**
 * How edits are read: `declared`, the Candidate's own messages in the Coach Conversation (a value found in one, as whole
 * words, is a Declared Fact; `true`: checked already, when the card was made); `reference`, the Master CV of the
 * Tailored CV being edited, whose items and figures count as said.
 */
export interface CvEditOptions {
  declared?: readonly string[] | true;
  reference?: MasterCvContent;
}

/**
 * Whether `value` is a Declared Fact: found, as whole words, in one of the Candidate's messages. `of`: the item it qualifies
 * (a language's level, a diploma's institution or year), named in that same message, never a value said of another one.
 */
export function isDeclared(value: string, declared: CvEditOptions["declared"], of?: string): boolean {
  if (declared === true) return true;
  const wanted = normalise(value);
  if (!wanted.trim() || !declared) return false;
  const named = of === undefined ? null : normalise(of);
  return declared.some((message) => normalise(message).includes(wanted) && (named === null || normalise(message).includes(named)));
}

/**
 * The items a CV edit may bring without a Declared Fact (ADR-0113): those of the CV and of its reference, each section on
 * its own. A value is in the CV only on the item it qualifies: a level on that language, an institution or a year on that
 * diploma, a skill in the skills; never a value the CV writes elsewhere (another language's level, a job's year).
 */
interface Known {
  skill(text: string): boolean;
  /** The languages named `name`, in the CV and in its reference: none when it is in neither. */
  languages(name: string): MasterCvContent["languages"];
  /** The diplomas of degree `degree`, in the CV and in its reference. */
  diplomas(degree: string): MasterCvContent["education"];
}

function knownOf(cv: MasterCvContent, reference: MasterCvContent | undefined): Known {
  const both = [cv, ...(reference ? [reference] : [])];
  return {
    skill: (text) => both.some((each) => each.skills.some((skill) => same(skill, text))),
    languages: (name) => both.flatMap((each) => each.languages).filter((item) => same(item.name, name)),
    diplomas: (degree) => both.flatMap((each) => each.education).filter((item) => same(item.degree, degree)),
  };
}

/** What separates the items of a list: a skill rephrased into a list of them adds items. */
const LIST_SEPARATOR = /[,;•·|\n]/;

/**
 * Whether `text` rephrases the skill `skill` (« SAP » → « SAP S/4HANA »): one skill, keeping a word of it; not another skill
 * (« Excel » → « Power BI ») nor several (« SAP » → « SAP, HubSpot, Make »), which would add what the Master CV does not say.
 */
function rephrasesSkill(skill: string, text: string): boolean {
  if (LIST_SEPARATOR.test(text)) return false;
  const words = (each: string) => normalise(each).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2).map(stemOf);
  const kept = new Set(words(skill));
  return words(text).some((word) => kept.has(word));
}

/** The Master CV with `edits` applied, and where each item of its list sections comes from. */
function proposedOf(
  master: MasterCvContent,
  edits: readonly MasterCvEdit[],
  { declared, reference }: CvEditOptions = {},
): { content: MasterCvContent; origins: CvOrigins & { experience: number[] }; facts: string[] } | MasterCvReviewRefusal {
  const said = `${masterText(master)}${reference ? masterText(reference) : ""}`;
  const language = masterLanguage(master);
  /** The Declared Facts the edits bring, as their changes will name them. */
  const facts: string[] = [];
  /** In the CV (or its reference) already, on the item it qualifies: no Declared Fact needed. */
  const known = knownOf(master, reference);
  const content: MasterCvContent = structuredClone(master);
  const origins = {
    experience: master.experience.map((_, index) => index),
    education: master.education.map((_, index) => index),
    skills: master.skills.map((_, index) => index),
    languages: master.languages.map((_, index) => index),
  };
  /** Where the Master CV's item `origin` now is in the proposal. */
  const at = (section: ListSection, origin: number) => origins[section].indexOf(origin);
  const move = (section: ListSection, from: number, to: number) => {
    const list = content[section] as unknown[];
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    const [index] = origins[section].splice(from, 1);
    origins[section].splice(to, 0, index!);
  };

  for (const [position, edit] of edits.entries()) {
    const invalid: MasterCvReviewRefusal = { ok: false, error: "invalid_edit", edit: position };
    if (edit.kind === "add") {
      const added = addOf(edit, content, origins, known, declared);
      if (added === "invalid") return invalid;
      if ("ok" in added) return added;
      facts.push(...added.facts);
      continue;
    }
    const texts = [edit.text, edit.title, edit.description].filter((text): text is string => typeof text === "string");
    const invented = texts.find((text) => inventedFigure(text, said));
    if (invented !== undefined) return { ok: false, error: "invented_figure", text: invented };
    // The Master CV stays in its language: a CV in another one is a Tailored CV in that Document Language.
    const translated = texts.find((text) => (textLanguage(text) ?? language) !== language);
    if (translated !== undefined) return { ok: false, error: "translated", text: translated };

    if (edit.section === "headline" || edit.section === "summary") {
      if (edit.kind !== "rephrase" || edit.text === undefined) return invalid;
      content[edit.section] = edit.text.trim();
      continue;
    }
    const section = edit.section;
    if (edit.kind === "reorder") {
      if (!edit.order?.length) return invalid;
      const named: number[] = [];
      for (const name of edit.order) {
        const origin = indexOf(master, section, name);
        if (origin < 0) return { ok: false, error: "unknown_item", item: name };
        if (at(section, origin) >= 0 && !named.includes(origin)) named.push(origin);
      }
      named.forEach((origin, place) => move(section, at(section, origin), place));
      continue;
    }
    if (!edit.item) return invalid;
    const origin = indexOf(master, section, edit.item);
    if (origin < 0) return { ok: false, error: "unknown_item", item: edit.item };
    const place = at(section, origin);
    if (place < 0) return { ok: false, error: "unknown_item", item: edit.item };
    if (edit.kind === "cut") {
      (content[section] as unknown[]).splice(place, 1);
      origins[section].splice(place, 1);
    } else if (edit.kind === "highlight") {
      move(section, place, 0);
    } else if (section === "experience") {
      if (edit.title === undefined && edit.description === undefined) return invalid;
      const job = content.experience[place]!;
      // A job keeps its employer, place and dates: what names it.
      content.experience[place] = { ...job, ...(edit.title !== undefined ? { title: edit.title.trim() } : {}), ...(edit.description !== undefined ? { description: edit.description.trim() } : {}) };
    } else if (section === "skills") {
      if (!edit.text?.trim()) return invalid;
      const text = edit.text.trim();
      if (!rephrasesSkill(master.skills[origin]!, text)) {
        // Another skill: only one the CV (or its reference) has, or one the Candidate declared (ADR-0113).
        if (LIST_SEPARATOR.test(text) || !(known.skill(text) || isDeclared(text, declared))) return { ok: false, error: "added_item", text };
        if (!known.skill(text)) facts.push(text);
      }
      content.skills[place] = text;
    } else if (section === "languages" && edit.level?.trim()) {
      // A language's level corrected: a Declared Fact (« mon anglais est C1 »), or the level its reference says.
      const level = edit.level.trim();
      const name = master.languages[origin]!.name;
      const stated = known.languages(name).some((item) => same(item.level, level));
      if (!stated && !isDeclared(level, declared, name)) return { ok: false, error: "not_declared", text: level, section };
      if (!stated) facts.push(level);
      content.languages[place] = { ...content.languages[place]!, level };
    } else {
      // A diploma or a language is cut, reordered or put forward, never reworded.
      return invalid;
    }
  }
  return { content, origins, facts };
}

/**
 * An `add` edit applied to `content`: a skill, a language or a diploma at the end of its section, from nowhere in the CV
 * (`origins` -1). In the CV already, nothing; in its reference, added as it says it; else only a Declared Fact, each
 * value that qualifies the item (a level, an institution, a year) declared of it.
 */
function addOf(
  edit: MasterCvEdit,
  content: MasterCvContent,
  origins: Record<ListSection, number[]>,
  known: Known,
  declared: CvEditOptions["declared"],
): { facts: string[] } | MasterCvReviewRefusal | "invalid" {
  /** Each value, with whether the CV says it of the item, and the item it qualifies (none for the item's own name). */
  type Value = { value: string; stated: boolean; of?: string };
  const check = (section: ListSection, values: Value[]): { facts: string[] } | MasterCvReviewRefusal => {
    const facts: string[] = [];
    for (const { value, stated, of } of values.filter((each) => each.value)) {
      if (stated) continue;
      if (!isDeclared(value, declared, of)) return { ok: false, error: "not_declared", text: value, section };
      facts.push(value);
    }
    return { facts };
  };
  const has = (values: string[], value: string) => values.some((each) => same(each, value));
  switch (edit.section) {
    case "skills": {
      const text = edit.text?.trim();
      if (!text || LIST_SEPARATOR.test(text)) return "invalid";
      if (has(content.skills, text)) return { facts: [] };
      const checked = check("skills", [{ value: text, stated: known.skill(text) }]);
      if (!("ok" in checked)) {
        content.skills.push(text);
        origins.skills.push(-1);
      }
      return checked;
    }
    case "languages": {
      const name = (edit.item ?? edit.text)?.trim();
      if (!name) return "invalid";
      if (has(content.languages.map((each) => each.name), name)) return "invalid";
      const level = edit.level?.trim() ?? "";
      const items = known.languages(name);
      const checked = check("languages", [
        { value: name, stated: items.length > 0 },
        { value: level, stated: items.some((item) => same(item.level, level)), of: name },
      ]);
      if (!("ok" in checked)) {
        content.languages.push({ name, level });
        origins.languages.push(-1);
      }
      return checked;
    }
    case "education": {
      const degree = edit.text?.trim();
      if (!degree) return "invalid";
      if (has(content.education.map((each) => each.degree), degree)) return { facts: [] };
      const institution = edit.institution?.trim() ?? "";
      const year = edit.year?.trim() ?? "";
      const items = known.diplomas(degree);
      const checked = check("education", [
        { value: degree, stated: items.length > 0 },
        { value: institution, stated: items.some((item) => same(item.institution, institution)), of: degree },
        { value: year, stated: items.some((item) => same(item.year, year)), of: degree },
      ]);
      if (!("ok" in checked)) {
        content.education.push({ degree, institution, year });
        origins.education.push(-1);
      }
      return checked;
    }
    default:
      return "invalid";
  }
}


/**
 * The changes `edits` make to the Master CV, for the Candidate to review one by one: none added, a rephrasing that brings
 * words of `offers` (the Candidate's Job Offers) the Master CV lacks flagged with them (`fromOffer`).
 */
export function masterCvReview(master: MasterCvContent, edits: readonly MasterCvEdit[], { offers = [], ...options }: { offers?: readonly string[] } & CvEditOptions = {}): MasterCvReview {
  const proposed = proposedOf(master, edits, options);
  if ("ok" in proposed) return proposed;
  const masterStems = new Set(wordsOf(`${masterText(master)}${options.reference ? masterText(options.reference) : ""}`).map(stemOf));
  const offerStems = [...new Set(wordsOf(offers.join(" ")).map(stemOf))].filter((stem) => !masterStems.has(stem));
  const changes = markDeclared(flagOfferWording(cvChanges(master, proposed.content, proposed.origins), offerStems), proposed.facts);
  if (changes.length === 0) return { ok: false, error: "no_change" };
  return { ok: true, changes, edits: [...edits] };
}

/**
 * The Master CV with only the changes `accepted` (by `CvChange.id`, as sent with « Enregistrer »): every other keeps
 * what the Master CV says; an id that names no change changes nothing. Edits that no longer read keep it as it is.
 * `options`: as the review was made (`declared: true` once its Declared Facts were checked, when the card was made).
 */
export function acceptedMasterCv(master: MasterCvContent, edits: readonly MasterCvEdit[], accepted: Iterable<string>, options: CvEditOptions = {}): MasterCvContent {
  return acceptedCvEdits(master, edits, accepted, options)?.content ?? master;
}

/**
 * As `acceptedMasterCv`, for any CV edited (a Tailored CV, ADR-0113), with where each item of its list sections comes from
 * in it (-1: added); null when the edits no longer read.
 */
export function acceptedCvEdits(cv: MasterCvContent, edits: readonly MasterCvEdit[], accepted: Iterable<string>, options: CvEditOptions = {}): { content: MasterCvContent; origins: Required<CvOrigins> } | null {
  const proposed = proposedOf(cv, edits, options);
  if ("ok" in proposed) return null;
  return withChangesTraced(cv, proposed.content, accepted, proposed.origins);
}
