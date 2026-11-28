/**
 * A LinkedIn Reading (ADR-0119 « LinkedIn, through the extension only », #1164): what the browser extension reads, in the
 * Candidate's own browser and on their click, of a LinkedIn page they opened: a Job Offer, a company page, or a company's
 * people filtered by department. Of each person it keeps their name, role and company, and nothing else: never a profile,
 * its address, a photo or a place. Jobbbox's server never reads LinkedIn itself; it keeps what the extension sends.
 *
 *   linkedInPageOf(url)          // { kind, url } of a page a Reading may be of, its address canonical; null otherwise
 *   linkedInReadingOf(anything)  // the Reading it holds, every field trimmed and capped, all else left out; null if none
 *
 * Both the extension (before sending) and the web app (on receipt) read a Reading through `linkedInReadingOf`: what the
 * server keeps is never more than these fields, whatever was sent.
 */

export const LINKEDIN_PAGE_KINDS = ["job_offer", "company", "people"] as const;
export type LinkedInPageKind = (typeof LINKEDIN_PAGE_KINDS)[number];

/** A LinkedIn page a Reading may be of, by its canonical address (no query, no fragment). */
export interface LinkedInPage {
  kind: LinkedInPageKind;
  url: string;
}

/** A person as a Reading keeps them: their name, role and company only. */
export interface LinkedInPerson {
  name: string;
  /** Their role (LinkedIn's headline or job title); empty when the page gives none. */
  role: string;
  company: string;
}

export interface LinkedInReading {
  page: LinkedInPage;
  /** The company the page is about: the company page's, or the Job Offer's employer. */
  company: string;
  /** The department the people were filtered by, when they were (a company's people page). */
  department?: string;
  people: LinkedInPerson[];
}

/** What a Reading holds at most: people per page, characters per field. */
export const LINKEDIN_READING_LIMITS = { people: 50, name: 120, role: 200, company: 200, department: 100 } as const;

/** LinkedIn's own hosts: linkedin.com and its language subdomains (fr.linkedin.com), over HTTPS. */
const LINKEDIN_HOST = /^([a-z]{2,3}\.|www\.)?linkedin\.com$/;
const JOB_VIEW = /^\/jobs\/view\/(\d+)(\/|$)/;
const JOB_RESULTS = /^\/jobs\/(search|collections)(\/|$)/;
const COMPANY = /^\/company\/([^/]+)(?:\/([^/]+))?\/?$/;
/** The tabs of a company page that are about the company itself, not its people. */
const COMPANY_TABS = new Set(["", "about", "life", "jobs", "posts", "mycompany"]);

const canonical = (path: string) => `https://www.linkedin.com${path}`;

export function linkedInPageOf(url: string): LinkedInPage | null {
  if (!URL.canParse(url)) return null;
  const address = new URL(url);
  if (address.protocol !== "https:" || !LINKEDIN_HOST.test(address.hostname)) return null;
  const path = address.pathname;
  const view = JOB_VIEW.exec(path);
  if (view) return { kind: "job_offer", url: canonical(`/jobs/view/${view[1]}/`) };
  const posting = address.searchParams.get("currentJobId");
  if (JOB_RESULTS.test(path) && posting && /^\d+$/.test(posting)) return { kind: "job_offer", url: canonical(`/jobs/view/${posting}/`) };
  const company = COMPANY.exec(path);
  if (!company) return null;
  const slug = encodeURIComponent(decodeURIComponent(company[1]!));
  const tab = company[2] ?? "";
  if (tab === "people") return { kind: "people", url: canonical(`/company/${slug}/people/`) };
  return COMPANY_TABS.has(tab) ? { kind: "company", url: canonical(`/company/${slug}/`) } : null;
}

/** LinkedIn's placeholder for a member out of the Candidate's network: no one to keep. */
const ANONYMOUS = /^(membre linkedin|linkedin member)$/i;

/** A string field, its spaces folded and trimmed, cut to `max`; empty when it is not text. */
function field(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max).trim() : "";
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function linkedInReadingOf(input: unknown): LinkedInReading | null {
  if (!isRecord(input) || !isRecord(input.page) || typeof input.page.url !== "string" || !Array.isArray(input.people)) return null;
  const page = linkedInPageOf(input.page.url);
  const company = field(input.company, LINKEDIN_READING_LIMITS.company);
  if (!page || !company) return null;
  const people: LinkedInPerson[] = [];
  const seen = new Set<string>();
  for (const entry of input.people) {
    if (people.length >= LINKEDIN_READING_LIMITS.people) break;
    if (!isRecord(entry)) continue;
    const name = field(entry.name, LINKEDIN_READING_LIMITS.name);
    if (!name || ANONYMOUS.test(name)) continue;
    const person = { name, role: field(entry.role, LINKEDIN_READING_LIMITS.role), company: field(entry.company, LINKEDIN_READING_LIMITS.company) || company };
    const key = `${person.name}\u0000${person.role}\u0000${person.company}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    people.push(person);
  }
  const department = field(input.department, LINKEDIN_READING_LIMITS.department);
  return { page, company, ...(department ? { department } : {}), people };
}
