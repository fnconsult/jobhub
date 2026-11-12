/** Public alert links only: reuse discovery's polite reader and posting extractors. Never search for email text. */
import { readJobPage, readOfferFields, type AiLayer } from "@jobhub/ai";
import { FORBIDDEN_SITES, type ExternalApiLog, type JobOfferDetails } from "@jobhub/shared";
import { countJobPostings, createPoliteFetcher, DEFAULT_USER_AGENT, htmlToText, metaRobots, readJobPosting, recordingSiteFetch, type Clock } from "@jobhub/shared/page-reading";

/**
 * A public source that was not read. `retryable` when a later try may read it (the site did not answer, or timed out);
 * not when the site refused it (Forbidden site, robots, login wall, bot protection, gone) or it is no job offer.
 */
export class EmailSourceUnread extends Error {
  constructor(
    readonly reason: string,
    readonly retryable: boolean,
  ) {
    super(`Email source unread: ${reason}`);
    this.name = "EmailSourceUnread";
  }
}

/** Whether a failed source reading may succeed on the email's next try: any failure but a definite refusal. */
export function isRetryableSourceFailure(error: unknown): boolean {
  return error instanceof EmailSourceUnread ? error.retryable : true;
}

export function createEmailSourceReader(options: { fetch?: typeof globalThis.fetch; externalApis?: ExternalApiLog; forbiddenSites?: readonly string[]; clock?: Clock } = {}) {
  const fetch = options.fetch ?? globalThis.fetch;
  const reader = createPoliteFetcher({ fetch: options.externalApis ? recordingSiteFetch(fetch, options.externalApis) : fetch, userAgent: DEFAULT_USER_AGENT, forbiddenSites: options.forbiddenSites ?? FORBIDDEN_SITES, timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024, clock: options.clock });
  return async (url: string, ai: AiLayer): Promise<{ url: string; details: JobOfferDetails }> => {
    const page = await reader.page(url);
    if (page.ok !== true) {
      // reader.page is called without a `known` lookup: a failure is the only other answer.
      const reason = page.ok === false ? page.reason : "unreachable";
      throw new EmailSourceUnread(reason, reason === "unreachable");
    }
    if (metaRobots(page.html).some((value) => /\b(noindex|none)\b/.test(value))) throw new EmailSourceUnread("robots", false);
    const structured = readJobPosting(page.html);
    const details = structured ?? (countJobPostings(page.html) <= 1 ? await readJobPage(ai, null, htmlToText(page.html)) : null);
    if (!details) throw new EmailSourceUnread("not_a_job_offer", false);
    if (structured && (!details.skills || details.requiredExperienceYears === undefined || !details.location || !details.contractType || !details.salary)) {
      // Read only the public posting text. Existing structured fields remain authoritative.
      try {
        const fields = await readOfferFields(ai, { candidateId: null, jobOffer: details });
        for (const [key, value] of Object.entries(fields)) if (details[key as keyof JobOfferDetails] === undefined) Object.assign(details, { [key]: value });
      } catch {
        // The source was read: absent fields stay unknown, with the failed AI step in Provenance.
      }
    }
    return { url: page.url, details };
  };
}
