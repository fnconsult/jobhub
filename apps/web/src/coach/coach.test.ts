import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "@jobhub/ai/testing";
import { loadCoachKnowledge, type CoachKnowledge, type PlaybookId } from "@jobhub/coach-knowledge";
import { describe, expect, it } from "vitest";
import { scoreMatch, type JobOffer } from "@jobhub/shared";
import type { Application } from "@/applications";
import type { JobDigest } from "@/job-digests";
import type { JobSearch } from "@/job-searches";
import type { Profile } from "@/profiles";
import { createCoach, MAX_MESSAGES, recentConversation, type Coach, type CoachDeps, type CoachFocus, COACH_CONTEXT_MAX_TOKENS, estimateTokens, KNOWLEDGE_MAX_TOKENS } from "./index";

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

const jobOffer: JobOffer = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "DAF H/F",
  employer: "Acme Industrie",
  location: "Lyon",
  contractType: "cdi",
  skills: ["IFRS", "Power BI"],
  content: "Rattaché au DG, vous pilotez la clôture mensuelle et le reporting du groupe.",
  source: { url: "https://carrieres.example.fr/daf" },
};
const matchScore = scoreMatch({ cv: profile.masterCv.content, searchCriteria: profile.searchCriteria, jobOffer, today: new Date("2026-10-13") });

const application: Application = {
  id: "33333333-3333-4333-8333-333333333333",
  status: "interview",
  statusChangedAt: new Date("2026-10-01T09:00:00Z"),
  createdAt: new Date("2026-09-20T09:00:00Z"),
  jobOffer,
  profile: { id: profile.id, name: profile.name },
  interviews: [{ id: "i1", scheduledAt: new Date("2026-10-20T14:00:00Z"), note: "avec la DRH" }],
  matchScore,
};

const jobSearch: JobSearch = {
  id: "44444444-4444-4444-8444-444444444444",
  profile: { id: profile.id, name: profile.name, searchCriteria: profile.searchCriteria },
  status: "done",
  failure: null,
  startedAt: new Date("2026-10-10T08:00:00Z"),
  results: [{ jobOffer, matchScore, applicationId: null }],
  metrics: null,
};

const jobDigest: JobDigest = {
  id: "55555555-5555-4555-8555-555555555555",
  profile: { id: profile.id, name: profile.name },
  sentAt: new Date("2026-10-12T05:00:00Z"),
  results: [{ jobOffer: { ...jobOffer, id: "66666666-6666-4666-8666-666666666666", title: "Directeur administratif et financier" }, matchScore, applicationId: null }],
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

function sourcesOf(workspace: Workspace): Omit<CoachDeps, "ai" | "knowledge"> {
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

/** Every Coaching Playbook and the Core Digest, as served before a human validated them ("eval"). */
const knowledge = loadCoachKnowledge({ environment: "eval" });

function coachWith(options: { reply?: string | (() => string); workspace?: Partial<Workspace>; knowledge?: Pick<CoachKnowledge, "playbook" | "coreDigest"> } = {}): {
  coach: Coach;
  provider: FakeProvider;
  usage: ReturnType<typeof createMemoryUsageLog>;
} {
  const provider = createFakeProvider({ id: "mistral", reply: options.reply ?? "Bonjour Marie, que puis-je faire pour vous ?" });
  const usage = createMemoryUsageLog();
  const ai = createAiLayer({ providers: [provider], routes: { coaching: "mistral" }, usage });
  return { coach: createCoach({ ai, knowledge: options.knowledge ?? knowledge, ...sourcesOf({ ...emptyWorkspace(), ...options.workspace }) }), provider, usage };
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
    const coach = createCoach({ ai, knowledge, ...sourcesOf(emptyWorkspace()) });

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
    const coach = createCoach({ ai, knowledge, ...sourcesOf({ ...emptyWorkspace(), profiles: [writtenEverywhere] }) });

    await ask(coach, { kind: "profile", id: profile.id });

    expect(claude.calls).toHaveLength(1);
    expect(mistral.calls).toHaveLength(0);
  });

  it("leaves a phone number written in the CV in some other way to the AI layer's safety net, which sends it to Mistral (#121)", async () => {
    const claude = createFakeProvider({ id: "anthropic" });
    const mistral = createFakeProvider({ id: "mistral" });
    const ai = createAiLayer({ providers: [claude, mistral], routes: { coaching: "anthropic" }, euAiConsent: async () => true, usage: createMemoryUsageLog() });
    const otherPhone: Profile = { ...profile, masterCv: { version: 4, content: { ...profile.masterCv.content, summary: "Mon portable perso : 07.98.76.54.32" } } };
    const coach = createCoach({ ai, knowledge, ...sourcesOf({ ...emptyWorkspace(), profiles: [otherPhone] }) });

    await ask(coach, { kind: "profile", id: profile.id });

    expect(mistral.calls).toHaveLength(1);
    expect(claude.calls).toHaveLength(0);
  });
});

describe("the Coach Memory", () => {
  it("tells the AI Coach what the Candidate confirmed it should remember", async () => {
    const { coach, provider } = coachWith({ workspace: { memory: ["Préfère un poste à moins d'une heure de Lyon", "Ne veut plus travailler dans l'automobile"] } });

    await ask(coach);

    expect(contextOf(provider)).toContain("Préfère un poste à moins d'une heure de Lyon");
    expect(contextOf(provider)).toContain("Ne veut plus travailler dans l'automobile");
  });

  it("says nothing of a Coach Memory that has no items", async () => {
    const { coach, provider } = coachWith();

    await ask(coach);

    expect(contextOf(provider)).not.toMatch(/mémoire/i);
  });
});

describe("the item In view, in full", () => {
  it("a Profile: its Search Criteria and the current version of its Master CV", async () => {
    const { coach, provider } = coachWith();

    await ask(coach, { kind: "profile", id: profile.id });

    expect(contextOf(provider)).toContain("Directrice financière");
    expect(contextOf(provider)).toContain("Groupe Seb");
    expect(contextOf(provider)).toContain("version 2");
  });

  it("an Application: its status, interviews, Match Score and the whole Job Offer", async () => {
    const { coach, provider } = coachWith({ workspace: { applications: [application] } });

    await ask(coach, { kind: "application", id: application.id });

    const context = contextOf(provider);
    expect(context).toContain("Entretien");
    expect(context).toContain("2026-10-20");
    expect(context).toContain("avec la DRH");
    expect(context).toContain(`${matchScore.score}/100`);
    expect(context).toContain("Power BI");
    expect(context).toContain("vous pilotez la clôture mensuelle");
  });

  it("a Job Offer: the whole posting", async () => {
    const { coach, provider } = coachWith({ workspace: { jobOffers: [jobOffer] } });

    await ask(coach, { kind: "job_offer", id: jobOffer.id });

    const context = contextOf(provider);
    expect(context).toContain("DAF H/F");
    expect(context).toContain("Acme Industrie");
    expect(context).toContain("vous pilotez la clôture mensuelle");
  });

  it("a Job Search: its Profile, when it ran and every Job Offer found with its Match Score", async () => {
    const { coach, provider } = coachWith({ workspace: { jobSearches: [jobSearch] } });

    await ask(coach, { kind: "job_search", id: jobSearch.id });

    const context = contextOf(provider);
    expect(context).toContain("2026-10-10");
    expect(context).toMatch(new RegExp(`DAF H/F chez Acme Industrie \\(Lyon\\) : score ${matchScore.score}/100`));
  });

  it("a Job Digest: its Profile, when it was sent and every Job Offer in it with its Match Score", async () => {
    const { coach, provider } = coachWith({ workspace: { jobDigests: [jobDigest] } });

    await ask(coach, { kind: "job_digest", id: jobDigest.id });

    const context = contextOf(provider);
    expect(context).toContain("2026-10-12");
    expect(context).toContain(`Directeur administratif et financier chez Acme Industrie (Lyon) : score ${matchScore.score}/100`);
  });

  it("nothing of an Application, Job Search or Job Digest that is someone else's", async () => {
    const { coach, provider } = coachWith({ workspace: { applications: [application], jobSearches: [jobSearch], jobDigests: [jobDigest] } });

    for (const focus of [
      { kind: "application", id: application.id },
      { kind: "job_search", id: jobSearch.id },
      { kind: "job_digest", id: jobDigest.id },
    ] as const) {
      await coach.reply("someone-else", { messages: [{ from: "candidate", text: "Et ça ?" }], focus });
      expect(contextOf(provider)).not.toContain("Acme Industrie");
    }
  });
});

describe("the rest, summarised", () => {
  const offer = (n: number): JobOffer => ({ ...jobOffer, id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, title: `Offre ${n}` });
  const scored = (n: number, score: number) => ({ jobOffer: offer(n), matchScore: { ...matchScore, score }, applicationId: null });

  it("the 5 latest Applications with their status", async () => {
    const applications = [1, 2, 3, 4, 5, 6].map((n) => ({ ...application, id: `app-${n}`, jobOffer: offer(n), status: n === 1 ? ("applied" as const) : ("to_apply" as const) }));
    const { coach, provider } = coachWith({ workspace: { applications } });

    await ask(coach);

    const context = contextOf(provider);
    expect(context).toContain("Offre 1 chez Acme Industrie (Lyon) : Postulée");
    expect(context).toContain("Offre 5 chez Acme Industrie (Lyon) : À postuler");
    expect(context).not.toContain("Offre 6");
  });

  it("the top 5 Job Offers by Match Score, from the latest Job Search and Job Digest of each active Profile", async () => {
    const { coach, provider } = coachWith({
      workspace: {
        jobSearches: [{ ...jobSearch, results: [scored(1, 90), scored(2, 40), scored(3, 75), scored(4, 20)] }],
        jobDigests: [{ ...jobDigest, results: [scored(5, 85), scored(6, 60), scored(7, 30)] }],
      },
    });

    await ask(coach);

    const context = contextOf(provider);
    const order = ["Offre 1 ", "Offre 5 ", "Offre 3 ", "Offre 6 ", "Offre 2 "].map((title) => context.indexOf(title));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(context).toContain("Offre 1 chez Acme Industrie (Lyon) : score 90/100");
    expect(context).not.toContain("Offre 7");
    expect(context).not.toContain("Offre 4");
  });

  it("the onboarding answers: what each active Profile's Master CV says of the Candidate", async () => {
    const consultant: Profile = {
      ...profile,
      id: "77777777-7777-4777-8777-777777777777",
      name: "Consultante transformation",
      searchCriteria: { targetRole: "Consultante transformation finance", location: "Paris" },
      masterCv: { version: 1, content: { ...profile.masterCv.content, headline: "Consultante en transformation finance", summary: "Vingt ans à piloter des projets ERP." } },
    };
    const archived: Profile = { ...consultant, id: "88888888-8888-4888-8888-888888888888", name: "Ancien profil", archived: true, masterCv: { version: 1, content: { ...consultant.masterCv.content, headline: "Ancien titre" } } };
    const { coach, provider } = coachWith({ workspace: { profiles: [profile, consultant, archived] } });

    await ask(coach);

    const context = contextOf(provider);
    expect(context).toContain("Consultante transformation finance");
    expect(context).toContain("Vingt ans à piloter des projets ERP.");
    expect(context).not.toContain("Ancien titre");
  });
});

describe("the context's cap: about 12k tokens", () => {
  /** About `tokens` tokens of words. */
  const text = (tokens: number, word: string) => `${word} `.repeat(Math.ceil((tokens * 4) / (word.length + 1)));
  const longProfile = (n: number): Profile => ({
    ...profile,
    id: `99999999-9999-4999-8999-${String(n).padStart(12, "0")}`,
    name: `Profil ${n}`,
    masterCv: { version: 1, content: { ...profile.masterCv.content, summary: text(3_000, `résumé${n}`) } },
  });

  it("is about 12k tokens", () => {
    expect(COACH_CONTEXT_MAX_TOKENS).toBe(12_000);
  });

  it("trims the summaries first, keeping the Candidate summary and the item In view whole", async () => {
    const posting = { ...jobOffer, content: text(5_000, "mission") };
    const { coach, provider } = coachWith({ workspace: { profiles: [profile, longProfile(1), longProfile(2), longProfile(3)], jobOffers: [posting] } });

    await ask(coach, { kind: "job_offer", id: posting.id });

    const system = contextOf(provider);
    expect(estimateTokens(system)).toBeLessThanOrEqual(12_000);
    expect(system).toContain(posting.content);
    expect(system).toContain("« Profil 3 » : poste visé");
    expect(system).toContain("résumé1");
    expect(system).not.toContain("résumé3");
  });

  it("keeps the playbooks within the cap too: the item In view is cut, never the playbooks picked", async () => {
    const posting = { ...jobOffer, content: `Début de l'offre. ${text(20_000, "mission")}Fin de l'offre.` };
    const { coach, provider } = coachWith({ workspace: { jobOffers: [posting] } });

    const result = await coach.reply("marie", { messages: [{ from: "candidate", text: "J'ai 55 ans : ce CV colle-t-il à l'offre ?" }], focus: { kind: "job_offer", id: posting.id } });

    expect(result).toMatchObject({ ok: true, playbooks: [{ id: "core-digest" }, { id: "cv-offer-fit-scoring" }, { id: "senior-40plus-positioning" }] });
    const system = contextOf(provider);
    expect(estimateTokens(system)).toBeLessThanOrEqual(COACH_CONTEXT_MAX_TOKENS);
    expect(system).toContain(knowledge.playbook("senior-40plus-positioning")!.text);
    expect(system).toContain(knowledge.playbook("cv-offer-fit-scoring")!.text);
    expect(system).toContain("Début de l'offre.");
    expect(system).not.toContain("Fin de l'offre.");
  });

  it("gives the coaching knowledge at most KNOWLEDGE_MAX_TOKENS, leaving out a second playbook that would go over", async () => {
    const big = (id: PlaybookId) => ({ ...knowledge.playbook(id)!, text: `# ${id}\n\n${text(KNOWLEDGE_MAX_TOKENS / 2, "règle")}` });
    const { coach, provider } = coachWith({ workspace: { applications: [application] }, knowledge: { playbook: big, coreDigest: () => knowledge.coreDigest() } });

    const result = await coach.reply("marie", { messages: [{ from: "candidate", text: "Que me conseillez-vous ?" }], focus: { kind: "application", id: application.id } });

    expect(result).toMatchObject({ ok: true, playbooks: [{ id: "core-digest" }, { id: "cover-letter-writing" }] });
    expect(contextOf(provider)).not.toContain("# ats-optimization");
    expect(estimateTokens(contextOf(provider))).toBeLessThanOrEqual(COACH_CONTEXT_MAX_TOKENS);
  });

  it("cuts the item In view when it alone is over the cap, still telling the Candidate summary", async () => {
    const posting = { ...jobOffer, content: `Début de l'offre. ${text(20_000, "mission")}Fin de l'offre.` };
    const { coach, provider } = coachWith({ workspace: { jobOffers: [posting], memory: ["Vise une PME familiale"] } });

    await ask(coach, { kind: "job_offer", id: posting.id });

    const system = contextOf(provider);
    expect(estimateTokens(system)).toBeLessThanOrEqual(12_000);
    expect(estimateTokens(system)).toBeGreaterThan(11_000);
    expect(system).toContain("Début de l'offre.");
    expect(system).not.toContain("Fin de l'offre.");
    expect(system).toContain("Vise une PME familiale");
    expect(system).toMatch(/19 ans d'expérience/);
  });
});

describe("grounded in the Coaching Playbooks: the Core Digest, plus 1 or 2 playbooks picked from what is In view and the message topic", () => {
  /** The playbooks and versions a reply says it used, the Core Digest first. */
  const used = (...ids: PlaybookId[]) => [{ id: "core-digest", version: knowledge.coreDigest()!.version }, ...ids.map((id) => ({ id, version: knowledge.playbook(id)!.version }))];

  const workspace = { applications: [application], jobOffers: [jobOffer], jobSearches: [jobSearch], jobDigests: [jobDigest] };

  // One row of the playbook table each: In view / topic → playbooks.
  it.each([
    { row: "Application In view", focus: { kind: "application", id: application.id }, message: "Que me conseillez-vous ?", playbooks: ["cover-letter-writing", "ats-optimization"] },
    { row: "Job Offer In view", focus: { kind: "job_offer", id: jobOffer.id }, message: "Que me conseillez-vous ?", playbooks: ["cv-offer-fit-scoring"] },
    { row: "Interview", message: "Comment préparer mon entretien avec le N+1 ?", playbooks: ["interview-journey-stages", "interview-psychology"] },
    { row: "Outreach / network", message: "Comment contacter le directeur financier sur LinkedIn ?", playbooks: ["outreach-first-contact", "application-strategy"] },
    { row: "Freelance / portage / interim", message: "Le portage salarial, est-ce fait pour moi ?", playbooks: ["freelance-mission-positioning"] },
    { row: "Positioning, age, CV", message: "J'ai 56 ans : comment me positionner sans paraître trop âgée ?", playbooks: ["senior-40plus-positioning"] },
    { row: "Pace, motivation, budget", message: "Je perds ma motivation et mon budget fond, quel rythme tenir ?", playbooks: ["coaching-journey-gamification"] },
  ] as { row: string; focus?: CoachFocus; message: string; playbooks: PlaybookId[] }[])("$row → $playbooks", async ({ focus, message, playbooks }) => {
    const { coach, provider } = coachWith({ workspace });

    const result = await coach.reply("marie", { messages: [{ from: "candidate", text: message }], ...(focus ? { focus } : {}) });

    if (!result.ok) throw new Error("no reply");
    expect(result.playbooks).toEqual(used(...playbooks));
    const system = contextOf(provider);
    expect(system).toContain(knowledge.coreDigest()!.title);
    for (const id of playbooks) expect(system).toContain(knowledge.playbook(id)!.title);
  });

  // The Coach is used in French and in English: every topic row reads both.
  it.each([
    { row: "Application: cover letter", message: "Help me with my cover letter", playbooks: ["cover-letter-writing", "ats-optimization"] },
    { row: "Application: résumé keywords", message: "Which keywords will get me past the applicant tracking system?", playbooks: ["cover-letter-writing", "ats-optimization"] },
    { row: "Job Offer: posting fit", message: "Is this job posting a good match for me?", playbooks: ["cv-offer-fit-scoring"] },
    { row: "Interview: salary expectations", message: "What should I answer about my salary expectations?", playbooks: ["interview-journey-stages", "interview-psychology"] },
    { row: "Outreach: headhunters", message: "Should I reach out to headhunters?", playbooks: ["outreach-first-contact", "application-strategy"] },
    { row: "Freelance: self-employed", message: "Could I work self-employed at a daily rate?", playbooks: ["freelance-mission-positioning"] },
    { row: "Positioning: overqualified", message: "Recruiters say I am overqualified, how do I handle my positioning?", playbooks: ["senior-40plus-positioning"] },
    { row: "Pace: exhausted and demotivated", message: "I am exhausted and demotivated", playbooks: ["coaching-journey-gamification"] },
    { row: "Pace: money and unemployment", message: "My unemployment benefits run out soon and I am short of money", playbooks: ["coaching-journey-gamification"] },
  ] as { row: string; message: string; playbooks: PlaybookId[] }[])("in English too: $row → $playbooks", async ({ message, playbooks }) => {
    const { coach } = coachWith({ workspace });

    const result = await coach.reply("marie", { messages: [{ from: "candidate", text: message }] });

    expect(result).toMatchObject({ ok: true, playbooks: used(...playbooks) });
  });

  it("takes an English resume for the CV, not a French « résumé » (a summary)", async () => {
    const { coach } = coachWith();

    const english = await coach.reply("marie", { messages: [{ from: "candidate", text: "How should I rework my resume for this job offer?" }] });
    const french = await coach.reply("marie", { messages: [{ from: "candidate", text: "Pouvez-vous me faire un résumé de cette offre ?" }] });

    expect(english).toMatchObject({ ok: true, playbooks: used("cv-offer-fit-scoring", "senior-40plus-positioning") });
    expect(french).toMatchObject({ ok: true, playbooks: used("cv-offer-fit-scoring") });
  });

  it("does not take an English cover letter (« motivation letter ») for a motivation topic", async () => {
    const { coach } = coachWith();

    const result = await coach.reply("marie", { messages: [{ from: "candidate", text: "Can you review my motivation letter?" }] });

    expect(result).toMatchObject({ ok: true, playbooks: used("cover-letter-writing", "ats-optimization") });
  });

  it("puts the message topic before what is In view: an interview question on an Application page gets the interview playbooks", async () => {
    const { coach } = coachWith({ workspace });

    const result = await coach.reply("marie", { messages: [{ from: "candidate", text: "Mon entretien est jeudi, comment m'y préparer ?" }], focus: { kind: "application", id: application.id } });

    expect(result).toMatchObject({ ok: true, playbooks: used("interview-journey-stages", "interview-psychology") });
  });

  it("adds at most 2 playbooks, the first of each topic before any second, when a message touches several topics", async () => {
    const { coach } = coachWith();

    const result = await coach.reply("marie", { messages: [{ from: "candidate", text: "J'ai 58 ans : comment parler de mon âge en entretien ?" }] });

    expect(result).toMatchObject({ ok: true, playbooks: used("interview-journey-stages", "senior-40plus-positioning") });
  });

  it("reads the topic from the latest message only, accents and case aside", async () => {
    const { coach } = coachWith();

    const result = await coach.reply("marie", {
      messages: [
        { from: "candidate", text: "Comment préparer un ENTRETIEN ?" },
        { from: "coach", text: "Commençons par le recruteur." },
        { from: "candidate", text: "Et en INTERIM, ça se passe comment ?" },
      ],
    });

    expect(result).toMatchObject({ ok: true, playbooks: used("freelance-mission-positioning") });
  });

  it("does not take a cover letter (« lettre de motivation ») for a motivation topic", async () => {
    const { coach } = coachWith();

    const result = await coach.reply("marie", { messages: [{ from: "candidate", text: "Pouvez-vous relire ma lettre de motivation ?" }] });

    expect(result).toMatchObject({ ok: true, playbooks: used("cover-letter-writing", "ats-optimization") });
  });

  it.each([
    { inView: "a Profile (the Candidate's positioning)", focus: { kind: "profile", id: profile.id }, playbooks: ["senior-40plus-positioning"] },
    { inView: "a Job Search (Job Offers and their Match Scores)", focus: { kind: "job_search", id: jobSearch.id }, playbooks: ["cv-offer-fit-scoring"] },
    { inView: "a Job Digest (Job Offers and their Match Scores)", focus: { kind: "job_digest", id: jobDigest.id }, playbooks: ["cv-offer-fit-scoring"] },
    { inView: "nothing, and no topic: the 40+ positioning playbook, which concerns every Candidate", focus: undefined, playbooks: ["senior-40plus-positioning"] },
  ] as { inView: string; focus?: CoachFocus; playbooks: PlaybookId[] }[])("with $inView In view → $playbooks", async ({ focus, playbooks }) => {
    const { coach } = coachWith({ workspace });

    const result = await coach.reply("marie", { messages: [{ from: "candidate", text: "Que me conseillez-vous ?" }], ...(focus ? { focus } : {}) });

    expect(result).toMatchObject({ ok: true, playbooks: used(...playbooks) });
  });

  it("uses only the knowledge served: in production, nothing until a human validated it, and the reply says none was used (ADR-0019)", async () => {
    const { coach, provider } = coachWith({ knowledge: loadCoachKnowledge({ environment: "production" }) });

    const result = await coach.reply("marie", { messages: [{ from: "candidate", text: "Comment préparer mon entretien ?" }] });

    expect(result).toMatchObject({ ok: true, playbooks: [] });
    expect(contextOf(provider)).not.toContain(knowledge.playbook("interview-psychology")!.title);
    expect(contextOf(provider)).not.toContain(knowledge.coreDigest()!.title);
  });

  it("falls back on the next playbook picked when one is not served", async () => {
    const onlyAts: Pick<CoachKnowledge, "playbook" | "coreDigest"> = {
      playbook: (id) => (id === "ats-optimization" ? knowledge.playbook(id) : undefined),
      coreDigest: () => knowledge.coreDigest(),
    };
    const { coach } = coachWith({ workspace, knowledge: onlyAts });

    const result = await coach.reply("marie", { messages: [{ from: "candidate", text: "Que me conseillez-vous ?" }], focus: { kind: "application", id: application.id } });

    expect(result).toMatchObject({ ok: true, playbooks: used("ats-optimization") });
  });
});

describe("the Ground Coach reply prompt", () => {
  /** A small, fixed knowledge base, so the snapshot shows the prompt's shape rather than the playbooks' wording. */
  const source = (id: string, author: string, year: string, title: string) => ({ id, author, year, title, url: `https://example.org/${id}`, licence: "public" });
  const document = (title: string, version: string, text: string, sources: ReturnType<typeof source>[]) => ({
    title,
    version,
    updated: "2026-10-12",
    status: "validé (Claire Martin, 2026-10-13)",
    humanValidated: true,
    rules: [],
    sources,
    text,
  });
  const fixedKnowledge: Pick<CoachKnowledge, "playbook" | "coreDigest"> = {
    coreDigest: () =>
      document("Socle de coaching", "1.0", "# Socle de coaching\n\n**R1. Ne promettez jamais de résultat.** [S55]", [source("S55", "Dares", "2025", "Évaluation de l'accompagnement")]),
    playbook: (id) =>
      id === "interview-psychology"
        ? {
            id,
            ...document("Réussir ses entretiens après 40 ans", "1.2", "# Réussir ses entretiens après 40 ans\n\n## Règles\n\n**R1. Préparez trois exemples chiffrés.** [S24]", [
              source("S24", "Apec", "2026", "Les cadres seniors en recherche d'emploi"),
            ]),
          }
        : undefined,
  };

  it("puts the persona, the rules for using the knowledge, the Core Digest, the playbooks with their Sources, then the Candidate's context", async () => {
    const { coach, provider } = coachWith({ knowledge: fixedKnowledge });

    const result = await coach.reply("marie", { messages: [{ from: "candidate", text: "Comment réussir mon entretien ?" }] });

    expect(result).toMatchObject({ ok: true, playbooks: [{ id: "core-digest", version: "1.0" }, { id: "interview-psychology", version: "1.2" }] });
    const system = contextOf(provider);
    // Playbooks win over general knowledge; no statistic unless it is in a playbook, cited in plain words.
    expect(system).toMatch(/priment sur tes connaissances générales/);
    expect(system).toMatch(/aucun chiffre ni statistique qui ne figure pas dans le socle ou un playbook/);
    expect(system).toMatch(/« Apec, 2026 »/);
    expect(system).toMatch(/conseil général, sans chiffre/);
    expect(system).toMatchSnapshot();
  });
});
