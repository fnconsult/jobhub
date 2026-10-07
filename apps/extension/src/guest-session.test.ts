import type { CvContent, JobOffer } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { createGuestSession, type SessionStorage } from "./guest-session";

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

  it("forgets everything when the Guest asks", async () => {
    const storage = memoryStorage();
    const session = createGuestSession(storage, () => 0);
    await session.keepCv(cv);

    await session.forget();

    expect(await session.read()).toEqual({});
    expect(storage.items).toEqual({});
  });
});
