/**
 * Reading the job page the person is viewing, in their own browser (ADR-0002):
 * whether it is a job posting (to offer "Analyser cette offre"), and the Job
 * Offer a Capture would send.
 *
 * `readJobPage(snapshot)` is the whole interface. A page is detected when it
 * publishes exactly one schema.org JobPosting, or when its URL is a posting on
 * a major job board or career site (KNOWN_POSTING_PAGES). A Capture uses the
 * JobPosting when there is one, and otherwise takes the page as it reads, so a
 * manual Capture works on any page.
 */
import { CONTRACT_TYPES, type ContractType, type JobOffer, type SalaryRange } from "@jobhub/shared";

/** What the content script reads from the page (see `snapshotPage`). */
export interface PageSnapshot {
  url: string;
  /** The document's title. */
  title: string;
  /** The page's first heading (h1), if any. */
  heading?: string;
  /** The site's name (og:site_name), if the page gives it. */
  siteName?: string;
  /** The text of each JSON-LD script on the page. */
  structuredData: string[];
  /** The page's visible text. */
  text: string;
}

/** A Job Offer as a Capture sends it: what the Job Offers API stores. */
export type CapturedJobOffer = Omit<JobOffer, "id">;

export interface JobPage {
  /** Whether the page is a job posting, so the "Analyser cette offre" badge is shown. */
  detected: boolean;
  /** The Job Offer a Capture of this page sends; null when the page has nothing to capture. */
  jobOffer: CapturedJobOffer | null;
}

/** URLs of a single posting on major job boards and the career sites (ATS) employers use. */
export const KNOWN_POSTING_PAGES: readonly RegExp[] = [
  /^https:\/\/([a-z]+\.)?linkedin\.com\/jobs\/view\//,
  /^https:\/\/([a-z]+\.)?indeed\.[a-z.]+\/(viewjob|rc\/clk|m\/viewjob)\b/,
  /^https:\/\/([a-z]+\.)?indeed\.[a-z.]+\/.*[?&]vjk=/,
  /^https:\/\/www\.welcometothejungle\.com\/[a-z-]+\/companies\/[^/]+\/jobs\/[^/?#]+/,
  /^https:\/\/www\.apec\.fr\/candidat\/recherche-emploi\.html\/emploi\/detail-offre\//,
  /^https:\/\/candidat\.francetravail\.fr\/offres\/recherche\/detail\//,
  /^https:\/\/www\.hellowork\.com\/[a-z-]+\/emplois\/\d+\.html/,
  /^https:\/\/www\.cadremploi\.fr\/emploi\/detail_offre/,
  /^https:\/\/([a-z]+\.)?glassdoor\.[a-z.]+\/(job-listing|Emploi\/.*\.htm)/i,
  /^https:\/\/jobs\.lever\.co\/[^/]+\/[0-9a-f-]{36}/,
  /^https:\/\/(boards|job-boards)(\.eu)?\.greenhouse\.io\/[^/]+\/jobs\/\d+/,
  /^https:\/\/[^/]+\.teamtailor\.com\/([a-z]{2}(-[A-Z]{2})?\/)?jobs\/\d+/,
  /^https:\/\/(jobs|careers)\.smartrecruiters\.com\/[^/]+\/\d+/,
  /^https:\/\/[^/]+\.myworkdayjobs\.com\/.*\/job\//,
  /^https:\/\/apply\.workable\.com\/[^/]+\/j\/[0-9A-F]+/i,
  /^https:\/\/[^/]+\.recruitee\.com\/o\//,
  /^https:\/\/[^/]+\.welcomekit\.co\/jobs\//,
];

/**
 * Where the extension watches for postings to show the badge: the sites of
 * KNOWN_POSTING_PAGES, as match patterns. Elsewhere, Capture is manual (the
 * popup's "Capturer cette page", with activeTab), so the extension never asks
 * to read every site the person visits.
 */
export const JOB_SITES: readonly string[] = [
  "https://*.linkedin.com/*",
  "https://*.indeed.com/*",
  "https://*.indeed.fr/*",
  "https://www.welcometothejungle.com/*",
  "https://www.apec.fr/*",
  "https://candidat.francetravail.fr/*",
  "https://www.hellowork.com/*",
  "https://www.cadremploi.fr/*",
  "https://*.glassdoor.fr/*",
  "https://*.glassdoor.com/*",
  "https://jobs.lever.co/*",
  "https://boards.greenhouse.io/*",
  "https://job-boards.greenhouse.io/*",
  "https://job-boards.eu.greenhouse.io/*",
  "https://*.teamtailor.com/*",
  "https://jobs.smartrecruiters.com/*",
  "https://careers.smartrecruiters.com/*",
  "https://*.myworkdayjobs.com/*",
  "https://apply.workable.com/*",
  "https://*.recruitee.com/*",
  "https://*.welcomekit.co/*",
];

/** What a Job Offer can hold (the Job Offers API refuses more). */
const MAX = { title: 500, content: 100_000, text: 500, skill: 200, skills: 200 } as const;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function isJobPosting(node: Json): boolean {
  return asArray(node["@type"]).some((type) => typeof type === "string" && type.replace(/^.*[/:]/, "") === "JobPosting");
}

/** Every JobPosting in the page's JSON-LD, wherever it sits (a list, an @graph, nested). */
function jobPostings(structuredData: string[]): Json[] {
  const found: Json[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 6) return;
    if (Array.isArray(value)) return value.forEach((item) => visit(item, depth + 1));
    if (!isObject(value)) return;
    if (isJobPosting(value)) return void found.push(value);
    visit(value["@graph"], depth + 1);
    visit(value.mainEntity, depth + 1);
  };
  for (const json of structuredData) visit(parse(json), 0);
  return found;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] === "#") {
      const code = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return ENTITIES[name.toLowerCase()] ?? entity;
  });
}

/** HTML (as a JobPosting description is) to plain text, one line per paragraph or list item. */
function htmlToText(html: string): string {
  // Some sites escape the HTML once more.
  const markup = /<[a-z!/]/i.test(html) ? html : decodeEntities(html);
  const text = markup
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>|<\/(p|div|li|ul|ol|h[1-6]|tr|section)>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return tidy(decodeEntities(text));
}

/** Single spaces within lines, no blank lines, no surrounding space. */
function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[\s\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const clip = (text: string, max: number) => text.slice(0, max);

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return decodeEntities(value).trim() || undefined;
  if (isObject(value)) return textOf(value.name);
  return undefined;
}

function location(posting: Json): string | undefined {
  const places = asArray(posting.jobLocation).map((place) => {
    const address = isObject(place) ? place.address : undefined;
    if (typeof address === "string") return address.trim();
    if (!isObject(address)) return textOf(place);
    return textOf(address.addressLocality) ?? textOf(address.addressRegion) ?? textOf(address.addressCountry);
  });
  const names = [...new Set(places.filter((name): name is string => !!name))];
  return names.length ? clip(names.join(", "), MAX.text) : undefined;
}

const CONTRACT_WORDS: [RegExp, ContractType][] = [
  [/\bCDI\b|PERMANENT/i, "cdi"],
  [/\bCDD\b|TEMPORARY/i, "cdd"],
  [/INT[EÉ]RIM/i, "interim"],
  [/FREELANCE|CONTRACTOR|IND[EÉ]PENDANT/i, "freelance"],
];

function contractType(posting: Json): ContractType | undefined {
  for (const value of asArray(posting.employmentType)) {
    if (typeof value !== "string") continue;
    const lower = value.toLowerCase();
    if ((CONTRACT_TYPES as readonly string[]).includes(lower)) return lower as ContractType;
    const found = CONTRACT_WORDS.find(([pattern]) => pattern.test(value));
    if (found) return found[1];
  }
  return undefined;
}

const PER_YEAR: Record<string, number> = { YEAR: 1, MONTH: 12 };

function amount(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value.replace(/[\s\u00a0]/g, "").replace(",", ".")) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : undefined;
}

/** The gross annual salary in euros, when the posting gives it per year or per month. */
function salary(posting: Json): SalaryRange | undefined {
  const base = posting.baseSalary;
  if (!isObject(base)) return undefined;
  const value = isObject(base.value) ? base.value : { value: base.value };
  const currency = typeof base.currency === "string" ? base.currency.toUpperCase() : "EUR";
  const factor = PER_YEAR[typeof value.unitText === "string" ? value.unitText.toUpperCase() : "YEAR"];
  if (currency !== "EUR" || !factor) return undefined;
  const yearly = (raw: unknown) => {
    const number = amount(raw);
    return number === undefined ? undefined : Math.round(number * factor);
  };
  const min = yearly(value.minValue ?? value.value);
  const max = yearly(value.maxValue ?? value.value);
  if (min === undefined && max === undefined) return undefined;
  const range: SalaryRange = {};
  if (min !== undefined) range.min = min;
  if (max !== undefined) range.max = max;
  return range;
}

function skills(posting: Json): string[] | undefined {
  const names = asArray(posting.skills).flatMap((skill) => (typeof skill === "string" ? skill.split(/[,;\n]/) : [textOf(skill) ?? ""]));
  const list = [...new Set(names.map((name) => clip(decodeEntities(name).trim(), MAX.skill)).filter(Boolean))].slice(0, MAX.skills);
  return list.length ? list : undefined;
}

function requiredExperienceYears(posting: Json): number | undefined {
  const requirement = asArray(posting.experienceRequirements).find(isObject);
  const months = amount(requirement?.monthsOfExperience);
  return months === undefined ? undefined : Math.min(60, Math.round(months / 12));
}

function fromJobPosting(posting: Json, page: PageSnapshot): CapturedJobOffer | null {
  const title = textOf(posting.title) ?? textOf(posting.name);
  const description = typeof posting.description === "string" ? htmlToText(posting.description) : "";
  const content = description || tidy(page.text);
  if (!title || !content) return null;

  const jobOffer: CapturedJobOffer = { source: source(page), title: clip(title, MAX.title), content: clip(content, MAX.content) };
  const employer = textOf(posting.hiringOrganization);
  if (employer) jobOffer.employer = clip(employer, MAX.text);
  const place = location(posting);
  if (place) jobOffer.location = place;
  if (asArray(posting.jobLocationType).some((type) => typeof type === "string" && /TELECOMMUTE/i.test(type))) jobOffer.remoteWork = "full_remote";
  const contract = contractType(posting);
  if (contract) jobOffer.contractType = contract;
  const pay = salary(posting);
  if (pay) jobOffer.salary = pay;
  const asked = skills(posting);
  if (asked) jobOffer.skills = asked;
  const years = requiredExperienceYears(posting);
  if (years !== undefined) jobOffer.requiredExperienceYears = years;
  return jobOffer;
}

function source(page: PageSnapshot): CapturedJobOffer["source"] {
  const name = page.siteName?.trim();
  return name ? { url: page.url, name: clip(name, MAX.text) } : { url: page.url };
}

/** The page as it reads: its heading (or title) and its text. */
function fromPageText(page: PageSnapshot): CapturedJobOffer | null {
  const content = tidy(page.text);
  const title = page.heading?.trim() || page.title.trim();
  if (!content || !title) return null;
  return { source: source(page), title: clip(tidy(title), MAX.title), content: clip(content, MAX.content) };
}

export function readJobPage(page: PageSnapshot): JobPage {
  const postings = jobPostings(page.structuredData);
  const single = postings.length === 1 ? fromJobPosting(postings[0]!, page) : null;
  return {
    detected: single !== null || KNOWN_POSTING_PAGES.some((pattern) => pattern.test(page.url)),
    jobOffer: single ?? fromPageText(page),
  };
}
