import { describe, expect, it } from "vitest";
import { createAiLayer, DataResidencyError, type AiLayerOptions } from "./ai-layer";
import { createFakeProvider, createMemoryUsageLog } from "./testing";

/**
 * EU AI consent (ADR-0007 amendment, issue #121): with the Candidate's consent,
 * an AI call carrying their identity goes to Mistral; anything else follows the
 * provider configured for its task.
 */
function setUp(consenting: string[] = ["cand-consenting"], extra: Partial<AiLayerOptions> = {}) {
  const claude = createFakeProvider({ id: "anthropic", reply: "from claude" });
  const mistral = createFakeProvider({ id: "mistral", reply: "from mistral" });
  const usage = createMemoryUsageLog();
  const warnings: { message: string; details: Record<string, unknown> }[] = [];
  const ai = createAiLayer({
    providers: [claude, mistral],
    routes: { writing: "anthropic", coaching: "anthropic", offer_analysis: "anthropic" },
    identityRoute: { provider: "mistral", model: "mistral-large-latest" },
    euAiConsent: async (candidateId) => consenting.includes(candidateId),
    warn: (message, details) => warnings.push({ message, details }),
    usage,
    ...extra,
  });
  return { ai, claude, mistral, usage, warnings };
}

describe("identity routing under EU AI consent", () => {
  it("sends a call declared to carry identity to Mistral when the Candidate consented", async () => {
    const { ai, claude, mistral, usage } = setUp();

    const result = await ai.generate({
      task: "writing",
      candidateId: "cand-consenting",
      containsIdentity: true,
      prompt: "Lettre signée Marie Dupont",
    });

    expect(result).toMatchObject({ text: "from mistral", provider: "mistral", model: "mistral-large-latest", euAiConsent: true });
    expect(mistral.calls).toHaveLength(1);
    expect(claude.calls).toHaveLength(0);
    expect(usage.entries).toEqual([expect.objectContaining({ candidateId: "cand-consenting", task: "writing", provider: "mistral" })]);
  });

  it("keeps the task's configured provider for a call without identity, even with consent", async () => {
    const { ai, claude, mistral } = setUp();

    const result = await ai.generate({ task: "writing", candidateId: "cand-consenting", prompt: "Résume cette offre : DAF H/F à Lyon" });

    expect(result.provider).toBe("anthropic");
    // Served by its task's route: not the EU AI consent route, so AI Activity shows no « consentement IA UE » chip (#327).
    expect(result).not.toHaveProperty("euAiConsent");
    expect(claude.calls).toHaveLength(1);
    expect(mistral.calls).toHaveLength(0);
  });

  it("keeps the task's configured provider when the Candidate has not consented, even for a call carrying identity", async () => {
    const { ai, claude, mistral } = setUp([]);

    const result = await ai.generate({ task: "writing", candidateId: "cand-1", containsIdentity: true, prompt: "Lettre signée Marie Dupont" });

    expect(result.provider).toBe("anthropic");
    expect(claude.calls).toHaveLength(1);
    expect(mistral.calls).toHaveLength(0);
  });

  it("keeps the task's configured provider for a Guest, who cannot consent", async () => {
    const { ai } = setUp();

    const result = await ai.generate({ task: "writing", candidateId: null, containsIdentity: true, prompt: "Marie Dupont, 06 12 34 56 78" });

    expect(result.provider).toBe("anthropic");
  });

  describe("safety net: identity found in a call that did not declare it", () => {
    it("forces Mistral when an undeclared phone number is found, and logs the hit without the prompt", async () => {
      const { ai, claude, mistral, warnings } = setUp();

      const result = await ai.generate({
        task: "coaching",
        candidateId: "cand-consenting",
        prompt: "Rappelez-moi au 06 12 34 56 78 pour parler de ma candidature",
      });

      expect(result.provider).toBe("mistral");
      expect(mistral.calls).toHaveLength(1);
      expect(claude.calls).toHaveLength(0);
      expect(warnings).toEqual([
        { message: expect.stringMatching(/undeclared identity/i), details: { task: "coaching", candidateId: "cand-consenting", found: ["phone"] } },
        // Routed on what the call says, then redacted: Mistral is not sent the number either.
        { message: expect.stringMatching(/redacted/i), details: { task: "coaching", candidateId: "cand-consenting", redacted: { phone: 1 } } },
      ]);
      expect(JSON.stringify(warnings)).not.toContain("06 12");
      expect(mistral.calls[0]!.messages[0]!.content).toBe("Rappelez-moi au [TÉLÉPHONE] pour parler de ma candidature");
    });

    it.each([
      "06 12 34 56 78",
      "06.12.34.56.78",
      "06-12-34-56-78",
      "0612345678",
      "079 123 45 67",
      "+33 6 12 34 56 78",
      "+33 (0)6 12 34 56 78",
      "+33612345678",
      "0033 6 12 34 56 78",
      "+1 (415) 555-0132",
    ])("finds the phone number %s", async (phone) => {
      const { ai, warnings } = setUp();

      const result = await ai.generate({ task: "coaching", candidateId: "cand-consenting", prompt: `Mon numéro : ${phone}, merci.` });

      expect(result.provider).toBe("mistral");
      expect(warnings.filter(({ message }) => /undeclared/i.test(message))).toEqual([expect.objectContaining({ details: expect.objectContaining({ found: ["phone"] }) })]);
    });

    // Job-offer text is full of long digit runs that are not phone numbers: those calls keep their task's provider, unlogged.
    it.each([
      "Posted 2026-10-12 10:30",
      "Publiée le 05.10.2026 10:30",
      "Salaire 45000-55000 €",
      "Salaire 45 000 - 55 000 € brut annuel",
      "Réf. 2024-123456",
      "SIREN 552 100 554",
      "SIRET 552 100 554 00013",
      "Budget de 1 000 000 000 €",
      "+30 000 000 visiteurs par mois",
      "Code postal 69003, 12 rue de la République",
    ])("does not take %s for a phone number", async (text) => {
      const { ai, claude, mistral, warnings } = setUp();

      const result = await ai.generate({ task: "offer_analysis", candidateId: "cand-consenting", prompt: `Offre : DAF H/F. ${text}.` });

      expect(result.provider).toBe("anthropic");
      expect(claude.calls).toHaveLength(1);
      expect(mistral.calls).toHaveLength(0);
      expect(warnings).toEqual([]);
    });
  });

  describe("the identity route stays in the EU", () => {
    it("refuses to start with an identity route outside the EU", () => {
      const usOpenAi = createFakeProvider({ id: "openai", residency: "outside_eu" });
      expect(() =>
        createAiLayer({
          providers: [usOpenAi, createFakeProvider({ id: "anthropic" })],
          routes: { writing: "anthropic" },
          identityRoute: { provider: "openai" },
          euAiConsent: async () => true,
          usage: createMemoryUsageLog(),
        }),
      ).toThrow(DataResidencyError);
    });

    it("refuses an identity-bearing call for a task without personal data if the identity route left the EU after start-up", async () => {
      const drifting = { ...createFakeProvider({ id: "mistral" }), residency: "eu" as "eu" | "outside_eu" };
      const { ai } = setUp(["cand-consenting"], {
        providers: [createFakeProvider({ id: "anthropic", residency: "outside_eu" }), drifting],
        routes: { offer_analysis: "anthropic" },
      });
      drifting.residency = "outside_eu";

      await expect(
        ai.generate({ task: "offer_analysis", candidateId: "cand-consenting", prompt: "Contact : rh@example.fr" }),
      ).rejects.toThrow(DataResidencyError);
    });
  });
});
