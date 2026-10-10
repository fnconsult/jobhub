/** What a Tailored CV changes in its Master CV, section by section, for the Candidate's review. Safe to use in the browser. */
import { normalise, type CvContent, type CvEducation, type CvExperience, type CvLanguage } from "@jobhub/shared";

export const CV_SECTIONS = ["headline", "summary", "experience", "education", "skills", "languages"] as const;
export type CvSection = (typeof CV_SECTIONS)[number];

/**
 * One change of a Tailored CV against its Master CV:
 *  - "rephrased": `master` and `tailored` give the text before and after (for a job, its title then its description;
 *    for a diploma, language or skill, as `item` names it);
 *  - "reordered": the section's items are in another order; `master` and `tailored` list them before and after, one per line;
 *  - "cut": `item` is left out;
 *  - "added": `item` is a requirement the Candidate confirmed.
 * `item` names a job, diploma, skill or language as the Master CV writes it.
 * `fromOffer`: the words a rephrasing takes from the Job Offer that the Master CV does not say, for the
 * Candidate to check (ADR-0006, #68); absent when there are none.
 */
export interface CvChange {
  section: CvSection;
  kind: "rephrased" | "reordered" | "cut" | "added";
  item?: string;
  master?: string;
  tailored?: string;
  fromOffer?: string[];
}

/** Words shorter than this, and these common ones, say nothing a CV could invent. */
const MIN_WORD = 5;
const COMMON = new Set(
  "avoir etre faire votre notre leurs nous vous comme entre toute toutes tous dans avec pour sans sous chez plus moins tres aussi ainsi alors apres avant depuis selon cette celle ceux celles leur dont mais donc about after before their there these those which where while would could should other being within without through under your yours with from have that this will they them than then also into over such more most very each".split(" "),
);

/** A word's stem, so "omnicanal" and "omnicanales" are one word. */
export const stemOf = (word: string) => word.slice(0, 7);

/** The meaningful words of a text, normalised (lower case, no accents), each once. */
export function wordsOf(text: string): string[] {
  return [...new Set(normalise(text).split(" ").filter((word) => word.length >= MIN_WORD && !COMMON.has(word)))];
}

/** Each rephrasing with the words it takes from `offerStems` (the stems of the Job Offer's words the Master CV lacks). */
export function flagOfferWording(changes: CvChange[], offerStems: string[]): CvChange[] {
  if (offerStems.length === 0) return changes;
  const offer = new Set(offerStems);
  return changes.map((change) => {
    if (change.kind !== "rephrased" || !change.tailored) return change;
    // As the rephrasing writes them, each once.
    const seen = new Set<string>();
    const fromOffer = (change.tailored.match(/[\p{L}\p{N}]+/gu) ?? []).filter((token) => {
      const [word] = wordsOf(token);
      if (!word || seen.has(word) || !offer.has(stemOf(word))) return false;
      seen.add(word);
      return true;
    });
    return fromOffer.length ? { ...change, fromOffer } : change;
  });
}

/** Where each diploma, skill and language of a Tailored CV comes from: its index in the Master CV. One beyond them is added. */
export interface CvOrigins {
  education: number[];
  skills: number[];
  languages: number[];
}

const jobLabel = (job: CvExperience) => [job.title, job.employer, job.period].filter(Boolean).join(" · ");
const jobText = (job: CvExperience) => [job.title, job.description].filter(Boolean).join("\n");
const jobKey = (job: CvExperience) => `${job.employer}\u0000${job.period}`;
const educationLabel = (item: CvEducation) => [item.degree, item.institution, item.year].filter(Boolean).join(" · ");
const languageLabel = (item: CvLanguage) => [item.name, item.level].filter(Boolean).join(" · ");

/**
 * The changes of a list section: items cut, rephrased (unless `rephrasing` is false), kept in another order, or added.
 * `origins[i]` is the index in `master` of `tailored[i]`; without it, an item comes from the Master CV's with the same `key`.
 */
function listChanges<T>(section: CvSection, master: T[], tailored: T[], key: (item: T) => string, label: (item: T) => string, origins?: number[], rephrasing = true): CvChange[] {
  const used = new Set<number>();
  const from = tailored.map((item, index) => {
    const origin = origins ? (origins[index] ?? -1) : master.findIndex((option, position) => !used.has(position) && key(option) === key(item));
    if (origin < 0 || origin >= master.length || used.has(origin)) return -1;
    used.add(origin);
    return origin;
  });
  const changes: CvChange[] = master.filter((_, index) => !used.has(index)).map((item) => ({ section, kind: "cut", item: label(item) }));
  if (rephrasing) {
    tailored.forEach((item, index) => {
      const original = master[from[index]!];
      if (original !== undefined && label(original) !== label(item)) changes.push({ section, kind: "rephrased", item: label(original), master: label(original), tailored: label(item) });
    });
  }
  const kept = from.filter((origin) => origin >= 0);
  if (kept.some((origin, index) => index > 0 && origin < kept[index - 1]!)) {
    changes.push({
      section,
      kind: "reordered",
      master: [...kept].sort((a, b) => a - b).map((origin) => label(master[origin]!)).join("\n"),
      tailored: tailored.filter((_, index) => from[index]! >= 0).map(label).join("\n"),
    });
  }
  changes.push(...tailored.filter((_, index) => from[index]! < 0).map((item): CvChange => ({ section, kind: "added", item: label(item) })));
  return changes;
}

/** Every change of `tailored` against `master`, in the order of the CV's sections. `origins`: see CvOrigins. */
export function cvChanges(master: CvContent, tailored: CvContent, origins?: CvOrigins): CvChange[] {
  const changes: CvChange[] = [];
  for (const section of ["headline", "summary"] as const) {
    if (master[section] !== tailored[section]) changes.push({ section, kind: "rephrased", master: master[section], tailored: tailored[section] });
  }
  for (const job of master.experience) {
    const adapted = tailored.experience.find((option) => jobKey(option) === jobKey(job));
    if (adapted && jobText(adapted) !== jobText(job)) changes.push({ section: "experience", kind: "rephrased", item: jobLabel(job), master: jobText(job), tailored: jobText(adapted) });
  }
  // A job's rephrasing is told above, title and description together.
  changes.push(...listChanges("experience", master.experience, tailored.experience, jobKey, jobLabel, undefined, false));
  changes.push(...listChanges("education", master.education, tailored.education, educationLabel, educationLabel, origins?.education));
  changes.push(...listChanges("skills", master.skills, tailored.skills, (skill) => skill, (skill) => skill, origins?.skills));
  changes.push(...listChanges("languages", master.languages, tailored.languages, languageLabel, languageLabel, origins?.languages));
  return changes;
}
