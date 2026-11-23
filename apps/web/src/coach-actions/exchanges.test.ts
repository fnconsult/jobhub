/**
 * The Exchange Coach Actions (#1099, ADR-0115): the AI Coach reads an Exchange kept on an Application (`read_exchange`,
 * untrusted) and proposes a reply the Candidate copies or opens in their own mailbox (`propose_exchange_reply`), Jobbbox
 * sending nothing. On in-memory domain modules scoped to their Candidate, behind APPLICATION_EXCHANGES_ENABLED.
 */
import { describe, expect, it } from "vitest";
import type { Application } from "../applications";
import type { Exchange } from "../exchanges";
import { EXCHANGE_ACTIONS, exchangeCoachActions, type ExchangeActionSources } from "./exchanges";
import { createCoachActions, type CoachAction, type CoachActionCall, type ProposedChange } from "./index";

const application = (id: string, profileId: string, employer: string): Application =>
  ({ id, status: "applied", jobOffer: { id: `o-${id}`, title: "Data scientist", employer }, profile: { id: profileId, name: "Data" }, interviews: [] }) as unknown as Application;

const INVITATION: Exchange = {
  id: "x1",
  applicationId: "a1",
  from: "jane@benchling.com",
  subject: "Entretien pour le poste de data scientist",
  text: "Bonjour Marie, seriez-vous disponible mardi à 14 h pour un entretien ? Jane",
  sentAt: new Date("2026-11-20T09:00:00Z"),
  receivedAt: new Date("2026-11-20T09:01:00Z"),
};
const EARLIER: Exchange = { ...INVITATION, id: "x0", subject: "Accusé de réception", text: "Nous avons bien reçu votre candidature.", sentAt: new Date("2026-11-10T09:00:00Z") };

/** Marie's Application at Benchling with two Exchanges, one on an Archived Profile; Paul has none. */
function world(on = true) {
  const applications: Record<string, Application[]> = { marie: [application("a1", "p1", "Benchling"), application("a-old", "p-old", "Ancienne")] };
  const exchanges: Record<string, Exchange[]> = { a1: [EARLIER, INVITATION], "a-old": [{ ...INVITATION, id: "x-old", applicationId: "a-old" }] };
  const mine = (candidateId: string, id: string) => applications[candidateId]?.find((each) => each.id === id) ?? null;
  const sources: ExchangeActionSources = {
    on: () => on,
    applications: { get: async (candidateId, id) => mine(candidateId, id) },
    profiles: { list: async (candidateId) => (candidateId === "marie" ? [{ id: "p1", name: "Data", archived: false }, { id: "p-old", name: "Ancien", archived: true }] : []) } as ExchangeActionSources["profiles"],
    exchanges: {
      onApplication: async (candidateId, id) => (mine(candidateId, id) ? { kept: exchanges[id] ?? [], offered: [] } : null),
      get: async (candidateId, id) => Object.values(exchanges).flat().find((each) => each.id === id && mine(candidateId, each.applicationId)) ?? null,
    },
  };
  const [read, reply] = exchangeCoachActions(sources);
  return { read: read!, reply: reply!, sources };
}

const call = (overrides: Partial<CoachActionCall> = {}): CoachActionCall => ({ candidateId: "marie", language: "fr", maxTokens: 1_500, ...overrides });
const run = (action: CoachAction, args: Record<string, unknown>, at: CoachActionCall = call()) => action.run(action.schema.parse(args), at);

describe("read_exchange (#1099)", () => {
  it("reads the latest Exchange of the Application in view, as untrusted data, naming the others", async () => {
    const { read } = world();
    const result = await run(read, {}, call({ inView: { kind: "application", id: "a1" } }));

    expect(read).toMatchObject({ name: EXCHANGE_ACTIONS.read, kind: "read", copiesText: false });
    expect(result).toMatchObject({ ok: true, untrusted: true, pages: ["/candidatures/a1/echanges"], seen: [{ type: "exchange", name: "Entretien pour le poste de data scientist", href: "/candidatures/a1/echanges" }] });
    const text = (result as { data: string }).data;
    expect(text).toContain("jane@benchling.com");
    expect(text).toContain("seriez-vous disponible mardi");
    expect(text).toContain("<echange>");
    expect(text).toContain("x0");
    expect(text).not.toContain("Nous avons bien reçu");
  });

  it("reads one Exchange by its id; another Candidate's, an Archived Application's or an unknown one is not found", async () => {
    const { read } = world();
    expect(await run(read, { exchangeId: "x0" })).toMatchObject({ ok: true, data: expect.stringContaining("Nous avons bien reçu") });
    expect(await run(read, { exchangeId: "x0" }, call({ candidateId: "paul" }))).toEqual({ ok: false, error: "not_found" });
    expect(await run(read, { exchangeId: "x-old" })).toEqual({ ok: false, error: "not_found" });
    expect(await run(read, { applicationId: "a1", exchangeId: "nope" })).toEqual({ ok: false, error: "not_found" });
  });

  it("says there is none on an Application without Exchanges, and asks which Application with none in view", async () => {
    const { read, sources } = world();
    sources.exchanges.onApplication = async () => ({ kept: [], offered: [] });
    expect(await run(read, { applicationId: "a1" })).toMatchObject({ ok: true, data: expect.stringContaining("Aucun échange") });
    expect(await run(read, {})).toMatchObject({ ok: true, data: expect.objectContaining({ message: expect.stringContaining("Aucune candidature") }) });
  });
});

describe("propose_exchange_reply (#1099)", () => {
  it("proposes the whole reply on a card the Candidate copies or opens in their mailbox, offered even with untrusted text read", async () => {
    const { reply } = world();
    const result = await run(reply, { exchangeId: "x1", text: "Bonjour Jane,\n\nMardi à 14 h me convient très bien.\n\nMarie" });

    expect(reply).toMatchObject({ name: EXCHANGE_ACTIONS.reply, kind: "propose", copiesText: true, sentByCandidate: true });
    expect(result.ok).toBe(true);
    const change = (result as { data: ProposedChange }).data;
    expect(change).toMatchObject({
      target: { kind: "application", id: "a1", name: "Data scientist · Benchling", href: "/candidatures/a1/echanges" },
      after: "Bonjour Jane,\n\nMardi à 14 h me convient très bien.\n\nMarie",
      handOver: { to: "jane@benchling.com", subject: "Re: Entretien pour le poste de data scientist" },
      value: { exchangeId: "x1", text: "Bonjour Jane,\n\nMardi à 14 h me convient très bien.\n\nMarie" },
      fields: [],
    });
    // Applying it only says it was handed over: nothing is sent, no Application Status moves.
    expect(await reply.apply!(change, { candidateId: "marie", cardId: "card-1", at: new Date() })).toEqual({ ok: true });
    expect(await reply.apply!(change, { candidateId: "paul", cardId: "card-1", at: new Date() })).toEqual({ ok: false, error: "not_found" });
  });

  it("keeps a subject already answered as it is", async () => {
    const { reply } = world();
    const result = await run(reply, { exchangeId: "x1", text: "Merci.", subject: "RE: Entretien" });
    expect((result as { data: ProposedChange }).data.handOver).toEqual({ to: "jane@benchling.com", subject: "RE: Entretien" });
  });

  it("is not found for another Candidate's Exchange", async () => {
    const { reply } = world();
    expect(await run(reply, { exchangeId: "x1", text: "Merci." }, call({ candidateId: "paul" }))).toEqual({ ok: false, error: "not_found" });
  });
});

describe("the Exchange Coach Actions behind APPLICATION_EXCHANGES_ENABLED (#1099)", () => {
  const offeredNames = async (actions: readonly CoachAction[], untrustedInView = false) => {
    const coachActions = createCoachActions({ catalog: actions, settings: async () => ({ enabled: true, maxRounds: 2 }), externalApis: { record: () => {} } });
    const reply = await coachActions.forReply("marie", { recorder: { step: async (_step, work) => work(), site: () => {} }, untrustedInView });
    return reply?.tools.map((tool) => tool.name) ?? [];
  };

  it("are offered only while Exchanges are on, the reply even with untrusted text in view", async () => {
    expect(await offeredNames(exchangeCoachActions(world(true).sources), true)).toEqual(["read_exchange", "propose_exchange_reply", "redirect"]);
    expect(await offeredNames(exchangeCoachActions(world(false).sources))).toEqual([]);
  });
});
