import { describe, expect, it } from "vitest";
import { createAiLayer, type AiLayerOptions } from "./ai-layer";
import { redactIdentity, REDACTION_NOTE, type CandidateIdentity } from "./redaction";
import { createFakeProvider, createMemoryUsageLog } from "./testing";

const marie: CandidateIdentity = {
  fullName: ["Marie Dupont", "DUPONT Marie"],
  firstName: "Marie",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  address: "12 rue des Lilas, 69003 Lyon",
  links: ["https://www.linkedin.com/in/marie-dupont"],
};

/**
 * Redaction (ADR-0007 amendment of 2026-10-20): what names or reaches the Candidate is taken out of every
 * AI call before it leaves, and put back in the reply.
 */
describe("redacting the Candidate's identity", () => {
  it("takes out every email address and phone number by its shape, without knowing the Candidate", () => {
    const { texts, counts } = redactIdentity(["Contact : rh@acme.example ou +33 6 98 76 54 32, sinon jean@acme.example."]);

    expect(texts).toEqual(["Contact : [E-MAIL] ou [TÉLÉPHONE], sinon [E-MAIL 2]."]);
    expect(counts).toEqual({ email: 2, phone: 1 });
  });

  it("leaves a text with nothing to take out as it is", () => {
    const redaction = redactIdentity(["Offre : DAF H/F à Lyon, salaire 45 000 - 55 000 €, réf. 2024-123456"], marie);

    expect(redaction.texts).toEqual(["Offre : DAF H/F à Lyon, salaire 45 000 - 55 000 €, réf. 2024-123456"]);
    expect(redaction.redacted).toBe(false);
    expect(redaction.restore("Bonjour [NOM]")).toBe("Bonjour [NOM]");
  });

  it("takes out the known full name, last name, address and links, whatever their case and spacing, and keeps the first name", () => {
    const { texts, counts } = redactIdentity(
      ["MARIE   DUPONT\n12 rue des Lilas,  69003 Lyon\nhttps://www.linkedin.com/in/marie-dupont", "Marie a travaillé avec M. Dupont ; signé DUPONT Marie"],
      marie,
    );

    expect(texts).toEqual(["[NOM]\n[ADRESSE]\n[LIEN]", "Marie a travaillé avec M. [NOM DE FAMILLE] ; signé [NOM 2]"]);
    expect(counts).toEqual({ name: 3, address: 1, link: 1 });
  });

  it("matches a known phone number whatever separates its digits, and a name only as a whole word", () => {
    const { texts } = redactIdentity(["Tél. 06/12/34/56/78 ; Duponteau SA ; Dupont-Aignan"], { fullName: "Marie Dupont", phone: "0612345678" });

    // "06/12/…" has no phone shape the scan knows: only the known number finds it.
    expect(texts[0]).toBe("Tél. 06/12/34/56/78 ; Duponteau SA ; [NOM DE FAMILLE]-Aignan");
    expect(redactIdentity(["Tél. 06 12 34 56 78"], { phone: "0612345678" }).texts).toEqual(["Tél. [TÉLÉPHONE]"]);
  });

  it("gives one value the same placeholder in every text of the call", () => {
    const { texts } = redactIdentity(["Écrivez à marie.dupont@example.fr", "MARIE.DUPONT@EXAMPLE.FR répondra"], marie);

    expect(texts).toEqual(["Écrivez à [E-MAIL]", "[E-MAIL] répondra"]);
  });

  it("puts back in a reply the values this call took out, as first written, and only those", () => {
    const redaction = redactIdentity(["CV de Marie Dupont, marie.dupont@example.fr"], marie);

    expect(redaction.restore('{"fullName": "[NOM]", "email": "[ e-mail ]", "phone": "[TÉLÉPHONE]", "other": "[NOM 2]"}')).toBe(
      '{"fullName": "Marie Dupont", "email": "marie.dupont@example.fr", "phone": "[TÉLÉPHONE]", "other": "[NOM 2]"}',
    );
  });

  it("never reads « [NOM DE FAMILLE] » as « [NOM] »", () => {
    const redaction = redactIdentity(["Marie Dupont, dite Dupont"], marie);

    expect(redaction.texts).toEqual(["[NOM], dite [NOM DE FAMILLE]"]);
    expect(redaction.restore("[NOM DE FAMILLE] / [NOM]")).toBe("Dupont / Marie Dupont");
  });

  it("tells the last name apart without a first name given, the family name in capitals as French CVs write it", () => {
    expect(redactIdentity(["DUPONT Marie ; Dupont ; Marie"], { fullName: "DUPONT Marie" }).texts).toEqual(["[NOM] ; [NOM DE FAMILLE] ; Marie"]);
    expect(redactIdentity(["Jean-Pierre Martin ; Martin ; Jean-Pierre"], { fullName: "Jean-Pierre Martin" }).texts).toEqual(["[NOM] ; [NOM DE FAMILLE] ; Jean-Pierre"]);
  });

  it("does not match a last name shorter than 3 letters", () => {
    expect(redactIdentity(["Li a écrit à Li Wei"], { fullName: "Wei Li", firstName: "Wei" }).texts).toEqual(["Li a écrit à Li Wei"]);
  });
});

describe("every AI call is redacted before it leaves", () => {
  function setUp(extra: Partial<AiLayerOptions> = {}) {
    const claude = createFakeProvider({ id: "anthropic", reply: (input) => `Bien à vous,\n[NOM]\n(${input.messages.length})` });
    const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu" });
    const usage = createMemoryUsageLog();
    const warnings: { message: string; details: Record<string, unknown> }[] = [];
    const lookups: string[] = [];
    const ai = createAiLayer({
      providers: [claude, perplexity],
      routes: { writing: "anthropic", cv_parsing: "anthropic", web_search: "perplexity" },
      usage,
      warn: (message, details) => warnings.push({ message, details }),
      identityOf: async (candidateId) => {
        lookups.push(candidateId);
        return candidateId === "marie" ? marie : null;
      },
      ...extra,
    });
    return { ai, claude, perplexity, usage, warnings, lookups };
  }

  it("sends the provider no identity, tells it to keep the placeholders, and puts the values back in the reply", async () => {
    const { ai, claude } = setUp();

    const result = await ai.generate({ task: "writing", candidateId: "marie", system: "Signe pour Marie Dupont.", prompt: "Lettre pour Marie Dupont (marie.dupont@example.fr)" });

    expect(claude.calls[0]!.system).toBe(`Signe pour [NOM].\n\n${REDACTION_NOTE}`);
    expect(claude.calls[0]!.messages).toEqual([{ role: "user", content: "Lettre pour [NOM] ([E-MAIL])" }]);
    expect(result.text).toBe("Bien à vous,\nMarie Dupont\n(1)");
  });

  it("keeps in the AI Message Log what was sent, redacted, and the reply as it came", async () => {
    const { ai, usage } = setUp();

    await ai.generate({ task: "writing", candidateId: "marie", prompt: "Lettre pour Marie Dupont" });

    expect(usage.entries[0]!.transcript).toEqual({ system: REDACTION_NOTE, messages: [{ role: "user", content: "Lettre pour [NOM]" }], reply: "Bien à vous,\n[NOM]\n(1)" });
    expect(JSON.stringify(usage.entries)).not.toContain("Dupont");
  });

  it("warns how many values of each kind it took out, never the values", async () => {
    const { ai, warnings } = setUp();

    await ai.generate({ task: "writing", candidateId: "marie", prompt: "Marie Dupont, 06 12 34 56 78" });

    expect(warnings).toEqual([{ message: expect.stringMatching(/redacted/i), details: { task: "writing", candidateId: "marie", redacted: { name: 1, phone: 1 } } }]);
    expect(JSON.stringify(warnings)).not.toMatch(/Dupont|06 12/);
  });

  it("leaves a call with nothing to take out unchanged, its system text included", async () => {
    const { ai, claude, warnings } = setUp();

    await ai.generate({ task: "writing", candidateId: "marie", system: "Sois bref.", prompt: "Résume l'offre : DAF H/F" });

    expect(claude.calls[0]).toMatchObject({ system: "Sois bref.", messages: [{ role: "user", content: "Résume l'offre : DAF H/F" }] });
    expect(warnings).toEqual([]);
  });

  it("reads a new CV's identity back: the reading gets the values the call took out", async () => {
    const reader = createFakeProvider({ id: "anthropic", reply: '{"fullName":"[NOM]","email":"[E-MAIL]","phone":"[TÉLÉPHONE]"}' });
    const { ai } = setUp({ providers: [reader], routes: { cv_parsing: "anthropic" } });

    const result = await ai.generate({ task: "cv_parsing", candidateId: "marie", containsIdentity: true, prompt: "CV :\nMarie Dupont\nmarie.dupont@example.fr\n06 12 34 56 78" });

    expect(reader.calls[0]!.messages[0]!.content).toBe("CV :\n[NOM]\n[E-MAIL]\n[TÉLÉPHONE]");
    expect(JSON.parse(result.text)).toEqual({ fullName: "Marie Dupont", email: "marie.dupont@example.fr", phone: "06 12 34 56 78" });
  });

  it("redacts by shape alone, with a warning, when the identity lookup fails", async () => {
    const { ai, claude, warnings } = setUp({ identityOf: async () => Promise.reject(new Error("database down")) });

    const result = await ai.generate({ task: "writing", candidateId: "marie", prompt: "Marie Dupont, marie.dupont@example.fr" });

    expect(claude.calls[0]!.messages[0]!.content).toBe("Marie Dupont, [E-MAIL]");
    expect(result.text).toContain("[NOM]");
    expect(warnings.map((warning) => warning.message)).toEqual([expect.stringMatching(/identity unavailable/i), expect.stringMatching(/redacted/i)]);
  });

  it("never fails a call on a lookup that throws", async () => {
    const { ai } = setUp({
      identityOf: () => {
        throw new Error("boom");
      },
    });

    await expect(ai.generate({ task: "writing", candidateId: "marie", prompt: "Bonjour" })).resolves.toMatchObject({ provider: "anthropic" });
  });

  it("looks a Candidate up once a minute at most, and never a Guest", async () => {
    let at = new Date("2026-10-20T10:00:00Z");
    const { ai, lookups } = setUp({ now: () => at });

    await ai.generate({ task: "writing", candidateId: "marie", prompt: "a" });
    await ai.generate({ task: "writing", candidateId: "marie", prompt: "b" });
    await ai.generate({ task: "writing", candidateId: null, prompt: "c" });
    at = new Date("2026-10-20T10:01:01Z");
    await ai.generate({ task: "writing", candidateId: "marie", prompt: "d" });

    expect(lookups).toEqual(["marie", "marie"]);
  });

  it("redacts a web search's query too", async () => {
    const { ai, perplexity, usage } = setUp();

    await ai.searchCompany({ candidateId: "marie", employer: "Dupont Conseil" });

    expect(perplexity.queries[0]).toContain("[NOM DE FAMILLE] Conseil");
    expect(perplexity.queries[0]).not.toContain("Dupont");
    expect(usage.entries[0]!.transcript.messages[0]!.content).toBe(perplexity.queries[0]);
  });
});
