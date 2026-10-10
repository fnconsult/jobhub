/**
 * The web app's API as the extension uses it for a Capture, a Match Score and
 * saving the captured Job Offer as an Application. Every request carries the browser's session cookie (the extension's
 * host permission on the web app), so a signed-in Candidate is recognised and a
 * Guest is not. Problems come back as results, never exceptions.
 */
import type { CvContent, JobOffer, MatchScore } from "@jobhub/shared";
import type { SearchCriteriaDraft } from "./guest-session";
import type { CapturedJobOffer } from "./job-page";

/** Why a CV file could not be read (the web app's CV file error codes), or the web app could not be reached. */
export type ReadCvError = "unsupported_format" | "too_large" | "unreadable" | "empty" | "unreachable";

export type Result<T, E extends string> = ({ ok: true } & T) | { ok: false; error: E };

/** What the web app tells a Candidate whose Plan Quota is used up: the message, and the link to a Plan that allows more (no action when none does). */
export interface UpgradePrompt {
  message: string;
  action: string | null;
  /** Path on the web app (the subscription page). */
  href: string;
}

export interface JobbboxApi {
  /** Stores the captured Job Offer, or returns the one already stored for this posting. */
  capture(jobOffer: CapturedJobOffer): Promise<Result<{ jobOffer: JobOffer }, "invalid" | "unreachable">>;
  /** Reads a CV file (PDF or .docx), and the Search Criteria it suggests. The web app keeps nothing. */
  readCv(file: File): Promise<Result<{ cv: CvContent; searchCriteria: SearchCriteriaDraft }, ReadCvError>>;
  /**
   * The Match Score of a Job Offer against one of the signed-in Candidate's Profiles (its Master CV and
   * Search Criteria), or against a CV and the Search Criteria read from it.
   * "job_offer_gone" (a CV): the Job Offer has been forgotten since. "not_found" (a Profile): the Job Offer
   * or the Profile is gone. "signed_out" (a Profile): nobody is signed in any more.
   * "quota_exceeded": the signed-in Candidate's Plan allows no more Match Scores this month.
   */
  score(
    jobOfferId: string,
    against: ScoreAgainst,
  ): Promise<
    | Result<{ matchScore: MatchScore }, "job_offer_gone" | "not_found" | "signed_out" | "failed" | "unreachable">
    | { ok: false; error: "quota_exceeded"; prompt: UpgradePrompt }
  >;
  /** The signed-in Candidate's active Profiles, oldest first. "signed_out": nobody is signed in on the web app. */
  profiles(): Promise<Result<{ profiles: ProfileOption[] }, "signed_out" | "unreachable">>;
  /**
   * Saves a CV and its Search Criteria as a new Profile of the signed-in Candidate.
   * "invalid": the Search Criteria lack a target role or a location.
   * "plan_quota_reached": their Plan allows no more Profiles (with the Upgrade Prompt, if a Plan allows more).
   */
  createProfile(
    cv: CvContent,
    searchCriteria: SearchCriteriaDraft,
  ): Promise<
    | Result<{ profileId: string }, "invalid" | "signed_out" | "failed" | "unreachable">
    | { ok: false; error: "plan_quota_reached"; prompt: UpgradePrompt | null }
  >;
  /**
   * Saves a Job Offer as an Application ("À postuler") with one of the Candidate's Profiles,
   * or returns the one they already have for it. "not_found": the Job Offer or the Profile is gone.
   */
  saveApplication(jobOfferId: string, profileId: string): Promise<Result<{ applicationId: string }, "not_found" | "signed_out" | "failed" | "unreachable">>;
}

/** What a Job Offer is scored against: one of the signed-in Candidate's Profiles, or a CV (with the Search Criteria read from it). */
export type ScoreAgainst = { profileId: string } | { cv: CvContent; searchCriteria?: SearchCriteriaDraft };

/** One of the Candidate's Profiles, as offered to choose from. */
export interface ProfileOption {
  id: string;
  name: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const CV_ERRORS = new Set<string>(["unsupported_format", "too_large", "unreadable", "empty"]);

function upgradePromptIn(body: Record<string, unknown>): UpgradePrompt | null {
  const prompt = body.prompt as Record<string, unknown> | undefined;
  if (typeof prompt?.message !== "string" || typeof prompt.href !== "string") return null;
  return { message: prompt.message, action: typeof prompt.action === "string" ? prompt.action : null, href: prompt.href };
}

/** The web app requires both a target role and a location in Search Criteria: those read from a CV are sent only then. */
function scoreRequest(against: ScoreAgainst) {
  if ("profileId" in against) return { profileId: against.profileId };
  const { cv, searchCriteria } = against;
  return searchCriteria?.targetRole.trim() && searchCriteria.location.trim() ? { cv, searchCriteria } : { cv };
}

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
      const criteria = (reply.body.searchCriteria ?? {}) as Partial<SearchCriteriaDraft>;
      const searchCriteria = { targetRole: String(criteria.targetRole ?? ""), location: String(criteria.location ?? "") };
      return { ok: true, cv: reply.body.masterCv as CvContent, searchCriteria };
    },

    async score(jobOfferId, against) {
      const reply = await postJson("/api/match-score", { jobOfferId, ...scoreRequest(against) });
      if (!reply) return { ok: false, error: "unreachable" };
      if (reply.status === 404) return { ok: false, error: "profileId" in against ? "not_found" : "job_offer_gone" };
      if (reply.status === 401) return { ok: false, error: "signed_out" };
      if (reply.status === 402) {
        const prompt = upgradePromptIn(reply.body);
        if (prompt) return { ok: false, error: "quota_exceeded", prompt };
      }
      if (reply.status !== 200) return { ok: false, error: "failed" };
      return { ok: true, matchScore: reply.body as unknown as MatchScore };
    },

    async profiles() {
      const reply = await request("/api/profiles", { method: "GET" });
      if (!reply) return { ok: false, error: "unreachable" };
      if (reply.status === 401) return { ok: false, error: "signed_out" };
      if (reply.status !== 200 || !Array.isArray(reply.body)) return { ok: false, error: "unreachable" };
      return { ok: true, profiles: (reply.body as ProfileOption[]).map(({ id, name }) => ({ id, name })) };
    },

    async createProfile(cv, searchCriteria) {
      const reply = await postJson("/api/profiles", { masterCv: cv, searchCriteria });
      if (!reply) return { ok: false, error: "unreachable" };
      if (reply.status === 201) return { ok: true, profileId: String(reply.body.id) };
      if (reply.status === 400) return { ok: false, error: "invalid" };
      if (reply.status === 401) return { ok: false, error: "signed_out" };
      if (reply.status === 409) return { ok: false, error: "plan_quota_reached", prompt: upgradePromptIn(reply.body) };
      return { ok: false, error: "failed" };
    },

    async saveApplication(jobOfferId, profileId) {
      const reply = await postJson("/api/applications", { jobOfferId, profileId });
      if (!reply) return { ok: false, error: "unreachable" };
      if (reply.status === 200 || reply.status === 201) return { ok: true, applicationId: String(reply.body.id) };
      if (reply.status === 401) return { ok: false, error: "signed_out" };
      if (reply.status === 404) return { ok: false, error: "not_found" };
      return { ok: false, error: "failed" };
    },
  };
}
