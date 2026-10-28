/**
 * Email intake's reading of a Received offer email in the worker (#445, ADR-0049, ADR-0052): its kind and offers, each
 * offer a Job Offer for the Candidate unless it is already there for them.
 *
 *   const reading = createEmailReading({ readings, jobOffers, profiles, ai, taskPlaybooks });
 *   await reading.read(receivedOfferEmailId); // { outcome: "offers_found" | "other" | "failed" | "not_awaiting" }, or throws to be tried again
 *
 * One try, as AI Activity shows its live steps and each Job Offer's Provenance keeps them:
 *  1. the email's text, taken with the Email intake Tool (`brevo-inbound`, read);
 *  2. one `offer_email_reading` call on the served version of « Lire un email d'offres d'emploi » (readOfferEmail):
 *     its kind (alert, recruiter, other) and offers; while no version is served, the try fails without a call;
 *  3. each offer's link through its sender's module (offer-links.ts); one linking to a Forbidden site makes no Job
 *     Offer: it is kept « À capturer »; one published more than 30 days ago (its stated date, else the email's) neither;
 *  4. the Match Score rules: each offer against each of the Candidate's active Profiles, counted against no Plan
 *     Quota; it goes to the highest, or to « Non classées » under 60;
 *  5. deduplication, before the Candidate sees anything: an offer already there for them (a Job Search, a Job Digest,
 *     an earlier email, an Application) is « déjà vue »; any other is stored, shared from an alert, private to the
 *     Candidate from a recruiter's message (ADR-0049), with its Provenance: steps 1–5 and the sender's domain as a site
 *     (never for an email the Candidate forwarded by hand: that domain is theirs).
 * A try that fails leaves the email awaiting, its text kept, and throws, for the job runner to try again; the
 * MAX_READING_TRIES-th, or one past the text's 72 hours, records it « échec ». Each AI call is in AI Usage under its task.
 */
import { readOfferEmail, createProvenanceRecorder, type AiLayer, type EmailOffer } from "@jobhub/ai";
import {
  believablePostingDate,
  createRunProgress,
  FORBIDDEN_SITES,
  isForbiddenSite,
  isPostingTooOld,
  joinProvenance,
  scoreMatch,
  type ContractType,
  type CvContent,
  type JobOfferDetails,
  type SearchCriteria,
} from "@jobhub/shared";
import { TEXT_RETENTION_HOURS } from "@jobhub/web/email-intake";
import type { EmailReadings, ReadEmailOffer } from "@jobhub/web/email-intake/reading";
import type { JobOffers } from "@jobhub/web/job-offers";
import { servedTaskRun, type TaskPlaybookReader } from "@jobhub/web/task-playbooks";
import { offerLink } from "./offer-links";

/** How many times an email is tried before it is « échec ». */
export const MAX_READING_TRIES = 3;

/** Under this Match Score, an offer goes to « Non classées » rather than a Profile. */
export const EMAIL_OFFER_MIN_MATCH_SCORE = 60;

/** Its Task Playbook: the version served is the one each email is read with. */
const PLAYBOOK = "job-offer-email-reading";

/** What a Profile is to the reading: its Search Criteria and Master CV, to score an offer. */
interface ProfileToScore {
  id: string;
  searchCriteria: SearchCriteria;
  masterCv: CvContent;
}

export interface EmailReadingOptions {
  /** The Received offer emails' store. */
  readings: EmailReadings;
  jobOffers: Pick<JobOffers, "capture" | "findBySourceUrl">;
  /** Satisfied by the web app's Profiles module. */
  profiles: {
    list(candidateId: string): Promise<{ id: string; archived: boolean }[]>;
    get(candidateId: string, profileId: string): Promise<{ id: string; archived: boolean; searchCriteria: SearchCriteria; masterCv: { content: CvContent } } | null>;
  };
  ai: AiLayer;
  /** The task Playbooks at the version this environment serves. Without it, no version is served: no email is read. */
  taskPlaybooks?: TaskPlaybookReader;
  /** Default: FORBIDDEN_SITES. */
  forbiddenSites?: readonly string[];
  now?: () => Date;
}

export type EmailReadOutcome = { outcome: "offers_found" | "other" | "failed" | "not_awaiting" };

export interface EmailReading {
  /** Reads one Received offer email (see above). Throws when a try failed and another is left. */
  read(receivedOfferEmailId: string): Promise<EmailReadOutcome>;
}

const HOUR_MS = 3_600_000;

/** The contract an offer's words name, when one of ours. */
function contractTypeOf(words: string | undefined): ContractType | undefined {
  if (!words) return undefined;
  if (/\bCDI\b|ind[ée]termin[ée]e/i.test(words)) return "cdi";
  if (/\bCDD\b|d[ée]termin[ée]e/i.test(words)) return "cdd";
  if (/int[ée]rim/i.test(words)) return "interim";
  if (/freelance|ind[ée]pendant|portage/i.test(words)) return "freelance";
  return undefined;
}

/** A Job Offer's fields from what the email says of an offer: its text is those words, one per line. */
function detailsOf(offer: EmailOffer): JobOfferDetails {
  // Who publishes it: the employer, else the firm recruiting for a client it does not name.
  const by = offer.employer ?? offer.intermediary;
  const lines = [
    offer.title,
    [by, offer.location].filter(Boolean).join(" – "),
    [offer.contract, offer.salary].filter(Boolean).join(" – "),
    offer.excerpt,
  ].filter((line): line is string => Boolean(line));
  const contractType = contractTypeOf(offer.contract);
  return {
    title: offer.title,
    content: lines.join("\n"),
    ...(offer.employer ? { employer: offer.employer } : {}),
    ...(offer.location ? { location: offer.location } : {}),
    ...(contractType ? { contractType } : {}),
  };
}

const hostOf = (link: string): string | null => (URL.canParse(link) ? new URL(link).hostname : null);

export function createEmailReading(options: EmailReadingOptions): EmailReading {
  const now = options.now ?? (() => new Date());
  const forbiddenSites = options.forbiddenSites ?? FORBIDDEN_SITES;
  const { readings, jobOffers } = options;

  async function activeProfiles(candidateId: string): Promise<ProfileToScore[]> {
    const listed = (await options.profiles.list(candidateId)).filter((profile) => !profile.archived);
    const profiles = await Promise.all(listed.map((profile) => options.profiles.get(candidateId, profile.id)));
    return profiles.flatMap((profile) => (profile && !profile.archived ? [{ id: profile.id, searchCriteria: profile.searchCriteria, masterCv: profile.masterCv.content }] : []));
  }

  /** The Profile an offer goes to and its Match Score there: the highest, or « Non classées » (null) under the minimum. */
  function bestProfile(details: JobOfferDetails, profiles: readonly ProfileToScore[]): { profileId: string | null; matchScore: number } {
    let best: { profileId: string; matchScore: number } | null = null;
    for (const profile of profiles) {
      const { score } = scoreMatch({ cv: profile.masterCv, searchCriteria: profile.searchCriteria, jobOffer: details, today: now() });
      // At an equal score, the oldest Profile.
      if (!best || score > best.matchScore) best = { profileId: profile.id, matchScore: score };
    }
    if (!best) return { profileId: null, matchScore: 0 };
    return best.matchScore >= EMAIL_OFFER_MIN_MATCH_SCORE ? best : { profileId: null, matchScore: best.matchScore };
  }

  return {
    async read(id) {
      const progress = createRunProgress((events) => readings.progress(id, events));
      const run = createProvenanceRecorder(options.ai, { now, onEvent: progress.onEvent });
      const email = await run.step({ tool: "brevo-inbound" }, () => readings.startTry(id));
      if (!email) return { outcome: "not_awaiting" };
      const failed = async (): Promise<EmailReadOutcome> => {
        await progress.flush();
        await readings.failed(id);
        return { outcome: "failed" };
      };
      if (email.text === null || now().getTime() - email.receivedAt.getTime() > TEXT_RETENTION_HOURS * HOUR_MS) return failed();
      const text = email.text;

      try {
        const served = await servedTaskRun(options.taskPlaybooks, PLAYBOOK, options.ai);
        if (!served) throw new Error(`No version of the Task Playbook "${PLAYBOOK}" is served: no email is read`);
        const { kind, offers } = await readOfferEmail(run.ai, { candidateId: email.candidateId, text, instructions: served.instructions() });
        if (!email.manualForward) run.site(`https://${email.senderDomain}/`);

        // Which offers may become Job Offers: not a Forbidden site's, not published more than 30 days ago.
        const at = now();
        const emailDate = believablePostingDate(email.sentAt ?? undefined, at) ?? email.receivedAt;
        const planned = offers.map((offer) => {
          const link = offer.link ? offerLink(offer.link) : null;
          const host = link ? hostOf(link) : offer.link ? hostOf(offer.link) : null;
          if (host && isForbiddenSite(host, forbiddenSites)) return link ? ({ disposition: "to_capture", title: offer.title, link } as const) : null;
          const postedAt = believablePostingDate(offer.postedAt, at) ?? emailDate;
          if (isPostingTooOld(postedAt, at)) return { disposition: "too_old" } as const;
          return { disposition: "candidate" as const, offer, link, postedAt, details: detailsOf(offer) };
        });
        const profiles = await activeProfiles(email.candidateId);
        const matched = await run.step({ rule: "match_score" }, () =>
          planned.map((plan) => (plan?.disposition === "candidate" ? bestProfile(plan.details, profiles) : null)),
        );
        const howRead = run.provenance();

        const recorded: ReadEmailOffer[] = [];
        const inThisEmail = new Set<string>();
        for (const [index, plan] of planned.entries()) {
          if (!plan) continue;
          if (plan.disposition !== "candidate") {
            recorded.push(plan);
            continue;
          }
          const part = run.part();
          if (plan.link) part.site(plan.link);
          const privateTo = kind === "recruiter" ? email.candidateId : undefined;
          // Deduplication, before the Candidate sees anything: the Job Offer stored for this link, and whether it is already there for them.
          const known = await part.step({ rule: "offer_dedup" }, async () => {
            const stored = plan.link ? await jobOffers.findBySourceUrl(plan.link, email.candidateId) : null;
            return stored && (inThisEmail.has(stored.id) || (await readings.alreadyThere(email.candidateId, stored.id))) ? stored.id : null;
          });
          if (known) {
            inThisEmail.add(known);
            recorded.push({ disposition: "seen", jobOfferId: known });
            continue;
          }
          const { title, content, employer, location, contractType } = plan.details;
          const captured = await jobOffers.capture(
            { source: plan.link ? { url: plan.link } : {}, title, content, ...(employer ? { employer } : {}), ...(location ? { location } : {}), ...(contractType ? { contractType } : {}) },
            "candidate",
            { postedAt: plan.postedAt, provenance: joinProvenance(howRead, part.provenance()) ?? undefined, ...(privateTo ? { privateTo } : {}) },
          );
          if (!captured.ok) continue;
          const jobOfferId = captured.jobOffer.id;
          if (!captured.created && (inThisEmail.has(jobOfferId) || (await readings.alreadyThere(email.candidateId, jobOfferId)))) {
            inThisEmail.add(jobOfferId);
            recorded.push({ disposition: "seen", jobOfferId });
            continue;
          }
          inThisEmail.add(jobOfferId);
          // Stored earlier with the same text and an older Posting date: the 30-day rule applies to it too.
          if (!captured.created && isPostingTooOld(captured.jobOffer.postedAt, at)) {
            recorded.push({ disposition: "too_old" });
            continue;
          }
          recorded.push({ disposition: "new", jobOfferId, ...matched[index]! });
        }

        await progress.flush();
        await readings.read(id, { kind, offers: recorded });
        return { outcome: recorded.length > 0 ? "offers_found" : "other" };
      } catch (error) {
        if (email.try >= MAX_READING_TRIES) return failed();
        await progress.flush();
        await readings.tryFailed(id);
        throw error;
      }
    },
  };
}
