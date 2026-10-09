import type { CvContent, JobOffer } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { createGuestSession, type KeptMatchScore, type SessionStorage } from "./guest-session";

/** The browser's session storage (chrome.storage.session): in memory, gone when the browser closes. */
function memoryStorage(): SessionStorage & { items: Record<string, unknown> } {
  const items: Record<string, unknown> = {};
  return {
    items,
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
const cv = { fullName: "Marie Dupont", skills: ["IFRS"] } as CvContent;
const searchCriteria = { targetRole: "Directrice financière", location: "Lyon" };

describe("a Guest session", () => {
  it("keeps the captured Job Offer and the Guest's CV in the browser's session storage", async () => {
    const storage = memoryStorage();
    const session = createGuestSession(storage, () => 0);

    await session.keepJobOffer(jobOffer);
    await session.keepCv(cv);

    expect(await createGuestSession(storage, () => HOUR).read()).toEqual({ jobOffer, cv, expiresAt: 23 * HOUR });
  });

  it("forgets everything 23 hours after it began, however often it is used (ADR-0003)", async () => {
    const storage = memoryStorage();
    let now = 0;
    const session = createGuestSession(storage, () => now);
    await session.keepCv(cv);
    now = 20 * HOUR;
    await session.keepJobOffer(jobOffer);

    now = 23 * HOUR;
    expect(await session.read()).toEqual({});
    expect(storage.items).toEqual({});

    await session.keepJobOffer(jobOffer);
    expect(await session.read()).toEqual({ jobOffer, expiresAt: 46 * HOUR });
  });

  it("keeps the Search Criteria read from the Guest's CV with it, for the Profile it may become", async () => {
    const session = createGuestSession(memoryStorage(), () => 0);

    await session.keepCv(cv, searchCriteria);

    expect(await session.read()).toEqual({ cv, searchCriteria, expiresAt: 23 * HOUR });
  });

  it("once the work is saved in an account, keeps only where it went, until another Job Offer is captured", async () => {
    const session = createGuestSession(memoryStorage(), () => 0);
    await session.keepJobOffer(jobOffer);
    await session.keepCv(cv, searchCriteria);
    const saved = { applicationId: "a-1", jobOffer, newProfile: { id: "p-1", name: "DAF" } };

    await session.keepSaved(saved);
    expect(await session.read()).toEqual({ saved, expiresAt: 23 * HOUR });

    await session.keepJobOffer({ ...jobOffer, id: "jo-2" });
    expect(await session.read()).toEqual({ jobOffer: { ...jobOffer, id: "jo-2" }, expiresAt: 23 * HOUR });
  });

  it("forgets everything when the Guest asks", async () => {
    const storage = memoryStorage();
    const session = createGuestSession(storage, () => 0);
    await session.keepCv(cv);

    await session.forget();

    expect(await session.read()).toEqual({});
    expect(storage.items).toEqual({});
  });

  it("drops the kept Match Score once the CV or the Job Offer it was computed for is replaced", async () => {
    const session = createGuestSession(memoryStorage(), () => 0);
    await session.keepJobOffer(jobOffer);
    await session.keepCv(cv);
    const matchScore = { jobOfferId: "jo-1", cv, matchScore: { score: 70 } } as KeptMatchScore;

    await session.keepMatchScore(matchScore);
    await session.keepJobOffer(jobOffer);
    expect((await session.read()).matchScore).toEqual(matchScore);

    await session.keepJobOffer({ ...jobOffer, id: "jo-2" });
    expect((await session.read()).matchScore).toBeUndefined();

    await session.keepMatchScore({ ...matchScore, jobOfferId: "jo-2" });
    await session.keepCv({ ...cv, skills: ["SAP"] });
    expect((await session.read()).matchScore).toBeUndefined();
  });

  it("keeps a Profile's Match Score while it holds its Job Offer, whatever CV comes and goes", async () => {
    const session = createGuestSession(memoryStorage(), () => 0);
    await session.keepJobOffer(jobOffer);
    const matchScore = { jobOfferId: "jo-1", profileId: "p-1", matchScore: { score: 70 } } as KeptMatchScore;

    await session.keepMatchScore(matchScore);
    await session.keepCv(cv);
    expect((await session.read()).matchScore).toEqual(matchScore);

    await session.keepJobOffer({ ...jobOffer, id: "jo-2" });
    expect((await session.read()).matchScore).toBeUndefined();
    await session.keepMatchScore(matchScore);
    expect((await session.read()).matchScore).toBeUndefined();
  });

  it("never brings a forgotten session back to keep a Match Score in it (ADR-0003)", async () => {
    const storage = memoryStorage();
    const session = createGuestSession(storage, () => 0);
    await session.keepJobOffer(jobOffer);
    await session.keepCv(cv);
    await session.forget();

    await session.keepMatchScore({ jobOfferId: jobOffer.id, cv, matchScore: { score: 70 } } as KeptMatchScore);

    expect(storage.items).toEqual({});
  });
});
