/**
 * Source re-check: finding Expired Job Offers.
 *
 *   const recheck = createSourceRecheck({ store });
 *   const report = await recheck.run(new Date());
 *
 * One run reads the source page of each Job Offer due a re-check (the store
 * decides which, and how often) the way ADR-0002 allows: robots.txt first, as
 * ourselves, never a Forbidden site, never around bot protection. A Job Offer
 * is expired only when its source says so; a page we may not or cannot read
 * tells us nothing, and the Job Offer stays as it is until the next re-check.
 */
import { createPoliteFetcher, type Clock, type RefusalReason } from "../job-discovery/polite-fetch";
import { DEFAULT_USER_AGENT, FORBIDDEN_SITES } from "../job-discovery";
import { htmlToText } from "../job-discovery/html";
import { jobPostingValidThrough, readJobPosting } from "../job-discovery/job-posting";

/** What a re-check learnt: still published, no longer published, or nothing (not read). */
export type SourceCheckOutcome = "published" | "expired" | "unknown";

/** Where re-checks are scheduled and recorded. Satisfied by the web app's Job Offers module. */
export interface SourceCheckStore {
  /** Up to `limit` Job Offers whose source is due a re-check at `now`, longest unchecked first. */
  dueForRecheck(now: Date, limit: number): Promise<{ id: string; sourceUrl: string }[]>;
  /** Records the outcome of a re-check made at `now`; "expired" makes it an Expired Job Offer. */
  record(id: string, outcome: SourceCheckOutcome, now: Date): Promise<void>;
}

export interface SourceRecheckOptions {
  store: SourceCheckStore;
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  userAgent?: string;
  /** Default: FORBIDDEN_SITES. */
  forbiddenSites?: readonly string[];
  /** Job Offers re-checked per run. Default 100. */
  batchSize?: number;
  clock?: Clock;
}

export interface SourceRecheckReport {
  checked: number;
  /** Job Offers found expired in this run. */
  expired: string[];
  /** Job Offers whose source could not be read, and why. */
  unknown: { id: string; reason: RefusalReason }[];
}

export interface SourceRecheck {
  run(now: Date): Promise<SourceRecheckReport>;
}

/** What a source page says when its posting is no longer published (French and English job sites). */
const EXPIRY_NOTICES = [
  /\boffre\b[^.!?\n]{0,40}\b(n['’]est plus (disponible|en ligne|active|d['’]actualit[ée])|a expir[ée]|est expir[ée]e|est (cl[ôo]tur[ée]e|ferm[ée]e|pourvue))/i,
  /\b(poste|offre) (a [ée]t[ée]|est d[ée]j[àa]) pourvu/i,
  /\bcandidatures? (sont|est) (cl[ôo]tur[ée]e?s?|ferm[ée]e?s?)/i,
  /\b(job|position|posting|vacancy)\b[^.!?\n]{0,30}\b(is no longer (available|active|open|accepting)|has (expired|been filled|closed))/i,
];

/**
 * The page's own content, without what every page of the site repeats: its
 * header, navigation, footer, side panels and links. "Signalez-nous si cette
 * offre n'est plus disponible" in a footer or a report link says nothing about
 * this posting.
 */
function ownContent(html: string): string {
  return html.replace(/<(header|nav|footer|aside|a)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
}

/**
 * A notice in a conditional ("si cette offre n'est plus disponible", "quand
 * l'offre est pourvue", "s'il s'avère que cette offre…", "if this job is no
 * longer available") is not a notice: the conjunction, then up to five words
 * of the same clause (elided ones like "l'" or "s'" included), right before it.
 */
const CONDITIONAL = /(?<!\p{L})(si\s+|s['’]|lorsque\s+|lorsqu['’]|quand\s+|if\s+|when\s+|once\s+)([^\s,;:.!?'’]+(['’]\s*|\s+)){0,5}$/iu;
/** Nor is a question ("Cette offre n'est plus disponible ? Signalez-le-nous."). */
const QUESTION = /^\s*\?/;

function saysExpired(text: string): boolean {
  return EXPIRY_NOTICES.some((notice) => {
    const global = new RegExp(notice.source, notice.flags.includes("g") ? notice.flags : `${notice.flags}g`);
    for (const match of text.matchAll(global)) {
      const before = text.slice(Math.max(0, match.index - 60), match.index);
      const after = text.slice(match.index + match[0].length);
      if (!CONDITIONAL.test(before) && !QUESTION.test(after)) return true;
    }
    return false;
  });
}

/** What a page we could read says about the posting it stood for. */
function pageOutcome(sourceUrl: string, page: { url: string; html: string }, now: Date): SourceCheckOutcome {
  const validThrough = jobPostingValidThrough(page.html);
  if (validThrough && validThrough < now) return "expired";
  // Sent to the site's home page: the posting's own page is no more.
  if (new URL(page.url).pathname === "/" && new URL(sourceUrl).pathname !== "/") return "expired";
  // The page still states the posting as structured data, and it is not past its closing date:
  // the site publishes it, whatever its text says elsewhere.
  if (readJobPosting(page.html)) return "published";
  return saysExpired(htmlToText(ownContent(page.html))) ? "expired" : "published";
}

export function createSourceRecheck(options: SourceRecheckOptions): SourceRecheck {
  return {
    async run(now) {
      const fetcher = createPoliteFetcher({
        fetch: options.fetch ?? globalThis.fetch,
        userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
        forbiddenSites: options.forbiddenSites ?? FORBIDDEN_SITES,
        timeoutMs: 15_000,
        maxBytes: 3 * 1024 * 1024,
        clock: options.clock,
      });
      const due = await options.store.dueForRecheck(now, options.batchSize ?? 100);
      const report: SourceRecheckReport = { checked: 0, expired: [], unknown: [] };
      for (const { id, sourceUrl } of due) {
        const page = await fetcher.page(sourceUrl);
        const outcome = page.ok === true ? pageOutcome(sourceUrl, page, now) : page.ok === false && page.reason === "gone" ? "expired" : "unknown";
        if (outcome === "unknown") report.unknown.push({ id, reason: page.ok === false ? page.reason : "unreachable" });
        await options.store.record(id, outcome, now);
        report.checked++;
        if (outcome === "expired") report.expired.push(id);
      }
      return report;
    },
  };
}
