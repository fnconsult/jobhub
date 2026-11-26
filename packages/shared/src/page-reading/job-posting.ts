/**
 * Reading schema.org `JobPosting` structured data (JSON-LD) into Job Offer details.
 * https://schema.org/JobPosting — fields are loosely typed in the wild, so every
 * read is defensive: a field we cannot make sense of is left out.
 */
import type { ContractType, JobOfferDetails, RemoteWork, SalaryRange } from "../domain";
import { parseStatedDate } from "../posting-date";
import { decodeEntities, htmlToText, jsonLdBlocks, mainHeading } from "./html";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

function text(value: unknown): string | undefined {
  if (typeof value === "string") return decodeEntities(value).replace(/\s+/g, " ").trim() || undefined;
  if (typeof value === "number") return String(value);
  if (isObject(value)) return text(value.name);
  return undefined;
}

function hasType(node: Json, type: string): boolean {
  return asArray(node["@type"]).some((t) => typeof t === "string" && t.replace(/^.*[/:]/, "").toLowerCase() === type.toLowerCase());
}

/** Every node of this type in the page's JSON-LD, including inside `@graph` and arrays (not inside another node). */
function structuredNodes(html: string, type: string): Json[] {
  const found: Json[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 6) return;
    for (const item of asArray(node)) {
      if (!isObject(item)) continue;
      if (hasType(item, type)) found.push(item);
      else if (item["@graph"]) visit(item["@graph"], depth + 1);
    }
  };
  for (const block of jsonLdBlocks(html)) {
    try {
      visit(JSON.parse(block.trim().replace(/^<!\[CDATA\[|\]\]>$/g, "")), 0);
    } catch {
      // Broken JSON-LD: ignore this block, the LLM fallback can still read the page.
    }
  }
  return found;
}

/** Every JobPosting node in the page's JSON-LD. */
const jobPostingNodes = (html: string) => structuredNodes(html, "JobPosting");

function location(posting: Json): string | undefined {
  for (const place of asArray(posting.jobLocation)) {
    if (!isObject(place)) continue;
    const address = place.address;
    if (typeof address === "string") return text(address);
    if (!isObject(address)) {
      const name = text(place.name);
      if (name) return name;
      continue;
    }
    const locality = text(address.addressLocality);
    const postalCode = text(address.postalCode);
    const region = text(address.addressRegion);
    if (locality) return postalCode ? `${locality} (${postalCode})` : locality;
    if (region) return region;
  }
  return undefined;
}

function contractType(posting: Json): ContractType | undefined {
  for (const value of asArray(posting.employmentType)) {
    const type = typeof value === "string" ? value.toLowerCase() : "";
    if (/\bcdi\b|permanent/.test(type)) return "cdi";
    if (/\bcdd\b|fixed[-_ ]?term/.test(type)) return "cdd";
    if (/freelance|contractor|ind[ée]pendant/.test(type)) return "freelance";
    if (/int[ée]rim/.test(type)) return "interim";
  }
  return undefined;
}

function remoteWork(posting: Json): RemoteWork | undefined {
  return asArray(posting.jobLocationType).some((t) => typeof t === "string" && /telecommute/i.test(t)) ? "full_remote" : undefined;
}

const PER_YEAR: Record<string, number> = { YEAR: 1, MONTH: 12 };

function amount(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".")) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : undefined;
}

/** The gross annual salary in euros, when the posting states one per year or per month. */
function salary(posting: Json): SalaryRange | undefined {
  const base = posting.baseSalary;
  if (!isObject(base)) return undefined;
  const currency = text(base.currency) ?? "EUR";
  if (currency.toUpperCase() !== "EUR") return undefined;
  const value = isObject(base.value) ? base.value : { value: base.value };
  const unit = (text(value.unitText) ?? text(base.unitText) ?? "YEAR").toUpperCase();
  const factor = PER_YEAR[unit];
  if (!factor) return undefined;
  const annual = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * factor));
  const min = annual(amount(value.minValue) ?? amount(value.value));
  const max = annual(amount(value.maxValue) ?? amount(value.value));
  if (min === undefined && max === undefined) return undefined;
  const range: SalaryRange = {};
  if (min !== undefined) range.min = min;
  if (max !== undefined) range.max = max;
  return range;
}

/** Longer than this, it is a sentence about the job, not a skill. */
const MAX_SKILL_CHARS = 120;

function skills(posting: Json): string[] | undefined {
  const items = asArray(posting.skills).flatMap((skill) => {
    // Some sites write their skills as HTML: one per list item, prose around them.
    if (typeof skill === "string" && /<[a-z][^>]*>/i.test(skill)) return htmlToText(skill).split("\n");
    const value = text(skill);
    if (!value) return [];
    // A single string often lists skills separated by commas.
    return typeof skill === "string" && !Array.isArray(posting.skills) ? value.split(/\s*[,;]\s*/) : [value];
  });
  const kept = items.map((item) => item.replace(/[\s.,;:]+$/, "").trim()).filter((item) => item && item.length <= MAX_SKILL_CHARS);
  return kept.length ? kept : undefined;
}

function experienceYears(posting: Json): number | undefined {
  for (const requirement of asArray(posting.experienceRequirements)) {
    if (!isObject(requirement)) continue;
    const months = amount(requirement.monthsOfExperience);
    if (months !== undefined) return Math.round(months / 12);
  }
  return undefined;
}

/**
 * The Job Offer details stated by the page's single `JobPosting`, or null when
 * the page has none (or several: a list of postings is not one Job Offer).
 * `postedAt` is its `datePosted` as stated, believable or not: the caller judges it.
 */
export function readJobPosting(html: string): JobOfferDetails | null {
  const nodes = jobPostingNodes(html);
  if (nodes.length !== 1) return null;
  const posting = nodes[0]!;
  const title = text(posting.title) ?? text(posting.name);
  const description = typeof posting.description === "string" ? htmlToText(posting.description) : undefined;
  if (!title || !description) return null;

  const details: JobOfferDetails = { title, content: description };
  const employer = text(posting.hiringOrganization);
  if (employer) details.employer = employer;
  const where = location(posting);
  if (where) details.location = where;
  const contract = contractType(posting);
  if (contract) details.contractType = contract;
  const remote = remoteWork(posting);
  if (remote) details.remoteWork = remote;
  const pay = salary(posting);
  if (pay) details.salary = pay;
  const asked = skills(posting);
  if (asked) details.skills = asked;
  const years = experienceYears(posting);
  if (years !== undefined) details.requiredExperienceYears = years;
  const posted = parseStatedDate(text(posting.datePosted));
  if (posted) details.postedAt = posted;
  return details;
}

/**
 * The job title the page states (#1128): its single `JobPosting`'s `title` (or `name`), even when that node lacks the
 * description `readJobPosting` needs, else its posting's heading (`mainHeading`), never a heading of the site's banner.
 * What the AI reading of the page is told to take as the title, and what replaces a title it read otherwise.
 */
export function statedJobTitle(html: string): { title: string; from: "job_posting" | "heading" } | undefined {
  const nodes = jobPostingNodes(html);
  const posted = nodes.length === 1 ? (text(nodes[0]!.title) ?? text(nodes[0]!.name)) : undefined;
  if (posted) return { title: posted, from: "job_posting" };
  const heading = headingTitle(mainHeading(html), siteName(html));
  return heading ? { title: heading, from: "heading" } : undefined;
}

/** The site's own name, as its `og:site_name` gives it. */
function siteName(html: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bproperty\s*=\s*["']?og:site_name\b/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const name = content ? decodeEntities(content[1] ?? content[2] ?? "").replace(/\s+/g, " ").trim() : "";
    if (name) return name;
  }
  return undefined;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A careers page's own heading, never one posting's (« Open Roles », « Nous rejoindre »): it states no job title (#1154).
 */
const CAREERS_HEADING =
  /^(?:open (?:roles|positions)|current (?:openings|opportunities|vacancies)|job (?:openings|opportunities)|(?:all |our )?(?:jobs|careers?|vacancies|openings)|join (?:us|our team|the team)|we'?re hiring|work with us|(?:nos )?offres(?: d'emploi)?|offres? d'emploi|carri[eè]res?|nous rejoindre|rejoignez[- ]nous|recrutement|nous recrutons|on recrute|postuler|candidature spontan[ée]e)$/i;

/** The gender marker French and German postings put after the job title: « H/F », « F/H/X », « (M/F/D) », « m/w/d ». */
const GENDER_MARKER = /\(?\s*\b[HFMW]\s*\/\s*[HFMW](?:\s*\/\s*[XDN])?\b\s*\)?/i;

/**
 * What a posting's heading gives as its job title (#1154). A job board's `<h1>` often goes on past the title:
 *  - after the gender marker, the employer or the recruiting firm (« Head Of Legal H/F Team.is », « … H/F - Ikigaï »):
 *    the title ends with the marker;
 *  - the site's own name at its end (`site`, its `og:site_name`), with no marker before it: it is left out;
 *  - a parenthesis the page cut off (« … PME industrielles (m »): it is left out;
 *  - a careers page's own heading (« Open Roles »): no title at all.
 */
export function headingTitle(heading: string | undefined, site?: string): string | undefined {
  if (!heading) return undefined;
  let title = heading.replace(/\s+/g, " ").trim();
  const marker = GENDER_MARKER.exec(title);
  if (marker && marker.index > 0) title = title.slice(0, marker.index + marker[0].length).trim();
  else if (site) title = title.replace(new RegExp(`(?:\\s+[-–—|:,·@]|\\s+(?:chez|at))?\\s+${escapeRegExp(site)}$`, "i"), "").trim() || title;
  title = title.replace(/\s*\([^()]*$/, "").replace(/[\s\-–—|:,·]+$/, "").trim();
  if (!title || CAREERS_HEADING.test(title)) return undefined;
  return title;
}

/** How many JobPosting nodes the page carries (more than one means a list of postings). */
export function countJobPostings(html: string): number {
  return jobPostingNodes(html).length;
}

/**
 * When the page's single `JobPosting` stops being valid (its `validThrough`),
 * or null when it states none we can read. A date without a time means the end
 * of that day.
 */
export function jobPostingValidThrough(html: string): Date | null {
  const nodes = jobPostingNodes(html);
  if (nodes.length !== 1) return null;
  const value = text(nodes[0]!.validThrough);
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const instant = Date.parse(dateOnly ? `${value}T23:59:59` : value);
  return Number.isNaN(instant) ? null : new Date(instant);
}

/**
 * The addresses of the postings the page's structured data lists, as stated
 * (possibly relative): the `url` of each of several JobPostings, and each
 * posting of an ItemList. None when the page describes a single posting.
 */
export function listedPostingUrls(html: string): string[] {
  const urls: string[] = [];
  const postings = jobPostingNodes(html);
  if (postings.length > 1) for (const posting of postings) if (typeof posting.url === "string") urls.push(posting.url);
  for (const list of structuredNodes(html, "ItemList")) {
    for (const element of asArray(list.itemListElement)) {
      if (typeof element === "string") urls.push(element);
      if (!isObject(element)) continue;
      const item = element.item;
      // A listed item that is something else than a posting (an article, a product) is not followed.
      if (isObject(item) && !hasType(item, "JobPosting")) continue;
      const url = isObject(item) ? (item.url ?? item["@id"]) : (element.url ?? item);
      if (typeof url === "string") urls.push(url);
    }
  }
  return urls;
}
