/**
 * A Guest session: the captured Job Offer and the Guest's CV, kept in the
 * browser's session storage only (in memory, gone when the browser closes) and
 * forgotten GUEST_RETENTION_HOURS after the session began, however often it
 * is used, so a Guest's data never lasts more than 24 hours (ADR-0003).
 * The CV never leaves the browser except to be read and scored, and the server
 * keeps neither (ADR-0003); this session is the only place it is kept.
 */
import { GUEST_RETENTION_HOURS, type CvContent, type JobOffer } from "@jobhub/shared";

/** The part of chrome.storage.session this module uses. */
export interface SessionStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface GuestSessionContent {
  jobOffer?: JobOffer;
  cv?: CvContent;
  /** When everything here is forgotten (ms since the epoch). */
  expiresAt?: number;
}

export interface GuestSession {
  /** What the session holds; empty once it has expired. */
  read(): Promise<GuestSessionContent>;
  keepJobOffer(jobOffer: JobOffer): Promise<void>;
  keepCv(cv: CvContent): Promise<void>;
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

  async function keep(change: Pick<GuestSessionContent, "jobOffer" | "cv">) {
    const current = await read();
    await storage.set({ [KEY]: { ...current, ...change, expiresAt: current.expiresAt ?? now() + RETENTION_MS } });
  }

  return {
    read,
    keepJobOffer: (jobOffer) => keep({ jobOffer }),
    keepCv: (cv) => keep({ cv }),
    forget: () => storage.remove(KEY),
  };
}
