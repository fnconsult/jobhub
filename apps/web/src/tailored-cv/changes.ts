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
 * Each is accepted or rejected by the Candidate; only the accepted ones are saved (`withChanges`).
 * `fromOffer`: the words a rephrasing takes from the Job Offer that the Master CV does not say, for the
 * Candidate to check (ADR-0006, #68); absent when there are none.
 */
export interface CvChange {
  /** Names the change in its proposal, for the Candidate to accept it (see `withChanges`). */
  id: string;
  section: CvSection;
  kind: "rephrased" | "reordered" | "cut" | "added";
  item?: string;
  master?: string;
  tailored?: string;
  fromOffer?: string[];
}

/**
 * Words shorter than this, and these common ones, say nothing a CV could invent: function words (and the
 * fragments elision leaves, as "jusqu" of "jusqu'à"), and the everyday words of a job offer (its verbs,
 * adjectives and nouns that state no skill or fact: "membre", "forte", "travailler"…). Normalised.
 */
const MIN_WORD = 5;
const COMMON = new Set(
  [
    // French function words and elided fragments.
    "avoir etre faire votre notre leurs nous vous comme entre toute toutes tous dans avec pour sans sous chez plus moins tres aussi ainsi alors apres avant depuis selon cette celle ceux celles leur dont mais donc",
    "jusqu lorsqu puisqu quoiqu quelqu presqu aujourd autre autres meme memes chaque plusieurs certain certains certaine certaines quelque quelques beaucoup toujours souvent encore ensemble notamment egalement afin enfin quand lequel laquelle lesquels lesquelles auquel duquel celui ceci cela etant serez seront serait avez avons pouvez peuvent doivent devez devrez",
    // French everyday words of a job offer.
    "membre membres forte fortes forts grande grandes grand grands nouvelle nouvelles nouveau nouveaux bonne bonnes excellent excellente excellents excellentes solide solides reelle reelles veritable vraie vraies",
    "capacite capacites qualite qualites aisance envie esprit appetence rigueur",
    "travailler travaillez travail rejoindre rejoignez integrer integrez participer participez contribuer contribuez permettre souhaitez souhaite souhaitee recherchons recherche recrutons recrute rattache rattachee",
    "poste postes mission missions profil candidat candidate candidats entreprise societe structure environnement contexte cadre sein ideal idealement minimum annee annees experience experiences confirme confirmee confirmes confirmees reconnu reconnue averee avere significative significatif requis requise souhaitable apprecie appreciee indispensable",
    // English function words.
    "about after before their there these those which where while would could should other being within without through under your yours with from have that this will they them than then also into over such more most very each",
    // English everyday words of a job offer.
    "member members strong great good excellent solid proven ability abilities willing working work join joining looking seeking ideal ideally years experience experienced required preferred position candidate company environment",
  ]
    .join(" ")
    .split(" "),
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
    // A word cut short by an elision ("jusqu'", "lorsqu'") is no word of its own.
    const fromOffer = (change.tailored.match(/[\p{L}\p{N}]+(?!['’\p{L}\p{N}])/gu) ?? []).filter((token) => {
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

/** How a list section of the Tailored CV is told against the Master CV's. */
interface ListSection<T> {
  section: Exclude<CvSection, "headline" | "summary">;
  /** Names an item of the Master CV when no `origins` say where it went. */
  key: (item: T) => string;
  label: (item: T) => string;
  /** The text a rephrasing changes. */
  text: (item: T) => string;
}

const LIST_SECTIONS = {
  experience: { section: "experience", key: jobKey, label: jobLabel, text: jobText } satisfies ListSection<CvExperience>,
  education: { section: "education", key: educationLabel, label: educationLabel, text: educationLabel } satisfies ListSection<CvEducation>,
  skills: { section: "skills", key: (skill) => skill, label: (skill) => skill, text: (skill) => skill } satisfies ListSection<string>,
  languages: { section: "languages", key: languageLabel, label: languageLabel, text: languageLabel } satisfies ListSection<CvLanguage>,
};

/**
 * Where each item of `tailored` comes from: its index in `master`, or -1 when added.
 * `origins[i]` is the index in `master` of `tailored[i]`; without it, an item comes from the Master CV's with the same `key`.
 */
function align<T>(master: T[], tailored: T[], key: (item: T) => string, origins?: number[]): number[] {
  const used = new Set<number>();
  return tailored.map((item, index) => {
    const origin = origins ? (origins[index] ?? -1) : master.findIndex((option, position) => !used.has(position) && key(option) === key(item));
    if (origin < 0 || origin >= master.length || used.has(origin)) return -1;
    used.add(origin);
    return origin;
  });
}

/** Ids of a change: stable for one proposal, whatever the Candidate answers. A rephrased or cut item is named by its index in the Master CV. */
const changeId = {
  rephrased: (section: CvSection, origin?: number) => (origin === undefined ? `${section}.rephrased` : `${section}.rephrased.${origin}`),
  cut: (section: CvSection, origin: number) => `${section}.cut.${origin}`,
  reordered: (section: CvSection) => `${section}.reordered`,
  added: (section: CvSection, item: string) => `${section}.added.${item}`,
};

/** The changes of a list section: items rephrased, cut, kept in another order, or added. */
function listChanges<T>({ section, key, label, text }: ListSection<T>, master: T[], tailored: T[], origins?: number[]): CvChange[] {
  const from = align(master, tailored, key, origins);
  const changes: CvChange[] = [];
  // In the Master CV's order.
  master.forEach((original, origin) => {
    const adapted = tailored[from.indexOf(origin)];
    if (adapted === undefined || text(adapted) === text(original)) return;
    changes.push({ id: changeId.rephrased(section, origin), section, kind: "rephrased", item: label(original), master: text(original), tailored: text(adapted) });
  });
  master.forEach((item, origin) => {
    if (!from.includes(origin)) changes.push({ id: changeId.cut(section, origin), section, kind: "cut", item: label(item) });
  });
  const kept = from.filter((origin) => origin >= 0);
  if (kept.some((origin, index) => index > 0 && origin < kept[index - 1]!)) {
    changes.push({
      id: changeId.reordered(section),
      section,
      kind: "reordered",
      master: [...kept].sort((a, b) => a - b).map((origin) => label(master[origin]!)).join("\n"),
      tailored: tailored.filter((_, index) => from[index]! >= 0).map(label).join("\n"),
    });
  }
  tailored.forEach((item, index) => {
    if (from[index]! < 0) changes.push({ id: changeId.added(section, label(item)), section, kind: "added", item: label(item) });
  });
  return changes;
}

/** A list section with only the `accepted` changes: a rejected one keeps the Master CV's item, place or absence. */
function listWithChanges<T>({ section, key, label }: ListSection<T>, master: T[], tailored: T[], accepted: Set<string>, origins?: number[]): T[] {
  const from = align(master, tailored, key, origins);
  const items: { origin: number; item: T }[] = [];
  tailored.forEach((item, index) => {
    const origin = from[index]!;
    if (origin >= 0) items.push({ origin, item: accepted.has(changeId.rephrased(section, origin)) ? item : master[origin]! });
    else if (accepted.has(changeId.added(section, label(item)))) items.push({ origin, item });
  });
  if (!accepted.has(changeId.reordered(section))) {
    // The Master CV's items back in its order, in the places they take.
    const places = items.flatMap((entry, index) => (entry.origin >= 0 ? [index] : []));
    const inOrder = places.map((index) => items[index]!).sort((a, b) => a.origin - b.origin);
    places.forEach((place, index) => (items[place] = inOrder[index]!));
  }
  master.forEach((item, origin) => {
    if (from.includes(origin) || accepted.has(changeId.cut(section, origin))) return;
    // Back after the item it followed in the Master CV, else before the first one kept.
    const before = items.reduce((found, entry, index) => (entry.origin >= 0 && entry.origin < origin && (found < 0 || entry.origin > items[found]!.origin) ? index : found), -1);
    const first = items.findIndex((entry) => entry.origin >= 0);
    items.splice(before >= 0 ? before + 1 : Math.max(first, 0), 0, { origin, item });
  });
  return items.map((entry) => entry.item);
}

/** Every change of `tailored` against `master`, in the order of the CV's sections. `origins`: see CvOrigins. */
export function cvChanges(master: CvContent, tailored: CvContent, origins?: CvOrigins): CvChange[] {
  const changes: CvChange[] = [];
  for (const section of ["headline", "summary"] as const) {
    if (master[section] !== tailored[section]) changes.push({ id: changeId.rephrased(section), section, kind: "rephrased", master: master[section], tailored: tailored[section] });
  }
  changes.push(...listChanges(LIST_SECTIONS.experience, master.experience, tailored.experience));
  changes.push(...listChanges(LIST_SECTIONS.education, master.education, tailored.education, origins?.education));
  changes.push(...listChanges(LIST_SECTIONS.skills, master.skills, tailored.skills, origins?.skills));
  changes.push(...listChanges(LIST_SECTIONS.languages, master.languages, tailored.languages, origins?.languages));
  return changes;
}

/**
 * `tailored` with only the changes the Candidate accepted (by `CvChange.id`, as `cvChanges` gives them):
 * every other one keeps what the Master CV says (ADR-0006). An id that names no change changes nothing.
 */
export function withChanges(master: CvContent, tailored: CvContent, accepted: Iterable<string>, origins?: CvOrigins): CvContent {
  const ok = new Set(accepted);
  const rephrased = (section: "headline" | "summary") => (ok.has(changeId.rephrased(section)) ? tailored[section] : master[section]);
  return {
    ...tailored,
    headline: rephrased("headline"),
    summary: rephrased("summary"),
    experience: listWithChanges(LIST_SECTIONS.experience, master.experience, tailored.experience, ok),
    education: listWithChanges(LIST_SECTIONS.education, master.education, tailored.education, ok, origins?.education),
    skills: listWithChanges(LIST_SECTIONS.skills, master.skills, tailored.skills, ok, origins?.skills),
    languages: listWithChanges(LIST_SECTIONS.languages, master.languages, tailored.languages, ok, origins?.languages),
  };
}
