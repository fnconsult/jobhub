/**
 * Reading schema.org `JobPosting` structured data (JSON-LD) into Job Offer details.
 * https://schema.org/JobPosting — fields are loosely typed in the wild, so every
 * read is defensive: a field we cannot make sense of is left out.
 */
import type { ContractType, JobOfferDetails, RemoteWork, SalaryRange } from "@jobhub/shared";
import { decodeEntities, htmlToText, jsonLdBlocks } from "./html";

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

/** Every JobPosting node in the page's JSON-LD, including inside `@graph` and arrays. */
function jobPostingNodes(html: string): Json[] {
  const found: Json[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 6) return;
    for (const item of asArray(node)) {
      if (!isObject(item)) continue;
      if (hasType(item, "JobPosting")) found.push(item);
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
  const number = typeof value === "string" ? Number(value.replace(/[\s  ]/g, "").replace(",", ".")) : value;
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

function skills(posting: Json): string[] | undefined {
  const items = asArray(posting.skills).flatMap((skill) => {
    const value = text(skill);
    if (!value) return [];
    // A single string often lists skills separated by commas.
    return typeof skill === "string" && !Array.isArray(posting.skills) ? value.split(/\s*[,;]\s*/) : [value];
  });
  const kept = items.filter(Boolean);
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
  return details;
}

/** How many JobPosting nodes the page carries (more than one means a list of postings). */
export function countJobPostings(html: string): number {
  return jobPostingNodes(html).length;
}
