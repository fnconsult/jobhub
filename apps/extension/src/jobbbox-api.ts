/**
 * The web app's API as the extension uses it for a Capture and a Guest's Match
 * Score. Every request carries the browser's session cookie (the extension's
 * host permission on the web app), so a signed-in Candidate is recognised and a
 * Guest is not. Problems come back as results, never exceptions.
 */
import type { CvContent, JobOffer, MatchScore } from "@jobhub/shared";
import type { CapturedJobOffer } from "./job-page";

/** Why a CV file could not be read (the web app's CV file error codes), or the web app could not be reached. */
export type ReadCvError = "unsupported_format" | "too_large" | "unreadable" | "empty" | "unreachable";

export type Result<T, E extends string> = ({ ok: true } & T) | { ok: false; error: E };

export interface JobbboxApi {
  /** Stores the captured Job Offer, or returns the one already stored for this posting. */
  capture(jobOffer: CapturedJobOffer): Promise<Result<{ jobOffer: JobOffer }, "invalid" | "unreachable">>;
  /** Reads a CV file (PDF or .docx). The web app keeps nothing. */
  readCv(file: File): Promise<Result<{ cv: CvContent }, ReadCvError>>;
  /** The Match Score of a CV against a Job Offer. "job_offer_gone": it has been forgotten since. */
  score(jobOfferId: string, cv: CvContent): Promise<Result<{ matchScore: MatchScore }, "job_offer_gone" | "failed" | "unreachable">>;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const CV_ERRORS = new Set<string>(["unsupported_format", "too_large", "unreadable", "empty"]);

export function createJobbboxApi(webOrigin: string, fetchImpl: Fetch = (url, init) => fetch(url, init)): JobbboxApi {
  /** The JSON reply and its status, or null when the web app cannot be reached. */
  async function request(path: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> } | null> {
    try {
      const response = await fetchImpl(`${webOrigin}${path}`, { ...init, credentials: "include" });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: response.status, body };
    } catch {
      return null;
    }
  }

  const postJson = (path: string, data: unknown) =>
    request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

  return {
    async capture(jobOffer) {
      const reply = await postJson("/api/job-offers", jobOffer);
      if (!reply) return { ok: false, error: "unreachable" };
      if (reply.status !== 200) return { ok: false, error: "invalid" };
      return { ok: true, jobOffer: reply.body as unknown as JobOffer };
    },

    async readCv(file) {
      const form = new FormData();
      form.append("cv", file, file.name);
      const reply = await request("/api/cv/draft", { method: "POST", body: form });
      if (!reply) return { ok: false, error: "unreachable" };
      if (reply.status !== 200) {
        const code = String(reply.body.error);
        return { ok: false, error: CV_ERRORS.has(code) ? (code as ReadCvError) : "unreadable" };
      }
      return { ok: true, cv: reply.body.masterCv as CvContent };
    },

    async score(jobOfferId, cv) {
      const reply = await postJson("/api/match-score", { jobOfferId, cv });
      if (!reply) return { ok: false, error: "unreachable" };
      if (reply.status === 404) return { ok: false, error: "job_offer_gone" };
      if (reply.status !== 200) return { ok: false, error: "failed" };
      return { ok: true, matchScore: reply.body as unknown as MatchScore };
    },
  };
}
