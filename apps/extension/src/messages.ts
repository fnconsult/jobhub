/**
 * Messages between the extension's parts. The background turns an "analyse"
 * message (from the badge or the popup) into a Capture: it stores the Job
 * Offer, keeps it in the Guest session and opens the analysis page.
 */
import type { CapturedJobOffer } from "./job-page";

export type ExtensionMessage =
  | { type: "analyse"; jobOffer: CapturedJobOffer }
  | { type: "interface-language" }
  /** To the badge content script, on job sites: the Job Offer its page describes. */
  | { type: "capture" };

export type AnalyseReply = { ok: true } | { ok: false; error: "invalid" | "unreachable" };
