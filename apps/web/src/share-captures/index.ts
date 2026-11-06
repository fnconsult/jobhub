/**
 * Share capture (#697, ADR-0076): a job posting the Candidate sends to Jobbbox from another app's share sheet, in the
 * Jobbbox app, becomes their Private Job Offer (ADR-0049), opened in its own Coach Conversation.
 *
 * One deep module. Callers get `createShareCaptures(deps).capture(candidateId, input, language)`, which never throws for
 * what was shared. `input` is untrusted, as the share sheet gave it and the Candidate checked it: `{ url?, text? }`.
 *  - The link is `url`, else the first web link in `text`. It is read on the server, never on the device, the way a Job
 *    Offer link is (../job-offer-links: ADR-0002's robots rules, as ourselves, giving up at bot protection or a sign-in,
 *    a Forbidden site never requested), as the Candidate's Private Job Offer.
 *  - Where those rules refuse it, the offer's text is needed: the text shared with it, when it is more than the few words
 *    an app's share sheet puts around a link (`MIN_OFFER_TEXT_CHARS`), else `text_needed`, so the app asks the Candidate
 *    to share or paste it. A text with no link is the offer's text too.
 *  - The offer's text is read by the AI as data (`offer_analysis`, the page's text passed as data it cannot close, as a
 *    Job Offer link's page text is: ADR-0022), into a Private Job Offer whose source is the link, if any, never fetched.
 *    `not_a_job_offer` when the AI reads no single posting in it, `unavailable` when the AI could not read it (nothing
 *    is kept, the Candidate sends it again). A date it states is not trusted: nothing from the device is.
 *  - The Job Offer is deduplicated as any Job Offer (ADR-0013), within the Candidate's own Private Job Offers: sharing the
 *    same posting twice gives the same Job Offer.
 *  - It opens a new Coach Conversation (`startAbout`): the Candidate's message and the set reply, which suggests
 *    « Scorer contre mon profil », with its Job Offer card and the Provenance of the reading. No Plan Quota is counted,
 *    as for a Capture or a Job Offer link: the Match Score asked afterwards is (`POST /api/match-score`).
 * Nothing of what was shared is kept beyond the Private Job Offer: neither text is saved, logged, nor written into the
 * conversation, whose two messages name only the Job Offer's title.
 */
import { createProvenanceRecorder, readJobPage, type AiLayer, type TaskInstructions } from "@jobhub/ai";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import * as z from "zod";
import type { CoachConversations } from "../coach-conversations";
import { findJobOfferLink, type JobOfferLinkResult, type JobOfferLinks } from "../job-offer-links";
import type { JobOffers } from "../job-offers";

/** What the share asks of the Candidate when the link cannot be read: why, so the screen can say it. */
export type TextNeededReason = Extract<JobOfferLinkResult, { ok: false }>["reason"];

export type ShareCaptureResult =
  | { ok: true; jobOffer: { id: string; title: string; employer?: string }; conversation: { id: string; title: string } }
  | { ok: false; error: "text_needed"; reason: TextNeededReason }
  | { ok: false; error: "not_a_job_offer" | "unavailable" | "invalid" };

export interface ShareCaptures {
  capture(candidateId: string, input: unknown, language: Locale): Promise<ShareCaptureResult>;
}

export interface ShareCapturesDeps {
  ai: AiLayer;
  links: Pick<JobOfferLinks, "read">;
  jobOffers: Pick<JobOffers, "capture">;
  conversations: Pick<CoachConversations, "startAbout">;
  /** The served "job-offer-reading" task Playbook, if any. Default: none (no summary, no sector). */
  reading?: () => Promise<TaskInstructions | null>;
}

/** The fewest characters, the link left out, that are read as an offer's text rather than the words around a link. */
export const MIN_OFFER_TEXT_CHARS = 200;
/** As much text as a Job Offer holds. */
export const MAX_SHARED_TEXT_CHARS = 100_000;

const inputSchema = z
  .object({
    url: z.url({ protocol: /^https?$/ }).max(2000).optional(),
    text: z.string().max(MAX_SHARED_TEXT_CHARS).optional(),
  })
  .refine((shared) => shared.url !== undefined || (shared.text ?? "").trim() !== "");

export function createShareCaptures(deps: ShareCapturesDeps): ShareCaptures {
  return {
    async capture(candidateId, input, language) {
      const parsed = inputSchema.safeParse(input ?? {});
      if (!parsed.success) return { ok: false, error: "invalid" };
      const text = parsed.data.text ?? "";
      const url = parsed.data.url ?? findJobOfferLink(text);
      const offerText = (url ? text.replace(url, " ") : text).replace(/\s+/g, " ").trim().length >= MIN_OFFER_TEXT_CHARS ? text.trim() : null;
      const recorder = createProvenanceRecorder(deps.ai);

      let read: JobOfferLinkResult | null = null;
      if (url) {
        read = await deps.links.read(candidateId, url, recorder, { privately: true });
        if (!read.ok && !offerText) return { ok: false, error: "text_needed", reason: read.reason };
      } else if (!offerText) return { ok: false, error: "text_needed", reason: "not_a_job_offer" };

      const jobOffer = read?.ok ? read.jobOffer : await readText(offerText!);
      if (jobOffer === "unavailable") return { ok: false, error: "unavailable" };
      if (!jobOffer) return { ok: false, error: "not_a_job_offer" };

      const { t } = createI18n(language);
      const conversation = await deps.conversations.startAbout(candidateId, jobOffer, {
        message: t("shareCapture.message", { title: jobOffer.title }),
        reply: t("shareCapture.reply"),
        provenance: recorder.provenance(),
      });
      return {
        ok: true,
        jobOffer: { id: jobOffer.id, title: jobOffer.title, ...(jobOffer.employer ? { employer: jobOffer.employer } : {}) },
        conversation: { id: conversation.id, title: conversation.title },
      };

      /** The offer's text read by the AI as data, captured as the Candidate's Private Job Offer from the link, if any. */
      async function readText(shared: string) {
        let details: Awaited<ReturnType<typeof readJobPage>>;
        try {
          details = await readJobPage(recorder.aiFor("read_job_page"), candidateId, shared, (await deps.reading?.()) ?? null);
        } catch (error) {
          // Its name only: never the text, which is the Candidate's.
          console.warn("[share-captures] a shared text could not be read:", error instanceof Error ? error.name : "unknown");
          return "unavailable" as const;
        }
        if (!details) return null;
        // A date the text states is the device's word: left out, as a browser's is.
        const { title, content, employer, location, contractType, remoteWork, salary, skills, requiredExperienceYears, summary, sector, subsector } = details;
        const posting = { source: url ? { url } : {}, title, content, employer, location, contractType, remoteWork, salary, skills, requiredExperienceYears };
        const trusted = { privateTo: candidateId, provenance: recorder.provenance(), ...(summary && { summary }), ...(sector && { sector }), ...(subsector && { subsector }) };
        const captured = await deps.jobOffers.capture(posting, "candidate", trusted);
        return captured.ok ? captured.jobOffer : null;
      }
    },
  };
}
