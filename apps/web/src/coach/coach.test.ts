import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "@jobhub/ai/testing";
import { describe, expect, it } from "vitest";
import type { JobOffer } from "@jobhub/shared";
import type { Application } from "@/applications";
import type { JobDigest } from "@/job-digests";
import type { JobSearch } from "@/job-searches";
import type { Profile } from "@/profiles";
import { createCoach, MAX_MESSAGES, recentConversation, type Coach, type CoachDeps, type CoachFocus } from "./index";

const profile: Profile = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Directrice financière",
  archived: false,
  searchCriteria: { targetRole: "Directrice financière", location: "Lyon", minSalary: 120000, contractType: "cdi" },
  masterCv: {
    version: 2,
    content: {
      fullName: "Marie Dupont",
      headline: "Directrice financière",
      email: "marie.dupont@example.fr",
      phone: "06 12 34 56 78",
      location: "12 rue de la République, 69002 Lyon",
      summary: "",
      experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS." }],
      education: [],
      skills: ["IFRS"],
      languages: [],
    },
  },
};

/** Marie's workspace, as the AI Coach reads it: only Marie can see what is in it. */
interface Workspace {
  profiles: Profile[];
  applications: Application[];
  jobOffers: JobOffer[];
  jobSearches: JobSearch[];
  jobDigests: JobDigest[];
  memory: string[];
}

function emptyWorkspace(): Workspace {
  return { profiles: [profile], applications: [], jobOffers: [], jobSearches: [], jobDigests: [], memory: [] };
}

function sourcesOf(workspace: Workspace): Omit<CoachDeps, "ai"> {
  const mine = <T>(candidateId: string, items: T[]) => (candidateId === "marie" ? items : []);
  return {
    profiles: {
      get: async (candidateId, id) => mine(candidateId, workspace.profiles).find((p) => p.id === id) ?? null,
      list: async (candidateId) => mine(candidateId, workspace.profiles).map(({ id, name, archived }) => ({ id, name, archived })),
    },
    applications: {
      get: async (candidateId, id) => mine(candidateId, workspace.applications).find((a) => a.id === id) ?? null,
      list: async (candidateId) =>
        mine(candidateId, workspace.applications).map(({ id, status, statusChangedAt, jobOffer, profile, interviews }) => ({ id, status, statusChangedAt, jobOffer, profile, interviews })),
    },
    jobOffers: { get: async (id) => workspace.jobOffers.find((o) => o.id === id) ?? null },
    jobSearches: {
      get: async (candidateId, id) => mine(candidateId, workspace.jobSearches).find((s) => s.id === id) ?? null,
      latest: async (candidateId, profileId) => mine(candidateId, workspace.jobSearches).find((s) => s.profile.id === profileId && s.status === "done") ?? null,
    },
    jobDigests: {
      get: async (candidateId, id) => mine(candidateId, workspace.jobDigests).find((d) => d.id === id) ?? null,
      latest: async (candidateId, profileId) => mine(candidateId, workspace.jobDigests).find((d) => d.profile.id === profileId) ?? null,
    },
    coachMemory: { items: async (candidateId) => mine(candidateId, workspace.memory) },
  };
}

function coachWith(options: { reply?: string | (() => string); workspace?: Partial<Workspace> } = {}): {
  coach: Coach;
  provider: FakeProvider;
  usage: ReturnType<typeof createMemoryUsageLog>;
} {
  const provider = createFakeProvider({ id: "mistral", reply: options.reply ?? "Bonjour Marie, que puis-je faire pour vous ?" });
  const usage = createMemoryUsageLog();
  const ai = createAiLayer({ providers: [provider], routes: { coaching: "mistral" }, usage });
  return { coach: createCoach({ ai, ...sourcesOf({ ...emptyWorkspace(), ...options.workspace }) }), provider, usage };
}

/** What the AI Coach was told for its latest reply. */
const contextOf = (provider: FakeProvider) => provider.calls.at(-1)!.system!;

const ask = (coach: Coach, focus?: CoachFocus) => coach.reply("marie", { messages: [{ from: "candidate", text: "Que me conseillez-vous ?" }], ...(focus ? { focus } : {}) });

describe("talking with the AI Coach in the Coach Panel", () => {
  it("answers the conversation so far, as the AI Coach, counting the tokens against the Candidate", async () => {
    const { coach, provider, usage } = coachWith();

    const result = await coach.reply("marie", {
      messages: [
        { from: "candidate", text: "Bonjour" },
        { from: "coach", text: "Bonjour, je suis votre coach." },
        { from: "candidate", text: "Par où commencer ?" },
      ],
    });

    expect(result).toMatchObject({ ok: true, reply: "Bonjour Marie, que puis-je faire pour vous ?" });
    expect(provider.calls[0]!.messages).toEqual([
      { role: "user", content: "Bonjour" },
      { role: "assistant", content: "Bonjour, je suis votre coach." },
      { role: "user", content: "Par où commencer ?" },
    ]);
    expect(provider.calls[0]!.system).toMatch(/coach/i);
    expect(usage.entries).toMatchObject([{ candidateId: "marie", task: "coaching" }]);
  });

  it("says what its reply cost: the provider and model, the tokens in, out and cached, and the estimated cost in €", async () => {
    const provider = createFakeProvider({ id: "mistral", reply: "Bonjour", usage: { inputTokens: 1_000, outputTokens: 200, cachedInputTokens: 3_000 } });
    const ai = createAiLayer({ providers: [provider], routes: { coaching: { provider: "mistral", model: "mistral-large-latest" } }, usage: createMemoryUsageLog() });
    const coach = createCoach({ ai, profiles: { get: async () => null } });

    const result = await coach.reply("marie", { messages: [{ from: "candidate", text: "Bonjour" }] });

    if (!result.ok) throw new Error("no reply");
    expect(result.cost).toMatchObject({ provider: "mistral", model: "mistral-large-latest", inputTokens: 1_000, outputTokens: 200, cachedInputTokens: 3_000 });
    // Mistral Large: $0.50 in, $0.05 cached, $1.50 out per million tokens, at €0.86 per $.
    expect(result.cost.eur).toBeCloseTo(((1_000 * 0.5 + 3_000 * 0.05 + 200 * 1.5) / 1_000_000) * 0.86, 9);
  });

  it("knows the Profile in view: its Search Criteria and the current version of its Master CV", async () => {
    const { coach, provider } = coachWith();

    await coach.reply("marie", { messages: [{ from: "candidate", text: "Mon CV est-il bon ?" }], focus: { kind: "profile", id: profile.id } });

    const system = provider.calls[0]!.system!;
    expect(system).toContain("Directrice financière");
    expect(system).toContain("Groupe Seb");
    expect(system).toContain("120000");
  });

  it("never reads another Candidate's Profile, even when its id is sent", async () => {
    const { coach, provider } = coachWith();

    const result = await coach.reply("someone-else", { messages: [{ from: "candidate", text: "Et ce profil ?" }], focus: { kind: "profile", id: profile.id } });

    expect(result.ok).toBe(true);
    expect(provider.calls[0]!.system).not.toContain("Groupe Seb");
  });

  it("refuses a conversation that does not end with the Candidate's message, or is malformed", async () => {
    const { coach, provider } = coachWith();

    expect(await coach.reply("marie", { messages: [] })).toEqual({ ok: false, error: "invalid" });
    expect(await coach.reply("marie", { messages: [{ from: "coach", text: "Bonjour" }] })).toEqual({ ok: false, error: "invalid" });
    expect(await coach.reply("marie", { messages: [{ from: "candidate", text: "   " }] })).toEqual({ ok: false, error: "invalid" });
    expect(await coach.reply("marie", { messages: [{ from: "candidate", text: "x".repeat(5001) }] })).toEqual({ ok: false, error: "invalid" });
    expect(await coach.reply("marie", "not a conversation")).toEqual({ ok: false, error: "invalid" });
    expect(provider.calls).toHaveLength(0);
  });

  it("keeps answering a conversation longer than MAX_MESSAGES, from its most recent messages", async () => {
    const { coach, provider } = coachWith();
    // 21 Candidate messages and 20 replies: what the Coach Panel holds after 20 exchanges.
    const messages = Array.from({ length: 2 * 20 + 1 }, (_, i) => ({ from: i % 2 === 0 ? ("candidate" as const) : ("coach" as const), text: `message ${i + 1}` }));

    const result = await coach.reply("marie", { messages });

    expect(result).toMatchObject({ ok: true, reply: "Bonjour Marie, que puis-je faire pour vous ?" });
    const sent = provider.calls[0]!.messages;
    expect(sent.length).toBeLessThanOrEqual(MAX_MESSAGES);
    // The window starts with a Candidate message and ends with the latest one.
    expect(sent[0]).toMatchObject({ role: "user" });
    expect(sent.at(-1)).toEqual({ role: "user", content: "message 41" });
  });

  it("windows the Coach Panel's conversation to what the AI Coach accepts, starting with a Candidate message", () => {
    const messages = Array.from({ length: 101 }, (_, i) => ({ from: i % 2 === 0 ? ("candidate" as const) : ("coach" as const), text: `message ${i + 1}` }));

    const recent = recentConversation(messages);

    expect(recent.length).toBeLessThanOrEqual(MAX_MESSAGES);
    expect(recent[0]!.from).toBe("candidate");
    expect(recent.at(-1)).toEqual({ from: "candidate", text: "message 101" });
    expect(recentConversation(messages.slice(0, 3))).toEqual(messages.slice(0, 3));
  });

  it("says the AI Coach is unavailable when the AI provider fails", async () => {
    const { coach } = coachWith({
      reply: () => {
        throw new Error("upstream down");
      },
    });

    expect(await coach.reply("marie", { messages: [{ from: "candidate", text: "Bonjour" }] })).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("what the AI Coach always knows: a short Candidate summary", () => {
  it("tells the AI Coach the Candidate's first name, target role, Search Criteria and seniority, whatever is in view", async () => {
    const { coach, provider } = coachWith();

    await ask(coach);

    const context = contextOf(provider);
    expect(context).toContain("Marie");
    expect(context).toContain("Directrice financière");
    expect(context).toContain("Lyon");
    expect(context).toContain("120000");
    expect(context).toMatch(/19 ans d'expérience/);
  });
});

describe("the Candidate's identity: first name only", () => {
  const writtenEverywhere: Profile = {
    ...profile,
    masterCv: {
      version: 3,
      content: {
        ...profile.masterCv.content,
        summary: "Marie Dupont, joignable au 06 12 34 56 78 ou à marie.dupont@example.fr, habite 12 rue de la République, 69002 Lyon.",
      },
    },
  };

  it("strips the full name, email, phone and postal address from the Master CV before it is sent, keeping the career", async () => {
    const { coach, provider } = coachWith({ workspace: { profiles: [writtenEverywhere] } });

    await ask(coach, { kind: "profile", id: profile.id });

    const context = contextOf(provider);
    expect(context).toContain("Marie");
    expect(context).toContain("Groupe Seb");
    expect(context).toContain("Consolidation IFRS.");
    for (const identity of ["Dupont", "marie.dupont@example.fr", "06 12 34 56 78", "rue de la République", "69002"]) expect(context).not.toContain(identity);
  });

  it("strips them too from the onboarding answers summarised when nothing is in view", async () => {
    const { coach, provider } = coachWith({ workspace: { profiles: [writtenEverywhere] } });

    await ask(coach);

    const context = contextOf(provider);
    expect(context).toContain("joignable");
    for (const identity of ["Dupont", "marie.dupont@example.fr", "06 12 34 56 78", "rue de la République", "69002"]) expect(context).not.toContain(identity);
  });

  it("so the AI Coach's context is not identity-bearing: it stays on the provider configured for coaching, even under EU AI consent", async () => {
    const claude = createFakeProvider({ id: "anthropic" });
    const mistral = createFakeProvider({ id: "mistral" });
    const ai = createAiLayer({ providers: [claude, mistral], routes: { coaching: "anthropic" }, euAiConsent: async () => true, usage: createMemoryUsageLog() });
    const coach = createCoach({ ai, ...sourcesOf({ ...emptyWorkspace(), profiles: [writtenEverywhere] }) });

    await ask(coach, { kind: "profile", id: profile.id });

    expect(claude.calls).toHaveLength(1);
    expect(mistral.calls).toHaveLength(0);
  });

  it("leaves a phone number written in the CV in some other way to the AI layer's safety net, which sends it to Mistral (#121)", async () => {
    const claude = createFakeProvider({ id: "anthropic" });
    const mistral = createFakeProvider({ id: "mistral" });
    const ai = createAiLayer({ providers: [claude, mistral], routes: { coaching: "anthropic" }, euAiConsent: async () => true, usage: createMemoryUsageLog() });
    const otherPhone: Profile = { ...profile, masterCv: { version: 4, content: { ...profile.masterCv.content, summary: "Mon portable perso : 07.98.76.54.32" } } };
    const coach = createCoach({ ai, ...sourcesOf({ ...emptyWorkspace(), profiles: [otherPhone] }) });

    await ask(coach, { kind: "profile", id: profile.id });

    expect(mistral.calls).toHaveLength(1);
    expect(claude.calls).toHaveLength(0);
  });
});
