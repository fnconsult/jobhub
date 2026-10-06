import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "@jobhub/ai/testing";
import { describe, expect, it } from "vitest";
import type { Profile } from "@/profiles";
import { createCoach, type Coach } from "./index";

const profile: Profile = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Directrice financière",
  archived: false,
  searchCriteria: { targetRole: "Directrice financière", location: "Lyon", minSalary: 120000 },
  masterCv: {
    version: 2,
    content: {
      fullName: "Marie Dupont",
      headline: "Directrice financière",
      email: "",
      phone: "",
      location: "Lyon",
      summary: "",
      experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "" }],
      education: [],
      skills: ["IFRS"],
      languages: [],
    },
  },
};

function coachWith(options: { reply?: string | (() => string) } = {}): { coach: Coach; provider: FakeProvider; usage: ReturnType<typeof createMemoryUsageLog> } {
  const provider = createFakeProvider({ id: "mistral", reply: options.reply ?? "Bonjour Marie, que puis-je faire pour vous ?" });
  const usage = createMemoryUsageLog();
  const ai = createAiLayer({ providers: [provider], routes: { coaching: "mistral" }, usage });
  // Marie owns the Profile; nobody else can see it.
  const profiles = { get: async (candidateId: string, id: string) => (candidateId === "marie" && id === profile.id ? profile : null) };
  return { coach: createCoach({ ai, profiles }), provider, usage };
}

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

    expect(result).toEqual({ ok: true, reply: "Bonjour Marie, que puis-je faire pour vous ?" });
    expect(provider.calls[0]!.messages).toEqual([
      { role: "user", content: "Bonjour" },
      { role: "assistant", content: "Bonjour, je suis votre coach." },
      { role: "user", content: "Par où commencer ?" },
    ]);
    expect(provider.calls[0]!.system).toMatch(/coach/i);
    expect(usage.entries).toMatchObject([{ candidateId: "marie", task: "coaching" }]);
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

  it("says the AI Coach is unavailable when the AI provider fails", async () => {
    const { coach } = coachWith({
      reply: () => {
        throw new Error("upstream down");
      },
    });

    expect(await coach.reply("marie", { messages: [{ from: "candidate", text: "Bonjour" }] })).toEqual({ ok: false, error: "unavailable" });
  });
});
