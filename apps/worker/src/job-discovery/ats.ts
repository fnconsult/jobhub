/**
 * Reading a posting hosted by an applicant tracking system (Greenhouse, Lever,
 * Ashby) through that ATS's public JSON API instead of its HTML page: the API
 * states the posting date, whether the posting is still open and its deadline.
 *
 *   const reading = await readAtsPosting(url, { fetchJson, now });
 *   // null: not an ATS posting URL, or its API could not be read: read the page as usual.
 *
 * Only the one posting the URL names is asked for, at the employer's own
 * board: never a list of boards, never another employer's postings.
 */
import { isPostingTooOld, MAX_POSTING_AGE_DAYS, type JobOfferDetails, type RemoteWork, type SalaryRange } from "@jobhub/shared";
import { decodeEntities, htmlToText, type JsonResult, type RefusalReason } from "@jobhub/shared/page-reading";

export type { JsonResult } from "@jobhub/shared/page-reading";

export { MAX_POSTING_AGE_DAYS };

export type AtsReading =
  | { ok: true; details: JobOfferDetails }
  /**
   * `gone`: closed (no longer published, or past its deadline); `too_old`: published more than MAX_POSTING_AGE_DAYS ago;
   * `bot_protection`: the ATS answered with an anti-bot check, so its page is not read either (ADR-0002).
   */
  | { ok: false; reason: "gone" | "too_old" | Extract<RefusalReason, "bot_protection"> };

export interface AtsReadOptions {
  /** Reads an API URL (politely: robots.txt, site terms). */
  fetchJson: (url: string) => Promise<JsonResult>;
  now: Date;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** An instant from epoch milliseconds or an ISO date; a date without a time means the end of that day (UTC). */
function date(value: unknown): Date | undefined {
  const dateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  const instant =
    typeof value === "number" ? value : typeof value === "string" ? Date.parse(dateOnly ? `${value.trim()}T23:59:59.999Z` : value) : NaN;
  return Number.isFinite(instant) ? new Date(instant) : undefined;
}

/** What an ATS API says about a posting. */
interface AtsPosting {
  details: JobOfferDetails;
  /** When applications close, when the ATS states it. */
  closesAt?: Date;
}

/** One ATS: the API URL for a posting URL it hosts, and how to read the API's answer. */
interface Ats {
  /** The ATS as a Tool: a step of the Job Offer's Provenance. */
  tool: "greenhouse" | "lever" | "ashby";
  /** The API URL of the posting `url` names, or null when `url` is not one of its postings. */
  apiUrl(url: URL): string | null;
  /** The posting, or null when the answer does not hold it. */
  read(data: unknown, url: URL): AtsPosting | null;
  /** The company board a posting or board URL is on (its hosted page), or null when `url` is not on this ATS. */
  board(url: URL): string | null;
  /** The API URL listing every posting of the board `board` (as `board` gives it). */
  boardApiUrl(board: URL): string;
  /** The postings of a board's API answer, each at its own address, unlisted ones left out. */
  readBoard(data: unknown): { url: string; posting: AtsPosting }[];
}

/** The first path segment of `url`: an ATS board's name ("acme" in jobs.lever.co/acme/…), or null. */
const boardName = (url: URL) => /^\/([^/?#]+)/.exec(url.pathname)?.[1] ?? null;
/** Path segments that are an ATS's own pages, never a company's board. */
const NOT_BOARDS = new Set(["embed", "api", "v1", "v0", "jobs", "careers"]);

const greenhouse: Ats = {
  tool: "greenhouse",
  apiUrl(url) {
    if (!/^(job-)?boards\.greenhouse\.io$/i.test(url.hostname)) return null;
    const match = /^\/([^/]+)\/jobs\/(\d+)\/?$/.exec(url.pathname);
    if (!match) return null;
    return `https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs/${match[2]}`;
  },
  read(data) {
    if (!isObject(data)) return null;
    const title = str(data.title);
    const content = typeof data.content === "string" ? htmlToText(decodeEntities(data.content)) : "";
    if (!title || !content) return null;
    const details: JobOfferDetails = { title, content };
    const employer = str(data.company_name);
    if (employer) details.employer = employer;
    const location = isObject(data.location) ? str(data.location.name) : undefined;
    if (location) details.location = location;
    const postedAt = date(data.first_published);
    if (postedAt) details.postedAt = postedAt;
    return { details, closesAt: date(data.application_deadline) };
  },
  board(url) {
    const name = /^(job-)?boards\.greenhouse\.io$/i.test(url.hostname) ? boardName(url) : null;
    return name && !NOT_BOARDS.has(name.toLowerCase()) ? `https://job-boards.greenhouse.io/${name}` : null;
  },
  boardApiUrl(board) {
    return `https://boards-api.greenhouse.io/v1/boards/${boardName(board)}/jobs?content=true`;
  },
  readBoard(data) {
    const jobs = isObject(data) && Array.isArray(data.jobs) ? data.jobs.filter(isObject) : [];
    return jobs.flatMap((job) => {
      const url = str(job.absolute_url);
      const posting = url && URL.canParse(url) ? greenhouse.read(job, new URL(url)) : null;
      return url && posting ? [{ url, posting }] : [];
    });
  },
};

/** How much remote work an ATS's workplace type means ("remote", "hybrid", "onsite", any case or spelling). */
function remoteWork(value: unknown): RemoteWork | undefined {
  const type = typeof value === "string" ? value.toLowerCase().replace(/[^a-z]/g, "") : "";
  if (type === "remote") return "full_remote";
  if (type === "hybrid") return "hybrid";
  if (type === "onsite") return "on_site";
  return undefined;
}

const PER_YEAR: Record<string, number> = { "per-year-salary": 1, "per-month-salary": 12 };

/** A Lever salary range, as a gross annual salary in euros; left out in another currency or per hour or day. */
function leverSalary(range: unknown): SalaryRange | undefined {
  if (!isObject(range) || range.currency !== "EUR") return undefined;
  const factor = PER_YEAR[String(range.interval)];
  if (!factor) return undefined;
  const salary: SalaryRange = {};
  if (typeof range.min === "number" && range.min > 0) salary.min = Math.round(range.min * factor);
  if (typeof range.max === "number" && range.max > 0) salary.max = Math.round(range.max * factor);
  return salary.min === undefined && salary.max === undefined ? undefined : salary;
}

const lever: Ats = {
  tool: "lever",
  apiUrl(url) {
    const host = /^jobs\.(eu\.)?lever\.co$/i.exec(url.hostname);
    if (!host) return null;
    const match = /^\/([^/]+)\/([0-9a-f-]{36})(\/apply)?\/?$/i.exec(url.pathname);
    if (!match) return null;
    return `https://api.${host[1] ?? ""}lever.co/v0/postings/${match[1]}/${match[2]}`;
  },
  read(data) {
    if (!isObject(data)) return null;
    const title = str(data.text);
    // The description, then each list under its heading, then the closing text.
    const lists = (Array.isArray(data.lists) ? data.lists : []).filter(isObject).map((list) =>
      [str(list.text), typeof list.content === "string" ? htmlToText(list.content) : undefined].filter(Boolean).join("\n\n"),
    );
    const content = [str(data.descriptionPlain), ...lists, str(data.additionalPlain)].filter(Boolean).join("\n\n");
    if (!title || !content) return null;
    const details: JobOfferDetails = { title, content };
    const location = isObject(data.categories) ? str(data.categories.location) : undefined;
    if (location) details.location = location;
    const remote = remoteWork(data.workplaceType);
    if (remote) details.remoteWork = remote;
    const salary = leverSalary(data.salaryRange);
    if (salary) details.salary = salary;
    const postedAt = date(data.createdAt);
    if (postedAt) details.postedAt = postedAt;
    return { details };
  },
  board(url) {
    const host = /^jobs\.(eu\.)?lever\.co$/i.exec(url.hostname);
    const name = host ? boardName(url) : null;
    return name && !NOT_BOARDS.has(name.toLowerCase()) ? `https://jobs.${host![1] ?? ""}lever.co/${name}` : null;
  },
  boardApiUrl(board) {
    const eu = /^jobs\.eu\./i.test(board.hostname) ? "eu." : "";
    return `https://api.${eu}lever.co/v0/postings/${boardName(board)}?mode=json`;
  },
  readBoard(data) {
    const postings = Array.isArray(data) ? data.filter(isObject) : [];
    return postings.flatMap((item) => {
      const url = str(item.hostedUrl);
      const posting = url && URL.canParse(url) ? lever.read(item, new URL(url)) : null;
      return url && posting ? [{ url, posting }] : [];
    });
  },
};

/**
 * Ashby documents no single-posting endpoint: the employer's own job board is
 * read and the posting picked from it by id. Absent from it means closed.
 */
const ashby: Ats = {
  tool: "ashby",
  apiUrl(url) {
    if (url.hostname.toLowerCase() !== "jobs.ashbyhq.com") return null;
    const match = /^\/([^/]+)\/([0-9a-f-]{36})(\/application)?\/?$/i.exec(url.pathname);
    if (!match) return null;
    return `https://api.ashbyhq.com/posting-api/job-board/${match[1]}`;
  },
  read(data, url) {
    const id = /^\/[^/]+\/([0-9a-f-]{36})/i.exec(url.pathname)?.[1]?.toLowerCase();
    const job = ashbyJobs(data).find((candidate) => typeof candidate.id === "string" && candidate.id.toLowerCase() === id);
    return job ? readAshbyJob(job) : null;
  },
  board(url) {
    const name = url.hostname.toLowerCase() === "jobs.ashbyhq.com" ? boardName(url) : null;
    return name && !NOT_BOARDS.has(name.toLowerCase()) ? `https://jobs.ashbyhq.com/${name}` : null;
  },
  boardApiUrl(board) {
    return `https://api.ashbyhq.com/posting-api/job-board/${boardName(board)}`;
  },
  readBoard(data) {
    return ashbyJobs(data)
      .filter((job) => job.isListed !== false)
      .flatMap((job) => {
        const url = str(job.jobUrl);
        const posting = url ? readAshbyJob(job) : null;
        return url && posting ? [{ url, posting }] : [];
      });
  },
};

/** The jobs of an Ashby board answer. */
const ashbyJobs = (data: unknown): Json[] => (isObject(data) && Array.isArray(data.jobs) ? data.jobs.filter(isObject) : []);

/** One job of an Ashby board, or null without a title or a description. */
function readAshbyJob(job: Json): AtsPosting | null {
  const title = str(job.title);
  const content = str(job.descriptionPlain) ?? (typeof job.descriptionHtml === "string" ? htmlToText(job.descriptionHtml) : undefined);
  if (!title || !content) return null;
  const details: JobOfferDetails = { title, content };
  const location = str(job.location);
  if (location) details.location = location;
  const remote = remoteWork(job.workplaceType) ?? (job.isRemote === true ? "full_remote" : undefined);
  if (remote) details.remoteWork = remote;
  const postedAt = date(job.publishedAt);
  if (postedAt) details.postedAt = postedAt;
  return { details };
}

const ATS: readonly Ats[] = [greenhouse, lever, ashby];

/** The ATS whose API `readAtsPosting` reads for `address` (a Tool), or null when it is not a Greenhouse, Lever or Ashby posting. */
export function atsToolOf(address: string): Ats["tool"] | null {
  if (!URL.canParse(address)) return null;
  const url = new URL(address);
  return ATS.find((ats) => ats.apiUrl(url) !== null)?.tool ?? null;
}

/**
 * The posting a Greenhouse, Lever or Ashby URL names, read through that ATS's
 * JSON API, or null when the URL is not such a posting or the API could not be
 * read (down, too large, not JSON, or kept out by the API's robots.txt): its
 * page is then read as any other, under its own site's rules. Only an API
 * stating the posting is gone, or showing an anti-bot check, ends there.
 */
export async function readAtsPosting(address: string, options: AtsReadOptions): Promise<AtsReading | null> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  for (const ats of ATS) {
    const apiUrl = ats.apiUrl(url);
    if (!apiUrl) continue;
    const answer = await options.fetchJson(apiUrl);
    if (!answer.ok) return answer.reason === "gone" || answer.reason === "bot_protection" ? { ok: false, reason: answer.reason } : null;
    const posting = ats.read(answer.data, url);
    if (!posting || (posting.closesAt && posting.closesAt < options.now)) return { ok: false, reason: "gone" };
    const { postedAt } = posting.details;
    if (isPostingTooOld(postedAt, options.now)) return { ok: false, reason: "too_old" };
    return { ok: true, details: posting.details };
  }
  return null;
}

/** The company board (its hosted page: job-boards.greenhouse.io/acme, jobs.lever.co/acme, jobs.ashbyhq.com/acme) `address` is on, or null. */
export function atsBoardOf(address: string): string | null {
  if (!URL.canParse(address)) return null;
  const url = new URL(address);
  for (const ats of ATS) {
    const board = ats.board(url);
    if (board) return board;
  }
  return null;
}

/** The ATS (a Tool) whose board `address` is, or null when it is no board on Greenhouse, Lever or Ashby. */
export function atsBoardToolOf(address: string): Ats["tool"] | null {
  if (!URL.canParse(address)) return null;
  const url = new URL(address);
  return ATS.find((ats) => ats.board(url) !== null)?.tool ?? null;
}

export type AtsBoardReading =
  | { ok: true; tool: Ats["tool"]; postings: { url: string; details: JobOfferDetails }[] }
  | { ok: false; reason: "gone" | Extract<RefusalReason, "bot_protection"> };

/**
 * Every open posting of a company's board on Greenhouse, Lever or Ashby (a Target Company's careers site, #406),
 * through that ATS's public JSON API: those closed, past their deadline or first published more than
 * MAX_POSTING_AGE_DAYS ago left out, each at its own address. Null when `board` is no such board, or its API
 * could not be read (down, too large, not JSON, kept out by robots.txt); `gone` when the board is no more.
 */
export async function readAtsBoard(board: string, options: AtsReadOptions): Promise<AtsBoardReading | null> {
  const address = atsBoardOf(board);
  if (!address) return null;
  const url = new URL(address);
  const ats = ATS.find((each) => each.board(url) !== null)!;
  const answer = await options.fetchJson(ats.boardApiUrl(url));
  if (!answer.ok) return answer.reason === "gone" || answer.reason === "bot_protection" ? { ok: false, reason: answer.reason } : null;
  const postings = ats
    .readBoard(answer.data)
    .filter(({ posting }) => !(posting.closesAt && posting.closesAt < options.now) && !isPostingTooOld(posting.details.postedAt, options.now))
    .map(({ url: postingUrl, posting }) => ({ url: postingUrl, details: posting.details }));
  return { ok: true, tool: ats.tool, postings };
}
