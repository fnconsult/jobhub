import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "@jobhub/ai/testing";
import type { BackOfficeAuditEntry } from "../admin/back-office";
import { STARTING_PLAN_QUOTAS } from "../billing";
import { beforeEach, describe, expect, it } from "vitest";
import { backOfficeAccess, type BackOfficeRole } from "../admin/access";
import { createBackOfficeAssistant, type BackOfficeAssistantSources } from "./index";

/** A Provider Secret value, as it would sit in the environment: it must never reach a prompt. */
const SECRET = "sk-live-0123456789abcdef";

/** What the Back Office holds, in the tests. Every source counts its reads. */
function backOfficeData() {
  const reads: string[] = [];
  const sources: BackOfficeAssistantSources = {
    async planQuotas() {
      reads.push("planQuotas");
      return { ...STARTING_PLAN_QUOTAS, premium: { ...STARTING_PLAN_QUOTAS.premium, matchScores: 4321 } };
    },
    async humanCoaches() {
      reads.push("humanCoaches");
      return [
        { id: "c1", name: "Sophie Laurent", email: "sophie.laurent@coachs.example.fr", bookingUrl: "https://cal.com/sophie-laurent", bio: "Ancienne DRH, transitions après 50 ans." },
      ];
    },
    async coachCost() {
      reads.push("coachCost");
      return [
        {
          day: "2026-10-15",
          messages: 812,
          medianEur: 0.0123,
          p90Eur: 0.0345,
          inputTokens: 1_000_000,
          outputTokens: 200_000,
          cachedInputTokens: 50_000,
          models: [{ provider: "mistral", model: "mistral-large", messages: 812 }],
          playbooks: [],
        },
      ];
    },
    async administrators() {
      reads.push("administrators");
      return [
        { candidateId: "a1", email: "claire@jobbbox.fr", roles: ["super-admin"], permanent: true },
        { candidateId: "a2", email: "paul@jobbbox.fr", roles: ["coach-manager", "support"], permanent: false },
      ];
    },
    async journal() {
      reads.push("journal");
      const entries: BackOfficeAuditEntry[] = [
        {
          id: "3",
          at: new Date("2026-10-14T09:00:00Z"),
          actor: { candidateId: "a1", email: "claire@jobbbox.fr" },
          section: "provider_secrets",
          target: "MISTRAL_API_KEY",
          action: "replaced",
          before: null,
          after: null,
        },
        {
          id: "2",
          at: new Date("2026-10-13T09:00:00Z"),
          actor: { candidateId: "a1", email: "claire@jobbbox.fr" },
          section: "roles",
          target: "paul@jobbbox.fr",
          action: "added",
          before: null,
          after: { roles: ["coach-manager"] },
        },
        {
          id: "1",
          at: new Date("2026-10-12T09:00:00Z"),
          actor: { candidateId: "a1", email: "claire@jobbbox.fr" },
          section: "plan_quotas",
          target: "premium",
          action: "updated",
          before: { matchScores: 100 },
          after: { matchScores: 4321 },
        },
      ];
      return entries;
    },
  };
  return { sources, reads };
}

const asked = (question: string) => ({ messages: [{ from: "administrator", text: question }] });

describe("Back Office Assistant", () => {
  let provider: FakeProvider;
  let data: ReturnType<typeof backOfficeData>;

  beforeEach(() => {
    provider = createFakeProvider({ id: "mistral", reply: "Réponse de l'assistant" });
    data = backOfficeData();
  });

  function assistantFor(roles: BackOfficeRole[]) {
    const ai = createAiLayer({ providers: [provider], routes: { coaching: "mistral" }, usage: createMemoryUsageLog() });
    return { assistant: createBackOfficeAssistant({ ai, sources: data.sources }), administrator: { id: "a2", access: backOfficeAccess(roles) } };
  }

  /** The whole prompt the AI was given: the built context and the conversation. */
  const prompt = () => JSON.stringify(provider.calls.at(-1));

  it("a Coach manager's assistant is told about Human Coaches and Coach Message Cost, and nothing outside their roles", async () => {
    const { assistant, administrator } = assistantFor(["coach-manager"]);

    const reply = await assistant.reply(administrator, asked("Quelles sont les clés des fournisseurs ?"));

    expect(reply).toMatchObject({ ok: true, reply: "Réponse de l'assistant" });
    // Out-of-role data is never even read, so it cannot reach the prompt.
    expect(data.reads.sort()).toEqual(["coachCost", "humanCoaches"]);
    expect(prompt()).toContain("Sophie Laurent");
    expect(prompt()).toContain("812");
    expect(prompt()).not.toContain("4321");
    expect(prompt()).not.toContain("MISTRAL_API_KEY");
    expect(prompt()).not.toContain(SECRET);
  });

  it("names the sections outside the Administrator's roles, for the assistant to refuse them", async () => {
    const { assistant, administrator } = assistantFor(["coach-manager"]);

    await assistant.reply(administrator, asked("Montrez-moi la clé Mistral."));

    const system = provider.calls[0]!.system!;
    const outside = system.slice(system.indexOf("Hors des rôles"));
    expect(outside).toContain("Clés des fournisseurs (Provider Secrets)");
    expect(outside).toContain("Quotas des offres");
    expect(outside).toContain("Journal du Back Office");
    expect(outside).not.toContain("Coachs humains");
    expect(system).toContain("lecture seule");
  });

  it("Support reads Plan Quotas, Human Coaches and AI Coach cost, but not who the Administrators are nor the Journal", async () => {
    const { assistant, administrator } = assistantFor(["support"]);

    await assistant.reply(administrator, asked("Combien de Match Scores en Premium ?"));

    expect(data.reads.sort()).toEqual(["coachCost", "humanCoaches", "planQuotas"]);
    expect(prompt()).toContain("Match Scores par mois 4321");
  });

  it("a super-admin's assistant reads every section, yet is given no secret value and no email address", async () => {
    const saved = process.env.MISTRAL_API_KEY;
    process.env.MISTRAL_API_KEY = SECRET;
    try {
      const { assistant, administrator } = assistantFor(["super-admin"]);

      await assistant.reply(administrator, asked("Qui a changé la clé Mistral ?"));

      expect(data.reads.sort()).toEqual(["administrators", "coachCost", "humanCoaches", "journal", "planQuotas"]);
      // That the key was replaced is in the Journal; its value never is, nor is any address.
      expect(prompt()).toContain("remplacement de MISTRAL_API_KEY");
      expect(prompt()).not.toContain(SECRET);
      expect(prompt()).not.toMatch(/@/);
      expect(prompt()).not.toContain("cal.com/sophie-laurent");
      // Administrators are counted, not named.
      expect(prompt()).toContain("- Responsable coaching : 1");
      expect(prompt()).toContain("rôles, ajout de [adresse masquée]");
    } finally {
      if (saved === undefined) delete process.env.MISTRAL_API_KEY;
      else process.env.MISTRAL_API_KEY = saved;
    }
  });

  it("routes per #121: what an Administrator with EU AI consent types carrying identity goes to Mistral, on their own account", async () => {
    const claude = createFakeProvider({ id: "anthropic" });
    const mistral = createFakeProvider({ id: "mistral" });
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({
      providers: [claude, mistral],
      routes: { coaching: "anthropic" },
      usage,
      euAiConsent: async (candidateId) => candidateId === "consenting",
      warn: () => {},
    });
    const assistant = createBackOfficeAssistant({ ai, sources: data.sources });
    const access = backOfficeAccess(["coach-manager"]);

    await assistant.reply({ id: "consenting", access }, asked("Le coach jean.martin@example.fr est-il listé ?"));
    await assistant.reply({ id: "other", access }, asked("Le coach jean.martin@example.fr est-il listé ?"));
    await assistant.reply({ id: "consenting", access }, asked("Combien de coachs ?"));

    expect(mistral.calls).toHaveLength(1);
    expect(claude.calls).toHaveLength(2);
    expect(usage.entries.map((entry) => entry.candidateId)).toEqual(["consenting", "other", "consenting"]);
  });

  it("refuses a malformed conversation, and says so when the AI cannot answer", async () => {
    const { assistant, administrator } = assistantFor(["support"]);

    expect(await assistant.reply(administrator, { messages: [] })).toEqual({ ok: false, error: "invalid" });
    expect(await assistant.reply(administrator, { messages: [{ from: "assistant", text: "Bonjour" }] })).toEqual({ ok: false, error: "invalid" });
    expect(provider.calls).toHaveLength(0);

    const failing = createBackOfficeAssistant({
      ai: createAiLayer({
        providers: [
          createFakeProvider({
            id: "mistral",
            reply: () => {
              throw new Error("provider down");
            },
          }),
        ],
        routes: { coaching: "mistral" },
        usage: createMemoryUsageLog(),
      }),
      sources: data.sources,
    });
    expect(await failing.reply(administrator, asked("Bonjour"))).toEqual({ ok: false, error: "unavailable" });
  });
});
