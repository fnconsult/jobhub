/**
 * A Guest session: the captured Job Offer and the Guest's CV, kept in the
 * browser's session storage only (in memory, gone when the browser closes) and
 * forgotten GUEST_RETENTION_HOURS after the session began, however often it
 * is used, so a Guest's data never lasts more than 24 hours (ADR-0003).
 * The CV never leaves the browser except to be read and scored, and the server
 * keeps neither (ADR-0003); this session is the only place it is kept.
 */
import { GUEST_RETENTION_HOURS, type CvContent, type JobOffer, type MatchScore } from "@jobhub/shared";

/** The part of chrome.storage.session this module uses. */
export interface SessionStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/** The Search Criteria read from a CV with it: the Profile the CV becomes if the Guest signs up starts from them. */
export interface SearchCriteriaDraft {
  targetRole: string;
  location: string;
}

/** Where the work went once saved in the Candidate's account: the Application, and the Profile made from the CV, if one was. */
export interface SavedWork {
  applicationId: string;
  jobOffer: JobOffer;
  newProfile: { id: string; name: string } | null;
}

/** The last Match Score, with the Job Offer and CV it was computed for: shown again rather than computed again. */
export interface KeptMatchScore {
  jobOfferId: string;
  cv: CvContent;
  matchScore: MatchScore;
}

export interface GuestSessionContent {
  jobOffer?: JobOffer;
  cv?: CvContent;
  searchCriteria?: SearchCriteriaDraft;
  matchScore?: KeptMatchScore;
  /** Set once the work is saved in an account (it is then all that is left), until another Job Offer is captured. */
  saved?: SavedWork;
  /** When everything here is forgotten (ms since the epoch). */
  expiresAt?: number;
}

export interface GuestSession {
  /** What the session holds; empty once it has expired. */
  read(): Promise<GuestSessionContent>;
  keepJobOffer(jobOffer: JobOffer): Promise<void>;
  /** Keeps the CV, with the Search Criteria read from it (replacing any earlier CV's). */
  keepCv(cv: CvContent, searchCriteria?: SearchCriteriaDraft): Promise<void>;
  keepMatchScore(kept: KeptMatchScore): Promise<void>;
  /** The work is saved in the Candidate's account: forgets the CV and the Job Offer, keeping only where they went. */
  keepSaved(saved: SavedWork): Promise<void>;
  /** Forgets everything now. */
  forget(): Promise<void>;
}

const KEY = "guestSession";
const RETENTION_MS = GUEST_RETENTION_HOURS * 3_600_000;

export function createGuestSession(storage: SessionStorage, now: () => number = Date.now): GuestSession {
  async function read(): Promise<GuestSessionContent> {
    const stored = (await storage.get(KEY))[KEY] as GuestSessionContent | undefined;
    if (!stored) return {};
    if (typeof stored.expiresAt !== "number" || stored.expiresAt <= now()) {
      await storage.remove(KEY);
      return {};
    }
    return stored;
  }

  async function keep(change: Omit<GuestSessionContent, "expiresAt">, { replace = false } = {}) {
    const current = await read();
    const kept = replace ? {} : current;
    await storage.set({ [KEY]: { ...kept, ...change, expiresAt: current.expiresAt ?? now() + RETENTION_MS } });
  }

  return {
    read,
    keepJobOffer: (jobOffer) => keep({ jobOffer, saved: undefined }),
    keepCv: (cv, searchCriteria) => keep({ cv, searchCriteria }),
    keepMatchScore: (matchScore) => keep({ matchScore }),
    keepSaved: (saved) => keep({ saved }, { replace: true }),
    forget: () => storage.remove(KEY),
  };
}
