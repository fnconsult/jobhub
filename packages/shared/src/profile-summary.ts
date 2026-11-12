/**
 * The summary of a Profile at the end of its onboarding (#1004, ADR-0106): « Voici comment je comprends ce que vous
 * recherchez. Ai-je bien compris ? », then a paragraph in plain words, composed by Jobbbox from the Profile itself, not by
 * an AI, so it can say nothing that no answer said (ADR-0006). The key items are strong: the target role, the contract
 * types, the places, remote work, the minimum salary, the years of experience (the span of the dated jobs, as the Match
 * Score reads seniority), the main skills and the latest roles. A criterion the Profile does not have is left out.
 *
 * Pure: the same Profile, language and day give the same parts. Imported as `@jobhub/shared/profile-summary`, not from the
 * package's root export: it reads the i18n locales (JSON), as `sign-in-providers` does.
 */
import type { ContractType, MasterCvContent, RemoteWork, SearchCriteria } from "./domain";
import { createI18n, type Locale } from "./i18n";
import { periodYears, yearsOfExperience } from "./match-score";

/** One run of the paragraph: plain text, or a key item, shown strong. */
export interface SummaryPart {
  text: string;
  strong?: true;
}

/** What the summary is composed from: the Profile's Search Criteria and its Master CV, as far as they are known. */
export interface ProfileSummaryInput {
  searchCriteria: Partial<SearchCriteria>;
  masterCv: Pick<MasterCvContent, "experience" | "skills">;
}

/** The skills named, the first ones the Master CV lists: its main ones. */
export const SUMMARY_SKILLS = 4;
/** The latest roles named. */
export const SUMMARY_ROLES = 2;

/** Where a slot's parts go in a translated template: control characters no text or translation holds. */
const OPEN = "\u0002";
const CLOSE = "\u0003";
const SLOT = new RegExp(`${OPEN}(\\w+)${CLOSE}`, "g");
const slot = (name: string) => `${OPEN}${name}${CLOSE}`;

/** French elides « de » before a vowel: « un poste d'Analyste ». */
const VOWEL = /^[aeiouyàâäéèêëîïôöùûüÿæœ]/i;

const i18ns = new Map<Locale, ReturnType<typeof createI18n>>();
function translator(locale: Locale) {
  let instance = i18ns.get(locale);
  if (!instance) {
    instance = createI18n(locale);
    i18ns.set(locale, instance);
  }
  return instance.t;
}

/**
 * The summary's paragraph, in `locale`, as parts to render (strong ones in bold); none when the Profile says nothing yet.
 * `today` dates an ongoing job (« 2018 – aujourd'hui »).
 */
export function profileSummary(profile: ProfileSummaryInput, { locale, today = new Date() }: { locale: Locale; today?: Date }): SummaryPart[] {
  const t = translator(locale);
  const { searchCriteria: criteria, masterCv } = profile;

  /** A translated template, its slots filled with parts. */
  const fill = (template: string, slots: Record<string, SummaryPart[]>): SummaryPart[] =>
    template.split(SLOT).flatMap((piece, index) => (index % 2 === 1 ? (slots[piece] ?? []) : piece ? [{ text: piece }] : []));
  const strong = (text: string): SummaryPart[] => [{ text, strong: true }];
  /** « A, B ou C » / « A, B, or C »: each item as given, the words between them plain. */
  const list = (items: SummaryPart[][], words: "or" | "and"): SummaryPart[] => {
    const two = t(`profileSummary.${words}.two`);
    const last = t(`profileSummary.${words}.last`);
    return items.flatMap((item, index) => {
      if (index === 0) return item;
      const between = index < items.length - 1 ? ", " : items.length === 2 ? two : last;
      return [{ text: between }, ...item];
    });
  };

  const sentences: SummaryPart[][] = [];

  // The search: the role, the contracts, the places, remote work and the salary.
  const role = criteria.targetRole?.trim() ?? "";
  const contracts = criteria.contractTypes ?? [];
  const places = (criteria.locations ?? []).map((place) => place.trim()).filter(Boolean);
  const remote = criteria.remoteWorkOptions ?? [];
  const salary = criteria.minSalary;
  const hasSalary = typeof salary === "number" && Number.isFinite(salary) && salary > 0;
  if (role || contracts.length > 0 || places.length > 0 || remote.length > 0 || hasSalary) {
    const search = role
      ? fill(locale === "fr" && VOWEL.test(role) ? t("profileSummary.searchElided", { role: slot("role") }) : t("profileSummary.search", { role: slot("role") }), {
          role: strong(role),
        })
      : [{ text: t("profileSummary.searchWithoutRole") }];
    const sentence = [...search];
    if (contracts.length > 0)
      sentence.push(
        ...fill(t("profileSummary.contracts", { contracts: slot("contracts") }), {
          contracts: list(
            contracts.map((type: ContractType) => strong(t(`profileSummary.contractTypes.${type}`))),
            "or",
          ),
        }),
      );
    if (places.length > 0)
      // Named, not placed with a preposition: « à Lyon », but « en Île-de-France », « dans le Rhône »; the text is the Candidate's.
      sentence.push(...fill(t("profileSummary.locations", { count: places.length, locations: slot("locations") }), { locations: list(places.map(strong), "or") }));
    if (remote.length > 0)
      sentence.push(
        ...fill(t("profileSummary.remote", { remote: slot("remote") }), {
          remote: list(
            remote.map((option: RemoteWork) => strong(t(`profileSummary.remoteWorkOptions.${option}`))),
            "or",
          ),
        }),
      );
    if (hasSalary) sentence.push(...fill(t("profileSummary.salary", { salary: slot("salary") }), { salary: strong(euros(salary, locale)) }));
    sentence.push({ text: t("profileSummary.end") });
    sentences.push(sentence);
  }

  // The experience and the main skills.
  const span = yearsOfExperience(masterCv, today);
  const years = span !== undefined && span >= 1 ? span : undefined;
  const skills = distinct(masterCv.skills).slice(0, SUMMARY_SKILLS);
  const skillParts = list(skills.map(strong), "and");
  const yearParts = years === undefined ? [] : strong(t("profileSummary.years", { count: years }));
  if (years !== undefined && skills.length > 0)
    sentences.push(
      fill(t("profileSummary.experienceAndSkills", { count: skills.length, years: slot("years"), skills: slot("skills") }), { years: yearParts, skills: skillParts }),
    );
  else if (years !== undefined) sentences.push(fill(t("profileSummary.experience", { years: slot("years") }), { years: yearParts }));
  else if (skills.length > 0) sentences.push(fill(t("profileSummary.skills", { count: skills.length, skills: slot("skills") }), { skills: skillParts }));

  // The latest roles: the most recently dated first, then the undated ones in the CV's order.
  const roles = latestRoles(masterCv.experience, today).slice(0, SUMMARY_ROLES);
  if (roles.length > 0) {
    const items = roles.map(({ title, employer }) =>
      employer ? fill(t("profileSummary.roleAt", { title: slot("title"), employer: slot("employer") }), { title: strong(title), employer: [{ text: employer }] }) : strong(title),
    );
    sentences.push(fill(t("profileSummary.latestRoles", { count: roles.length, roles: slot("roles") }), { roles: list(items, "and") }));
  }

  return sentences.flatMap((sentence, index) => (index === 0 ? sentence : [{ text: " " }, ...sentence]));
}

/** The summary as plain text: its parts joined, nothing strong. */
export function summaryText(parts: readonly SummaryPart[]): string {
  return parts.map((part) => part.text).join("");
}

/** « 75 000 € » / « €75,000 »: a whole number of euros. */
function euros(amount: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : "fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(amount);
}

/** Each text once, trimmed, blanks left out, in the order given (compared without case). */
function distinct(texts: readonly string[]): string[] {
  const seen = new Set<string>();
  return texts
    .map((text) => text.trim())
    .filter((text) => {
      const key = text.toLowerCase();
      if (!text || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** The jobs with a title, the one ending latest first (an ongoing one ends today); the undated ones after, in order. */
function latestRoles(experience: MasterCvContent["experience"], today: Date): { title: string; employer: string }[] {
  return experience
    .map((job, index) => ({ title: job.title.trim(), employer: job.employer.trim(), index, end: Math.max(-Infinity, ...periodYears(job.period, today)) }))
    .filter((job) => job.title)
    .sort((a, b) => b.end - a.end || a.index - b.index)
    .map(({ title, employer }) => ({ title, employer }));
}
