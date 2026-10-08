import type { CvContent, JobOffer, MatchScore } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { createGuestSession, type SessionStorage } from "./guest-session";
import type { JobbboxApi, UpgradePrompt } from "./jobbbox-api";
import { createMatchScoring } from "./match-scoring";

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

function setUp({ quota = Infinity } = {}) {
  const storage = memoryStorage();
  let now = 0;
  const clock = { set: (ms: number) => (now = ms) };
  const session = () => createGuestSession(storage, () => now);
  const { api, requests } = matchScoreApi({ quota });
  // A new scoring per page load, as the analysis page creates on each open.
  const scoring = () => createMatchScoring({ api, session: session() });
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
});
