import type { CvContent, JobOffer, MatchScore } from "@jobhub/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGuestSession, type SessionStorage } from "./guest-session";
import type { JobbboxApi, UpgradePrompt } from "./jobbbox-api";
import { createMatchScoring, SCORE_TIMEOUT_MS } from "./match-scoring";

/** The browser's session storage (chrome.storage.session): in memory, gone when the browser closes. */
function memoryStorage(): SessionStorage {
  const items: Record<string, unknown> = {};
  return {
    async get(key) {
      return key in items ? { [key]: structuredClone(items[key]) } : {};
    },
    async set(values) {
      Object.assign(items, structuredClone(values));
    },
    async remove(key) {
      delete items[key];
    },
  };
}

const HOUR = 3_600_000;
const jobOffer: JobOffer = { id: "jo-1", source: { url: "https://www.apec.fr/offre/1" }, title: "DAF", content: "Poste de DAF." };
const otherJobOffer: JobOffer = { ...jobOffer, id: "jo-2", source: { url: "https://www.apec.fr/offre/2" } };
const cv = { fullName: "Marie Dupont", skills: ["IFRS"] } as CvContent;
const otherCv = { fullName: "Marie Dupont", skills: ["IFRS", "SAP"] } as CvContent;
const prompt: UpgradePrompt = { message: "Your Plan includes 3 Match Scores a month.", action: "Upgrade", href: "/abonnement" };

/** `/api/match-score`, counting the Match Scores it computes; past `quota`, it refuses with the Upgrade Prompt. */
function matchScoreApi({ quota = Infinity } = {}) {
  const requests: { jobOfferId: string; cv: CvContent }[] = [];
  const api: Pick<JobbboxApi, "score"> = {
    async score(jobOfferId, cv) {
      requests.push({ jobOfferId, cv });
      if (requests.length > quota) return { ok: false, error: "quota_exceeded", prompt };
      const matchScore: MatchScore = {
        score: 50 + requests.length,
        breakdown: {
          skills: { status: "unknown", covered: [], missing: [] },
          seniority: { status: "unknown" },
          location: { status: "unknown" },
          salary: { status: "unknown" },
          contractType: { status: "unknown" },
        },
      };
      return { ok: true, matchScore };
    },
  };
  return { api, requests };
}

/** The browser's Web Locks (navigator.locks): one holder at a time across every page of the extension. */
function memoryLock() {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const turn = last.then(work, work);
    last = turn.catch(() => undefined);
    return turn;
  };
}

function setUp({ quota = Infinity } = {}) {
  const storage = memoryStorage();
  const lock = memoryLock();
  let now = 0;
  const clock = { set: (ms: number) => (now = ms) };
  const session = () => createGuestSession(storage, () => now);
  const { api, requests } = matchScoreApi({ quota });
  // A new scoring per page load, as the analysis page creates on each open.
  const scoring = () => createMatchScoring({ api, session: session(), lock });
  return { session, scoring, requests, clock };
}

describe("scoring a CV against a Job Offer from the extension", () => {
  it("shows the kept Match Score on reopen, for the same Job Offer and CV, without computing it again", async () => {
    const { session, scoring, requests } = setUp();
    await session().keepJobOffer(jobOffer);
    await session().keepCv(cv);

    const first = await scoring().score(jobOffer, cv);
    const reopened = await scoring().score(jobOffer, cv);

    expect(requests).toHaveLength(1);
    expect(reopened).toEqual(first);
    expect(first).toMatchObject({ ok: true, matchScore: { score: 51 } });
  });

  it("computes one Match Score when two analysis pages show the same Job Offer and CV at once, before any is kept", async () => {
    const { session, scoring, requests } = setUp();
    await session().keepJobOffer(jobOffer);
    await session().keepCv(cv);

    // A tab reloading on sign-in while another one scores: both find no kept Match Score.
    const [first, second] = await Promise.all([scoring().score(jobOffer, cv), scoring().score(jobOffer, cv)]);

    expect(requests).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("computes a new Match Score for another CV, and keeps that one instead", async () => {
    const { session, scoring, requests } = setUp();
    await session().keepJobOffer(jobOffer);
    await session().keepCv(cv);
    await scoring().score(jobOffer, cv);

    await session().keepCv(otherCv);
    expect(await scoring().score(jobOffer, otherCv)).toMatchObject({ ok: true, matchScore: { score: 52 } });
    expect(await scoring().score(jobOffer, otherCv)).toMatchObject({ ok: true, matchScore: { score: 52 } });

    expect(requests).toEqual([{ jobOfferId: "jo-1", cv }, { jobOfferId: "jo-1", cv: otherCv }]);
  });

  it("computes a new Match Score for another captured Job Offer", async () => {
    const { session, scoring, requests } = setUp();
    await session().keepJobOffer(jobOffer);
    await session().keepCv(cv);
    await scoring().score(jobOffer, cv);

    await session().keepJobOffer(otherJobOffer);
    expect(await scoring().score(otherJobOffer, cv)).toMatchObject({ ok: true, matchScore: { score: 52 } });

    expect(requests.map((request) => request.jobOfferId)).toEqual(["jo-1", "jo-2"]);
  });

  it("computes a new Match Score when one is asked for, and keeps it", async () => {
    const { session, scoring, requests } = setUp();
    await session().keepJobOffer(jobOffer);
    await session().keepCv(cv);
    await scoring().score(jobOffer, cv);

    expect(await scoring().score(jobOffer, cv, { rescore: true })).toMatchObject({ ok: true, matchScore: { score: 52 } });
    expect(await scoring().score(jobOffer, cv)).toMatchObject({ ok: true, matchScore: { score: 52 } });

    expect(requests).toHaveLength(2);
  });

  it("forgets the kept Match Score with the rest of the session, when asked", async () => {
    const { session, scoring, requests } = setUp();
    await session().keepJobOffer(jobOffer);
    await session().keepCv(cv);
    await scoring().score(jobOffer, cv);

    await session().forget();

    expect(await session().read()).toEqual({});
    await scoring().score(jobOffer, cv);
    expect(requests).toHaveLength(2);
  });

  it("forgets the kept Match Score with the rest of the session, 23 hours after it began (ADR-0003)", async () => {
    const { session, scoring, requests, clock } = setUp();
    await session().keepJobOffer(jobOffer);
    await session().keepCv(cv);
    clock.set(22 * HOUR);
    await scoring().score(jobOffer, cv);

    clock.set(23 * HOUR);
    expect(await session().read()).toEqual({});
    await scoring().score(jobOffer, cv);
    expect(requests).toHaveLength(2);
  });

  it("keeps nothing when the session is forgotten while the Match Score is being computed (ADR-0003)", async () => {
    const { session } = setUp();
    await session().keepJobOffer(jobOffer);
    await session().keepCv(cv);
    const { api } = matchScoreApi();
    const forgetMidway: Pick<JobbboxApi, "score"> = {
      async score(jobOfferId, scoredCv) {
        await session().forget();
        return api.score(jobOfferId, scoredCv);
      },
    };

    expect(await createMatchScoring({ api: forgetMidway, session: session(), lock: memoryLock() }).score(jobOffer, cv)).toMatchObject({ ok: true });

    expect(await session().read()).toEqual({});
  });

  it("keeps nothing when the session expires while the Match Score is being computed (ADR-0003)", async () => {
    const { session, clock } = setUp();
    await session().keepJobOffer(jobOffer);
    await session().keepCv(cv);
    const { api } = matchScoreApi();
    const slow: Pick<JobbboxApi, "score"> = {
      async score(jobOfferId, scoredCv) {
        clock.set(23 * HOUR);
        return api.score(jobOfferId, scoredCv);
      },
    };

    await createMatchScoring({ api: slow, session: session(), lock: memoryLock() }).score(jobOffer, cv);

    expect(await session().read()).toEqual({});
  });

  it("keeps no Match Score for a CV replaced while it was being computed", async () => {
    const { session } = setUp();
    await session().keepJobOffer(jobOffer);
    await session().keepCv(cv);
    const { api } = matchScoreApi();
    const replaceCvMidway: Pick<JobbboxApi, "score"> = {
      async score(jobOfferId, scoredCv) {
        await session().keepCv(otherCv);
        return api.score(jobOfferId, scoredCv);
      },
    };

    await createMatchScoring({ api: replaceCvMidway, session: session(), lock: memoryLock() }).score(jobOffer, cv);

    expect((await session().read()).matchScore).toBeUndefined();
  });

  it("keeps no refusal: past the quota, the Upgrade Prompt is shown on every attempt", async () => {
    const { session, scoring, requests } = setUp({ quota: 0 });
    await session().keepJobOffer(jobOffer);
    await session().keepCv(cv);

    expect(await scoring().score(jobOffer, cv)).toEqual({ ok: false, error: "quota_exceeded", prompt });
    expect(await scoring().score(jobOffer, cv)).toEqual({ ok: false, error: "quota_exceeded", prompt });

    expect(requests).toHaveLength(2);
    expect((await session().read()).matchScore).toBeUndefined();
  });

  it("keeps the last Match Score while a rescore past the quota shows the Upgrade Prompt", async () => {
    const { session, scoring } = setUp({ quota: 1 });
    await session().keepJobOffer(jobOffer);
    await session().keepCv(cv);
    await scoring().score(jobOffer, cv);

    expect(await scoring().score(jobOffer, cv, { rescore: true })).toMatchObject({ ok: false, error: "quota_exceeded" });
    expect(await scoring().score(jobOffer, cv)).toMatchObject({ ok: true, matchScore: { score: 51 } });
  });

  describe("when a Match Score never comes", () => {
    afterEach(() => void vi.useRealTimers());
    const stalled: Pick<JobbboxApi, "score"> = { score: () => new Promise(() => {}) };

    it("stops waiting for a score request that never answers, after a bounded time, so it can be tried again", async () => {
      vi.useFakeTimers();
      const { session } = setUp();
      await session().keepJobOffer(jobOffer);
      await session().keepCv(cv);
      const scored = createMatchScoring({ api: stalled, session: session(), lock: memoryLock() }).score(jobOffer, cv);

      await vi.advanceTimersByTimeAsync(SCORE_TIMEOUT_MS);

      expect(await scored).toEqual({ ok: false, error: "unreachable" });
    });

    it("lets another page score once a stalled request was given up", async () => {
      vi.useFakeTimers();
      const { session } = setUp();
      await session().keepJobOffer(jobOffer);
      await session().keepCv(cv);
      const lock = memoryLock();
      const givenUp = createMatchScoring({ api: stalled, session: session(), lock }).score(jobOffer, cv);
      await vi.advanceTimersByTimeAsync(SCORE_TIMEOUT_MS);
      await givenUp;

      const { api } = matchScoreApi();
      const next = createMatchScoring({ api, session: session(), lock }).score(jobOffer, cv);
      await vi.advanceTimersByTimeAsync(0);

      expect(await next).toMatchObject({ ok: true, matchScore: { score: 51 } });
    });

    it("stops waiting for another page's Match Score that never finishes, after a bounded time", async () => {
      vi.useFakeTimers();
      const { session } = setUp();
      await session().keepJobOffer(jobOffer);
      await session().keepCv(cv);
      const { api, requests } = matchScoreApi();
      // Another analysis page holds the lock and never lets it go.
      const lock = memoryLock();
      void lock(() => new Promise(() => {}));
      const waiting = createMatchScoring({ api, session: session(), lock }).score(jobOffer, cv);

      await vi.advanceTimersByTimeAsync(SCORE_TIMEOUT_MS);

      expect(await waiting).toEqual({ ok: false, error: "unreachable" });
      expect(requests).toHaveLength(0);
    });
  });
});
