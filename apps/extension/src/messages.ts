/**
 * Messages between the extension's parts. The background turns an "analyse"
 * message (from the badge or the Side Panel) into a Capture: from the badge, it
 * opens the Side Panel beside it, then stores the Job Offer and keeps it in the
 * Guest session, where the panel reads it (src/side-panel.ts).
 */
import type { CapturedJobOffer } from "./job-page";

export type ExtensionMessage =
  | { type: "analyse"; jobOffer: CapturedJobOffer }
  | { type: "interface-language" }
  /** From the badge content script: the Job Sites to use (src/job-sites.ts). */
  | { type: "job-sites" };

export type AnalyseReply = { ok: true } | { ok: false; error: "invalid" | "unreachable" };
