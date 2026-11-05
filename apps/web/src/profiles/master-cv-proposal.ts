/**
 * A Master CV change the AI Coach proposes (#719, ADR-0077), reviewed change by change like a Tailored CV (ADR-0006):
 * a list of edits on what the Master CV already says (rephrase, cut, reorder, put forward), never an item it does not
 * have, never a job's employer or dates, never a figure it does not state. `masterCvReview` tells the edits as the
 * changes the Candidate accepts or rejects one by one (`CvChange`, the Tailored CV Review's), a rephrasing that brings
 * words of the Candidate's Job Offers the Master CV lacks flagged (a Flagged Change); `acceptedMasterCv` gives the
 * Master CV with only the changes accepted, sent explicitly, every other keeping what the Master CV says.
 * Safe to use in the browser.
 *
 *   const review = masterCvReview(master, edits, { offers });   // { ok, changes, edits } | { ok: false, error }
 *   acceptedMasterCv(master, review.edits, accepted)            // the next Master CV Version's content
 */
import { normalise, type MasterCvContent } from "@jobhub/shared";
import { cvChanges, flagOfferWording, stemOf, withChanges, wordsOf, type CvChange, type CvOrigins } from "../tailored-cv/changes";

export const MASTER_CV_EDIT_KINDS = ["rephrase", "cut", "reorder", "highlight"] as const;
export const MASTER_CV_EDIT_SECTIONS = ["headline", "summary", "experience", "education", "skills", "languages"] as const;
type ListSection = Exclude<(typeof MASTER_CV_EDIT_SECTIONS)[number], "headline" | "summary">;

/**
 * One edit, as the AI Coach proposes it:
 *  - `rephrase` the headline or summary (`text`), a job (`item`, its new `title` and/or `description`) or a skill (`item`, `text`);
 *  - `cut` an item of a list section;
 *  - `reorder` a list section (`order`: its items named in the new order, the others after them as they were);
 *  - `highlight` an item: put forward, first of its section.
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
};

/** Why edits make no proposal: an item the Master CV does not have, a figure it does not state, an edit that does not read, or nothing changed. */
export type MasterCvReviewRefusal =
  | { ok: false; error: "unknown_item"; item: string }
  | { ok: false; error: "invented_figure"; text: string }
  | { ok: false; error: "invalid_edit"; edit: number }
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

/** A figure the text states that the Master CV does not: a fact it lacks. */
const inventedFigure = (text: string, master: string) => (normalise(text).match(/\d+/g) ?? []).some((figure) => !master.includes(` ${figure} `));

/** The Master CV with `edits` applied, and where each item of its list sections comes from. */
function proposedOf(master: MasterCvContent, edits: readonly MasterCvEdit[]): { content: MasterCvContent; origins: CvOrigins & { experience: number[] } } | MasterCvReviewRefusal {
  const said = masterText(master);
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
    const texts = [edit.text, edit.title, edit.description].filter((text): text is string => typeof text === "string");
    const invented = texts.find((text) => inventedFigure(text, said));
    if (invented !== undefined) return { ok: false, error: "invented_figure", text: invented };

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
      content.skills[place] = edit.text.trim();
    } else {
      // A diploma or a language is cut, reordered or put forward, never reworded.
      return invalid;
    }
  }
  return { content, origins };
}

/**
 * The changes `edits` make to the Master CV, for the Candidate to review one by one: none added, a rephrasing that brings
 * words of `offers` (the Candidate's Job Offers) the Master CV lacks flagged with them (`fromOffer`).
 */
export function masterCvReview(master: MasterCvContent, edits: readonly MasterCvEdit[], { offers = [] }: { offers?: readonly string[] } = {}): MasterCvReview {
  const proposed = proposedOf(master, edits);
  if ("ok" in proposed) return proposed;
  const masterStems = new Set(wordsOf(masterText(master)).map(stemOf));
  const offerStems = [...new Set(wordsOf(offers.join(" ")).map(stemOf))].filter((stem) => !masterStems.has(stem));
  const changes = flagOfferWording(cvChanges(master, proposed.content, proposed.origins), offerStems);
  if (changes.length === 0) return { ok: false, error: "no_change" };
  return { ok: true, changes, edits: [...edits] };
}

/**
 * The Master CV with only the changes `accepted` (by `CvChange.id`, as sent with « Enregistrer »): every other keeps
 * what the Master CV says; an id that names no change changes nothing. Edits that no longer read keep it as it is.
 */
export function acceptedMasterCv(master: MasterCvContent, edits: readonly MasterCvEdit[], accepted: Iterable<string>): MasterCvContent {
  const proposed = proposedOf(master, edits);
  if ("ok" in proposed) return master;
  return withChanges(master, proposed.content, accepted, proposed.origins);
}
