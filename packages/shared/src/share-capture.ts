/**
 * Share capture (#697, ADR-0076): a job posting sent to the Jobbbox app from another app's share sheet. The iOS share
 * extension and the Android share intent open the app with the share link (`shareLink`): its address in the app's
 * scheme, at SHARE_PATH, carrying what was shared (a web link, a text, or both), which the app reads back
 * (`readShareLink`) for the capture screen. The link lives only while the app opens it: nothing of it is stored.
 * The app sends it to `POST /api/share-captures`, which answers `ShareCaptureAnswer`.
 */
import * as z from "zod";
import { APP_SCHEME } from "./native-app";

/** The capture screen's address in the app, which the share link opens. */
export const SHARE_PATH = "/partage";

/** What was shared: a web link, a text (which may hold a link), or both. */
export interface SharedContent {
  url?: string;
  text?: string;
}

/** The app's address that opens the capture screen on `shared`. */
export function shareLink(shared: SharedContent): string {
  const query = new URLSearchParams();
  if (shared.url) query.set("url", shared.url);
  if (shared.text) query.set("text", shared.text);
  return `${APP_SCHEME}://${SHARE_PATH.slice(1)}?${query.toString()}`;
}

/**
 * What a share link carries, or null when `link` is no share link or carries nothing: the app's address at SHARE_PATH,
 * as `jobbbox://partage?…`, `jobbbox:///partage?…` or Expo Router's own path `/partage?…`.
 */
export function readShareLink(link: string | null | undefined): SharedContent | null {
  if (!link) return null;
  const [address = "", query = ""] = link.split(/\?(.*)/s);
  const path = address.startsWith(`${APP_SCHEME}:`) ? `/${address.slice(APP_SCHEME.length + 1).replace(/^\/+/, "")}` : address;
  if (path.replace(/\/+$/, "") !== SHARE_PATH) return null;
  const params = new URLSearchParams(query);
  const url = params.get("url")?.trim();
  const text = params.get("text");
  const shared: SharedContent = { ...(url ? { url } : {}), ...(text?.trim() ? { text } : {}) };
  return shared.url || shared.text ? shared : null;
}

/** Why the link could not be read, so the screen asks for the offer's text. */
export const TEXT_NEEDED_REASONS = ["forbidden_site", "unreadable", "not_a_job_offer"] as const;

/**
 * The answer of `POST /api/share-captures`: 200 the Private Job Offer and the conversation it opened in; 422 the text
 * needed (and why) or no Job Offer in the text; 400 nothing a share can be; 503 the AI could not read the text.
 */
export const shareCaptureAnswerSchema = z.union([
  z.object({
    jobOffer: z.object({ id: z.string(), title: z.string(), employer: z.string().nullable() }),
    conversation: z.object({ id: z.string(), title: z.string() }),
  }),
  z.object({ error: z.literal("text_needed"), reason: z.enum(TEXT_NEEDED_REASONS) }),
  z.object({ error: z.enum(["not_a_job_offer", "unavailable", "invalid"]) }),
]);
export type ShareCaptureAnswer = z.infer<typeof shareCaptureAnswerSchema>;
