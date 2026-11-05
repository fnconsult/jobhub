/**
 * The « Recherches d'offres » and « Job Digests » Coach Actions (#720, ADR-0077), on in-memory domain modules scoped to
 * their Candidate: a Job Search proposed with the Plan Quota it uses (the Upgrade prompt without room, the worker never
 * asked), launched by « Lancer » with no « Annuler », stopped by a proposal; a Job Digest's frequency proposed within the
 * Plan, applied, and put back by « Annuler ».
 */
import type { JobDigestFrequency, SearchCriteria } from "@jobhub/shared";
import { describe, expect, it, vi } from "vitest";
import type { QuotaRefusal } from "../billing/upgrade-prompt";
import type { JobDigestSettings, SubscribeResult } from "../job-digests";
import type { JobSearch, StartJobSearchResult } from "../job-searches";
import type { Profile } from "../profiles";
import type { CoachAction, CoachActionCall, ProposalCall, ProposedChange } from "./index";
import { createCoachActions } from "./index";
import { SEARCH_ACTIONS, searchCoachActions, type SearchActionSources } from "./job-searches";

const CRITERIA: SearchCriteria = { targetRole: "Directrice financière", locations: ["Lyon"], contractTypes: ["cdi"], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };
const masterCv = { fullName: "Marie Dupont", headline: "", email: "", phone: "", location: "", summary: "", experience: [], education: [], skills: [], languages: [] };
const profile = (id: string, name: string, archived = false): Profile => ({ id, name, archived, searchCriteria: CRITERIA, masterCv: { version: 1, content: masterCv } });

const NO_ROOM: QuotaRefusal = {
  allowed: false,
  quota: "jobSearches",
  plan: "free",
  planName: { fr: "Gratuite", en: "Free" },
  limit: 1,
  upgradeTo: "standard",
  upgradeToName: { fr: "Standard", en: "Standard" },
};

/** Marie's world: two active Profiles and an archived one; Paul has none. Each module scoped to its Candidate. */
function world({ used = 0, limit = 5 as number | null, planFrequency = "weekly" as JobDigestFrequency } = {}) {
  const profiles: Record<string, Profile[]> = { marie: [profile("p-daf", "DAF"), profile("p-conseil", "Consultante"), profile("p-old", "Ancien", true)] };
  const mine = (candidateId: string) => profiles[candidateId] ?? [];
  const searches: (JobSearch & { candidateId: string })[] = [];
  const digests = new Map<string, JobDigestFrequency>();
  let quotaUsed = used;
  const queue: string[] = [];

  const jobSearchOf = (candidateId: string, profileId: string, status: JobSearch["status"], startedAt = new Date("2026-11-05T09:42:00Z")) => {
    const owner = mine(candidateId).find((each) => each.id === profileId)!;
    const search = { candidateId, id: `s${searches.length + 1}`, profile: { id: owner.id, name: owner.name, searchCriteria: owner.searchCriteria }, status, failure: null, startedAt, results: [], metrics: null, provenance: null };
    searches.push(search);
    return search;
  };

  const settingsOf = (profileId: string): JobDigestSettings => {
    const chosen = digests.get(profileId) ?? "none";
    const frequency = planFrequency === "none" ? "none" : chosen === "daily" && planFrequency === "weekly" ? "weekly" : chosen;
    return { subscribed: frequency !== "none", chosenFrequency: chosen === "none" ? null : chosen, frequency, planFrequency, upgradeTo: planFrequency === "none" ? "standard" : null, digests: [] };
  };
  const refusalOf = (candidateId: string, profileId: string, frequency: unknown): Exclude<SubscribeResult, { ok: true }> | null => {
    const owner = mine(candidateId).find((each) => each.id === profileId);
    if (!owner) return { ok: false, error: "not_found" };
    if (owner.archived) return { ok: false, error: "archived" };
    if (frequency !== "daily" && frequency !== "weekly") return { ok: false, error: "invalid_frequency" };
    const plan = { plan: "standard" as const, planName: { fr: "Standard", en: "Standard" } };
    if (planFrequency === "none") return { ok: false, error: "not_included", ...plan, upgradeTo: "standard", upgradeToName: { fr: "Standard", en: "Standard" } };
    if (frequency === "daily" && planFrequency === "weekly") return { ok: false, error: "above_plan", ...plan, planFrequency, upgradeTo: "premium", upgradeToName: { fr: "Premium", en: "Premium" } };
    return null;
  };

  const sources: SearchActionSources = {
    profiles: {
      list: async (candidateId) => mine(candidateId).map(({ id, name, archived }) => ({ id, name, archived })),
      get: async (candidateId, id) => mine(candidateId).find((each) => each.id === id) ?? null,
    },
    jobSearches: {
      get: async (candidateId, id) => searches.find((each) => each.id === id && each.candidateId === candidateId) ?? null,
      latest: async (candidateId, profileId) => searches.filter((each) => each.candidateId === candidateId && each.profile.id === profileId && each.status === "done").at(-1) ?? null,
      searching: async (candidateId, profileId) => searches.find((each) => each.candidateId === candidateId && each.profile.id === profileId && each.status === "searching") ?? null,
      start: vi.fn(async (candidateId: string, input: unknown): Promise<StartJobSearchResult> => {
        const profileId = (input as { profileId: string }).profileId;
        const owner = mine(candidateId).find((each) => each.id === profileId);
        if (!owner) return { ok: false, error: "not_found" };
        if (owner.archived) return { ok: false, error: "archived" };
        if (limit !== null && quotaUsed >= limit) return { ok: false, error: "quota_exceeded", refusal: NO_ROOM };
        quotaUsed += 1;
        queue.push(profileId);
        return { ok: true, jobSearch: jobSearchOf(candidateId, profileId, "searching") };
      }),
      stop: vi.fn(async (candidateId: string, id: string) => {
        const search = searches.find((each) => each.id === id);
        if (!search) return { ok: false as const, error: "not_found" as const };
        if (search.candidateId !== candidateId) return { ok: false as const, error: "forbidden" as const };
        if (search.status !== "searching") return { ok: false as const, error: "over" as const };
        search.status = "stopped";
        return { ok: true as const };
      }),
    },
    jobDigests: {
      settings: async (candidateId, profileId) => (mine(candidateId).some((each) => each.id === profileId) ? settingsOf(profileId) : null),
      allows: async (candidateId, profileId, frequency) => refusalOf(candidateId, profileId, frequency) ?? { ok: true },
      subscribe: vi.fn(async (candidateId: string, profileId: string, frequency: unknown): Promise<SubscribeResult> => {
        const refused = refusalOf(candidateId, profileId, frequency);
        if (refused) return refused;
        digests.set(profileId, frequency as JobDigestFrequency);
        return { ok: true, settings: settingsOf(profileId) };
      }),
      unsubscribe: vi.fn(async (candidateId: string, profileId: string) => {
        if (mine(candidateId).some((each) => each.id === profileId)) digests.delete(profileId);
      }),
      get: async (candidateId, id) => (candidateId === "marie" && id === "d-daf" ? { id, profile: { id: "p-daf", name: "DAF" }, sentAt: new Date(), results: [], provenance: null } : null),
    },
    jobSearchQuota: async () => ({ used: quotaUsed, limit, refusal: limit !== null && quotaUsed >= limit ? NO_ROOM : null }),
  };
  return { sources, searches, digests, queue, jobSearchOf, useQuota: () => (quotaUsed += 1) };
}

const call = (candidateId = "marie", more: Partial<CoachActionCall> = {}): CoachActionCall => ({ candidateId, language: "fr", ...more });
const applied = (candidateId = "marie"): ProposalCall => ({ candidateId, cardId: "card-1", at: new Date("2026-11-05T10:00:00Z") });
const actionOf = (sources: SearchActionSources, name: string): CoachAction => searchCoachActions(sources).find((action) => action.name === name)!;

/** What a proposing Coach Action prepared, for its card: a ProposedChange, or it fails the test. */
async function proposed(action: CoachAction, args: Record<string, unknown>, at = call()): Promise<ProposedChange> {
  const result = await action.run(action.schema.parse(args), at);
  if (!result.ok || result.proposes === false) throw new Error(`nothing proposed: ${JSON.stringify(result)}`);
  return result.data as ProposedChange;
}

describe("the « Recherches d'offres » and « Job Digests » Coach Actions, as declared (#720)", () => {
  const actions = searchCoachActions(world().sources);

  it("launches a Job Search, stops one, and sets a Job Digest's frequency: proposing actions of their groups, none copying text", () => {
    expect(actions.map((action) => [action.name, action.group, action.kind, action.copiesText])).toEqual([
      [SEARCH_ACTIONS.start, "job_searches", "propose", false],
      [SEARCH_ACTIONS.stop, "job_searches", "propose", false],
      [SEARCH_ACTIONS.digestFrequency, "job_digests", "propose", false],
    ]);
    expect(SEARCH_ACTIONS).toEqual({ start: "propose_job_search", stop: "propose_job_search_stop", digestFrequency: "propose_job_digest_frequency" });
  });

  it("gives « Annuler » to the Job Digest's frequency only: a launched or stopped Job Search ends with Stop, never undone", () => {
    expect(actions.map((action) => [action.name, Boolean(action.apply), Boolean(action.undo)])).toEqual([
      [SEARCH_ACTIONS.start, true, false],
      [SEARCH_ACTIONS.stop, true, false],
      [SEARCH_ACTIONS.digestFrequency, true, true],
    ]);
  });

  it("tells the model to propose other Search Criteria first when the Candidate wants them, the Job Search running on the Profile's own", () => {
    const start = actions.find((action) => action.name === SEARCH_ACTIONS.start)!;
    expect(start.description).toMatch(/propose_search_criteria/);
    expect(start.description).toMatch(/critères de recherche/);
    expect(Object.keys(start.schema.shape)).toEqual(["profileId"]);
  });
});

describe("propose_job_search (#720)", () => {
  it("proposes a Job Search of the Profile In view, on its Search Criteria, saying the Plan Quota it uses, launched by « Lancer »", async () => {
    const { sources, queue } = world({ used: 0, limit: 5 });

    const change = await proposed(actionOf(sources, SEARCH_ACTIONS.start), {}, call("marie", { inView: { kind: "profile", id: "p-daf" } }));

    expect(change).toMatchObject({
      target: { kind: "profile", id: "p-daf", name: "DAF", href: "/recherches?profil=p-daf" },
      what: "Recherche d'offres",
      before: "Aucune recherche lancée",
      after: expect.stringContaining("Directrice financière · Lyon · CDI"),
      value: { profileId: "p-daf" },
      fields: [],
      launches: true,
      quota: { label: "1 recherche sur 5 cette semaine : il vous en restera 4" },
    });
    expect(change.quota?.prompt).toBeUndefined();
    // Proposed, nothing started.
    expect(queue).toEqual([]);
    expect(sources.jobSearches.start).not.toHaveBeenCalled();
  });

  it("names the Profile's latest Job Search, and an unlimited Plan Quota", async () => {
    const { sources, jobSearchOf } = world({ limit: null });
    jobSearchOf("marie", "p-conseil", "done", new Date("2026-10-28T09:00:00Z"));

    const change = await proposed(actionOf(sources, SEARCH_ACTIONS.start), { profileId: "p-conseil" });

    expect(change).toMatchObject({ before: "Dernière recherche le 28 octobre 2026", quota: { label: "Recherches illimitées avec votre offre" } });
  });

  it("« relance une recherche » without room: a card with the Upgrade prompt in place of « Lancer », the worker never asked", async () => {
    const { sources, queue } = world({ used: 1, limit: 1 });

    const change = await proposed(actionOf(sources, SEARCH_ACTIONS.start), {}, call("marie", { inView: { kind: "profile", id: "p-daf" } }));

    expect(change.quota).toMatchObject({ label: expect.any(String), prompt: { title: expect.any(String), upgradeTo: "standard", action: expect.stringContaining("Standard"), href: "/abonnement" } });
    expect(change.quota!.prompt!.message).toMatch(/Gratuite/);
    expect(sources.jobSearches.start).not.toHaveBeenCalled();
    expect(queue).toEqual([]);
  });

  it("finds the Profile of a Job Search In view: « relance une recherche » from its page", async () => {
    const { sources, jobSearchOf } = world();
    const earlier = jobSearchOf("marie", "p-conseil", "done");

    const change = await proposed(actionOf(sources, SEARCH_ACTIONS.start), {}, call("marie", { inView: { kind: "job_search", id: earlier.id } }));

    expect(change.target).toMatchObject({ kind: "profile", id: "p-conseil" });
  });

  it("proposes nothing while one is searching for the Profile, telling the model it is followed in AI Activity", async () => {
    const { sources, jobSearchOf } = world();
    jobSearchOf("marie", "p-daf", "searching");

    const result = await actionOf(sources, SEARCH_ACTIONS.start).run({ profileId: "p-daf" }, call());

    expect(result).toMatchObject({ ok: true, proposes: false, data: { message: expect.stringMatching(/déjà en cours.*Activité IA/) } });
  });

  it("is not_found for an Archived Profile, another Candidate's or none at all with several active ones", async () => {
    const { sources } = world();
    const start = actionOf(sources, SEARCH_ACTIONS.start);

    expect(await start.run({ profileId: "p-old" }, call())).toEqual({ ok: false, error: "not_found" });
    expect(await start.run({ profileId: "p-daf" }, call("paul"))).toEqual({ ok: false, error: "not_found" });
    expect(await start.run({}, call())).toMatchObject({ ok: true, proposes: false });
  });

  it("« Lancer » starts the Job Search through the Job Searches module, which uses the Plan Quota and queues it: no « Annuler »", async () => {
    const { sources, queue, searches } = world({ used: 0, limit: 5 });
    const action = actionOf(sources, SEARCH_ACTIONS.start);
    const change = await proposed(action, { profileId: "p-daf" });

    expect(await action.apply!(change, applied())).toEqual({ ok: true });
    expect(queue).toEqual(["p-daf"]);
    expect(searches.at(-1)).toMatchObject({ profile: { id: "p-daf" }, status: "searching" });
  });

  it("« Lancer » is a conflict once a Job Search started since, or the room is gone: nothing more is queued", async () => {
    const { sources, queue, jobSearchOf, useQuota } = world({ used: 0, limit: 1 });
    const action = actionOf(sources, SEARCH_ACTIONS.start);
    const change = await proposed(action, { profileId: "p-daf" });

    const running = jobSearchOf("marie", "p-daf", "searching");
    expect(await action.apply!(change, applied())).toEqual({ ok: false, error: "conflict" });
    running.status = "done";
    useQuota();
    expect(await action.apply!(change, applied())).toEqual({ ok: false, error: "conflict" });
    expect(queue).toEqual([]);
  });

  it("« Lancer » for another Candidate is not_found", async () => {
    const { sources } = world();
    const action = actionOf(sources, SEARCH_ACTIONS.start);
    const change = await proposed(action, { profileId: "p-daf" });

    expect(await action.apply!(change, applied("paul"))).toEqual({ ok: false, error: "not_found" });
  });
});

describe("propose_job_search_stop (#720)", () => {
  it("proposes to stop the Job Search In view, its Job Offers kept; applying asks the worker to stop it (Stop)", async () => {
    const { sources, jobSearchOf, searches } = world();
    const running = jobSearchOf("marie", "p-daf", "searching");
    const action = actionOf(sources, SEARCH_ACTIONS.stop);

    const change = await proposed(action, {}, call("marie", { inView: { kind: "job_search", id: running.id } }));

    expect(change).toMatchObject({
      target: { kind: "job_search", id: running.id, name: "DAF", href: `/recherches/${running.id}` },
      what: "Arrêt de la recherche",
      before: expect.stringMatching(/^En cours depuis \d\d:\d\d$/),
      after: "Arrêtée, les offres déjà trouvées gardées",
      fields: [],
    });
    expect(sources.jobSearches.stop).not.toHaveBeenCalled();
    expect(await action.apply!(change, applied())).toEqual({ ok: true });
    expect(searches.find((each) => each.id === running.id)?.status).toBe("stopped");
  });

  it("finds the Profile's Job Search still searching, and proposes nothing when none is", async () => {
    const { sources, jobSearchOf } = world();
    const action = actionOf(sources, SEARCH_ACTIONS.stop);

    expect(await action.run({ profileId: "p-daf" }, call())).toMatchObject({ ok: true, proposes: false, data: { message: expect.stringMatching(/aucune recherche en cours/i) } });
    const running = jobSearchOf("marie", "p-daf", "searching");
    expect((await proposed(action, { profileId: "p-daf" })).target.id).toBe(running.id);
  });

  it("is a conflict once the Job Search is over, and not_found for another Candidate's", async () => {
    const { sources, jobSearchOf } = world();
    const running = jobSearchOf("marie", "p-daf", "searching");
    const action = actionOf(sources, SEARCH_ACTIONS.stop);
    const change = await proposed(action, { jobSearchId: running.id });

    expect(await action.run({ jobSearchId: running.id }, call("paul"))).toEqual({ ok: false, error: "not_found" });
    expect(await action.apply!(change, applied("paul"))).toEqual({ ok: false, error: "not_found" });
    running.status = "done";
    expect(await action.apply!(change, applied())).toEqual({ ok: false, error: "conflict" });
  });
});

describe("propose_job_digest_frequency (#720)", () => {
  it("proposes to subscribe to a Profile's Job Digest within the Plan, the page's frequency field offering only what it allows", async () => {
    const { sources } = world({ planFrequency: "weekly" });

    const change = await proposed(actionOf(sources, SEARCH_ACTIONS.digestFrequency), { frequency: "weekly" }, call("marie", { inView: { kind: "profile", id: "p-daf" } }));

    expect(change).toMatchObject({
      target: { kind: "profile", id: "p-daf", name: "DAF", href: "/job-digests" },
      what: "Job Digest",
      before: "Pas de Job Digest",
      after: "Chaque semaine, le lundi à 7 h",
      value: { frequency: "weekly" },
      fields: [{ name: "frequency", type: "select", options: [{ value: "weekly" }, { value: "none" }] }],
      quota: { label: "Votre offre comprend un Job Digest par semaine." },
    });
    expect(change.quota?.prompt).toBeUndefined();
    expect(sources.jobDigests.subscribe).not.toHaveBeenCalled();
  });

  it("a frequency above the Plan, or a Plan without the Job Digest: the Upgrade prompt in place of « Appliquer »", async () => {
    const above = await proposed(actionOf(world({ planFrequency: "weekly" }).sources, SEARCH_ACTIONS.digestFrequency), { profileId: "p-daf", frequency: "daily" });
    expect(above.quota?.prompt).toMatchObject({ upgradeTo: "premium", message: expect.stringMatching(/Premium/) });

    const none = await proposed(actionOf(world({ planFrequency: "none" }).sources, SEARCH_ACTIONS.digestFrequency), { profileId: "p-daf", frequency: "weekly" });
    expect(none.quota?.prompt).toMatchObject({ upgradeTo: "standard" });
  });

  it("finds the Profile of a Job Digest In view; proposes nothing at the frequency it already has", async () => {
    const { sources, digests } = world();
    const action = actionOf(sources, SEARCH_ACTIONS.digestFrequency);

    expect((await proposed(action, { frequency: "weekly" }, call("marie", { inView: { kind: "job_digest", id: "d-daf" } }))).target.id).toBe("p-daf");
    digests.set("p-daf", "weekly");
    expect(await action.run({ profileId: "p-daf", frequency: "weekly" }, call())).toMatchObject({ ok: true, proposes: false });
    expect(await action.run({ profileId: "p-old", frequency: "weekly" }, call())).toEqual({ ok: false, error: "not_found" });
    expect(await action.run({ profileId: "p-daf", frequency: "weekly" }, call("paul"))).toEqual({ ok: false, error: "not_found" });
  });

  it("« Appliquer » subscribes; « Annuler » puts the frequency before back: none, unsubscribed again", async () => {
    const { sources, digests } = world();
    const action = actionOf(sources, SEARCH_ACTIONS.digestFrequency);
    const change = await proposed(action, { profileId: "p-daf", frequency: "weekly" });

    const done = await action.apply!(change, applied());
    expect(done).toMatchObject({ ok: true, undo: expect.anything() });
    expect(digests.get("p-daf")).toBe("weekly");

    expect(await action.undo!((done as { undo: unknown }).undo, applied())).toEqual({ ok: true });
    expect(digests.has("p-daf")).toBe(false);
  });

  it("« Annuler » of an unsubscription subscribes again at the frequency before, and of a change puts the old one back", async () => {
    const { sources, digests } = world({ planFrequency: "daily" });
    const action = actionOf(sources, SEARCH_ACTIONS.digestFrequency);
    digests.set("p-daf", "daily");

    const off = await proposed(action, { profileId: "p-daf", frequency: "none" });
    expect(off).toMatchObject({ before: "Chaque jour à 7 h", after: "Pas de Job Digest" });
    const unsubscribed = await action.apply!(off, applied());
    expect(digests.has("p-daf")).toBe(false);
    expect(await action.undo!((unsubscribed as { undo: unknown }).undo, applied())).toEqual({ ok: true });
    expect(digests.get("p-daf")).toBe("daily");

    const weekly = await proposed(action, { profileId: "p-daf", frequency: "weekly" });
    const changed = await action.apply!(weekly, applied());
    expect(digests.get("p-daf")).toBe("weekly");
    expect(await action.undo!((changed as { undo: unknown }).undo, applied())).toEqual({ ok: true });
    expect(digests.get("p-daf")).toBe("daily");
  });

  it("keeps what the Candidate edited before applying, refused as invalid above the Plan", async () => {
    const { sources, digests } = world({ planFrequency: "weekly" });
    const action = actionOf(sources, SEARCH_ACTIONS.digestFrequency);
    const change = await proposed(action, { profileId: "p-daf", frequency: "weekly" });

    expect(await action.apply!({ ...change, value: { frequency: "daily" } }, applied())).toEqual({ ok: false, error: "invalid", errors: [{ field: "frequency", code: "invalid" }] });
    expect(await action.apply!({ ...change, value: { frequency: "none" } }, applied())).toMatchObject({ ok: true });
    expect(digests.has("p-daf")).toBe(false);
  });

  it("is a conflict once the frequency moved on since the proposal, and « Annuler » once it moved on since applied", async () => {
    const { sources, digests } = world();
    const action = actionOf(sources, SEARCH_ACTIONS.digestFrequency);
    const change = await proposed(action, { profileId: "p-daf", frequency: "weekly" });

    digests.set("p-daf", "weekly");
    expect(await action.apply!(change, applied())).toEqual({ ok: false, error: "conflict" });

    digests.delete("p-daf");
    const done = await action.apply!(change, applied());
    digests.delete("p-daf");
    expect(await action.undo!((done as { undo: unknown }).undo, applied())).toEqual({ ok: false, error: "conflict" });
    expect(await action.undo!({ nonsense: true }, applied())).toEqual({ ok: false, error: "not_found" });
  });
});

describe("the Coach Actions offered with a Job Offer In view (#720)", () => {
  it("stay offered: none copies text", async () => {
    const actions = createCoachActions({ catalog: searchCoachActions(world().sources), settings: async () => ({ enabled: true, maxRounds: 2 }), externalApis: { record: () => {} } });

    const offered = await actions.forReply("marie", { recorder: { step: async (_subject, run) => run(), site: () => {} }, untrustedInView: true });

    expect(offered?.tools.map((tool) => tool.name)).toEqual(Object.values(SEARCH_ACTIONS));
  });
});
