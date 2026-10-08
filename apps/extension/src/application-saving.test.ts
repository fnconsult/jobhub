import type { CvContent, JobOffer } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { createApplicationSaving } from "./application-saving";
import { createGuestSession, type SessionStorage } from "./guest-session";
import type { JobbboxApi } from "./jobbbox-api";

const jobOffer: JobOffer = {
  id: "jo-1",
  source: { url: "https://www.apec.fr/offre/1" },
  title: "Directeur administratif et financier H/F",
  content: "Poste de DAF à Lyon.",
  location: "Lyon",
};
const cv = { fullName: "Marie Dupont", headline: "Directrice financière", skills: ["IFRS"] } as CvContent;
const searchCriteria = { targetRole: "Directrice financière", location: "Lyon" };

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

type Saving = Pick<JobbboxApi, "profiles" | "createProfile" | "saveApplication">;

/** The web app as the signed-in Candidate's account: their Profiles and Applications. */
function account({ profiles = [] as { id: string; name: string }[], profileQuota = Infinity } = {}) {
  const state = {
    profiles: profiles.map((profile) => ({ ...profile, cv: undefined as CvContent | undefined, searchCriteria: undefined as unknown })),
    applications: [] as { id: string; jobOfferId: string; profileId: string }[],
  };
  const api: Saving = {
    async profiles() {
      return { ok: true, profiles: state.profiles.map(({ id, name }) => ({ id, name })) };
    },
    async createProfile(cv, searchCriteria) {
      if (!searchCriteria.targetRole || !searchCriteria.location) return { ok: false, error: "invalid" };
      if (state.profiles.length >= profileQuota) {
        return { ok: false, error: "plan_quota_reached", prompt: { message: "Your Plan includes 1 Profile.", action: "Upgrade", href: "/abonnement" } };
      }
      const id = `p-${state.profiles.length + 1}`;
      state.profiles.push({ id, name: searchCriteria.targetRole, cv, searchCriteria });
      return { ok: true, profileId: id };
    },
    async saveApplication(jobOfferId, profileId) {
      if (!state.profiles.some((profile) => profile.id === profileId)) return { ok: false, error: "not_found" };
      const existing = state.applications.find((application) => application.jobOfferId === jobOfferId);
      if (existing) return { ok: true, applicationId: existing.id };
      const id = `a-${state.applications.length + 1}`;
      state.applications.push({ id, jobOfferId, profileId });
      return { ok: true, applicationId: id };
    },
  };
  return { api, state };
}

/** Runs one piece of work at a time, as the browser's Web Locks do across the extension's pages. */
function oneAtATime() {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
  };
}

async function guestWork(work: { jobOffer?: JobOffer; cv?: CvContent; searchCriteria?: typeof searchCriteria }) {
  const session = createGuestSession(memoryStorage());
  if (work.jobOffer) await session.keepJobOffer(work.jobOffer);
  if (work.cv) await session.keepCv(work.cv, work.searchCriteria);
  return session;
}

describe("saving a captured Job Offer as an Application, from the extension", () => {
  it("on sign-up, makes the Guest's CV their first Profile and the captured Job Offer their first Application", async () => {
    const session = await guestWork({ jobOffer, cv, searchCriteria });
    const { api, state } = account();

    const saved = await createApplicationSaving({ api, session, lock: oneAtATime() }).open();

    expect(saved).toEqual({ state: "saved", applicationId: "a-1", jobOffer, newProfile: { id: "p-1", name: "Directrice financière" } });
    expect(state.profiles).toEqual([{ id: "p-1", name: "Directrice financière", cv, searchCriteria }]);
    expect(state.applications).toEqual([{ id: "a-1", jobOfferId: "jo-1", profileId: "p-1" }]);
    // Now kept in the Candidate's account, the Guest's work leaves the browser (ADR-0003).
    expect(await session.read()).not.toHaveProperty("cv");
  });

  it("shows where the work went to every page opened afterwards", async () => {
    const session = await guestWork({ jobOffer, cv, searchCriteria });
    const { api } = account();
    const saved = await createApplicationSaving({ api, session, lock: oneAtATime() }).open();

    expect(await createApplicationSaving({ api, session, lock: oneAtATime() }).open()).toEqual(saved);
  });

  it("makes one Profile and one Application when several pages keep the Guest's work at once", async () => {
    const session = await guestWork({ jobOffer, cv, searchCriteria });
    const { api, state } = account();
    const lock = oneAtATime();

    const opened = await Promise.all([1, 2, 3].map(() => createApplicationSaving({ api, session, lock }).open()));

    expect(state.profiles).toHaveLength(1);
    expect(state.applications).toHaveLength(1);
    expect(new Set(opened.map((page) => JSON.stringify(page))).size).toBe(1);
  });

  it("lets a signed-in Candidate choose the Profile, and creates the Application with it directly", async () => {
    const session = await guestWork({ jobOffer });
    const { api, state } = account({ profiles: [{ id: "p-1", name: "DAF" }, { id: "p-2", name: "Consultante transformation" }] });
    const saving = createApplicationSaving({ api, session, lock: oneAtATime() });

    expect(await saving.open()).toEqual({
      state: "choose",
      profiles: [{ id: "p-1", name: "DAF" }, { id: "p-2", name: "Consultante transformation" }],
      fromCv: false,
    });
    expect(await saving.save({ profileId: "p-2" })).toEqual({ state: "saved", applicationId: "a-1", jobOffer, newProfile: null });
    expect(state.applications).toEqual([{ id: "a-1", jobOfferId: "jo-1", profileId: "p-2" }]);
    expect(state.profiles).toHaveLength(2);
  });

  it("offers a Candidate who has Profiles to make a new one from the CV in the session", async () => {
    const session = await guestWork({ jobOffer, cv, searchCriteria });
    const { api, state } = account({ profiles: [{ id: "p-1", name: "DAF" }] });
    const saving = createApplicationSaving({ api, session, lock: oneAtATime() });

    expect(await saving.open()).toEqual({ state: "choose", profiles: [{ id: "p-1", name: "DAF" }], fromCv: true });
    expect(await saving.save("new_profile_from_cv")).toMatchObject({ state: "saved", newProfile: { id: "p-2", name: "Directrice financière" } });
    expect(state.applications).toEqual([{ id: "a-1", jobOfferId: "jo-1", profileId: "p-2" }]);
  });

  it("takes the target role and location the CV does not give from the Job Offer", async () => {
    const session = await guestWork({ jobOffer, cv, searchCriteria: { targetRole: "", location: "" } });
    const { api, state } = account();

    await createApplicationSaving({ api, session, lock: oneAtATime() }).open();

    expect(state.profiles[0]).toMatchObject({ name: jobOffer.title, searchCriteria: { targetRole: jobOffer.title, location: "Lyon" } });
  });

  it("keeps the Guest's work, and says why, when no Profile can be made from it", async () => {
    const session = await guestWork({ jobOffer: { ...jobOffer, location: undefined }, cv, searchCriteria: { targetRole: "DAF", location: "" } });
    const { api, state } = account();

    expect(await createApplicationSaving({ api, session, lock: oneAtATime() }).open()).toEqual({ state: "failed", error: "search_criteria_missing" });
    expect(state.applications).toEqual([]);
    expect(await session.read()).toMatchObject({ cv });
  });

  it("keeps the Guest's work, and passes on the Upgrade Prompt, when the Plan allows no more Profiles", async () => {
    const session = await guestWork({ jobOffer, cv, searchCriteria });
    const { api } = account({ profiles: [{ id: "p-1", name: "DAF" }], profileQuota: 1 });

    expect(await createApplicationSaving({ api, session, lock: oneAtATime() }).save("new_profile_from_cv")).toEqual({
      state: "failed",
      error: "plan_quota_reached",
      prompt: { message: "Your Plan includes 1 Profile.", action: "Upgrade", href: "/abonnement" },
    });
    expect(await session.read()).toMatchObject({ cv, jobOffer });
  });

  it("says when the Job Offer to save is gone", async () => {
    const session = await guestWork({ jobOffer });
    const { api } = account({ profiles: [{ id: "p-1", name: "DAF" }] });
    api.saveApplication = async () => ({ ok: false, error: "not_found" });

    expect(await createApplicationSaving({ api, session, lock: oneAtATime() }).save({ profileId: "p-1" })).toEqual({ state: "failed", error: "job_offer_gone" });
  });

  it("has nothing to save without a captured Job Offer", async () => {
    const session = await guestWork({ cv, searchCriteria });
    const { api, state } = account();

    expect(await createApplicationSaving({ api, session, lock: oneAtATime() }).open()).toEqual({ state: "nothing_to_save" });
    expect(state.profiles).toEqual([]);
  });
});
