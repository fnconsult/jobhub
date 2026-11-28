/**
 * `propose_send` (ADR-0119 « Sending and applying », #1162): the AI Coach proposes to send an Application's Follow-up,
 * Outreach Message or reply to an Exchange from Jobbbox, in the Candidate's name; only the Candidate's click on its card
 * sends it, once. On in-memory domain modules, then through the Action Cards and the Sends on Postgres.
 */
import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActionCards, migrateActionCards, type ActionCards } from "../action-cards";
import { createApplications, migrateApplications, type Application } from "../applications";
import type { Mailer, MailMessage } from "../auth";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { coachProposalHandlers, COACH_PROPOSAL_CARD, proposalCardOf } from "../coach-proposals";
import type { Exchange } from "../exchanges";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { createProfiles, migrateProfiles } from "../profiles";
import { createSends, migrateSends, type SendRequest, type SendResult } from "../sends";
import type { ApplicationDrafts } from "../tailored-documents";
import { createCoachActions, type CoachAction, type CoachActionCall, type ProposedChange } from "./index";
import { SEND_ACTION, sendCoachActions, shortName, type SendActionSources } from "./sends";

const application = (id: string, profileId: string): Application =>
  ({ id, status: "applied", jobOffer: { id: `o-${id}`, title: "Consultante achats", employer: "Exemple Conseil" }, profile: { id: profileId, name: "Achats" }, interviews: [] }) as unknown as Application;

const INVITATION: Exchange = {
  id: "x1",
  applicationId: "a1",
  from: "Claire Martin <claire.martin@exemple-conseil.test>",
  subject: "Votre candidature",
  text: "Bonjour Nathalie, seriez-vous disponible mardi à 14 h ? Claire",
  sentAt: new Date("2026-11-20T09:00:00Z"),
  receivedAt: new Date("2026-11-20T09:01:00Z"),
};

const DRAFTS = (contactEmail: string | undefined, channel: "email" | "inmail" = "email"): ApplicationDrafts =>
  ({
    documentLanguage: "fr",
    coverLetter: null,
    outreachMessage: {
      language: "fr",
      channel,
      subject: "Consultante achats de transition",
      text: "Bonjour Claire, je vous écris au sujet de la mission. Nathalie",
      contactRoles: [],
      contact: { id: "c1", name: "Claire Martin", jobTitle: "Chargée de recrutement", ...(contactEmail ? { email: contactEmail } : {}) },
      draftedAt: new Date("2026-11-19T09:00:00Z"),
      updatedAt: new Date("2026-11-19T09:00:00Z"),
      provenance: null,
    },
  }) as unknown as ApplicationDrafts;

/** Nathalie's Application a1 with a Follow-up waiting, an Outreach Message to Claire and one Exchange; Paul has none. */
function world({ on = true, cap = 20, sentToday = 0, exchanges = [INVITATION], drafts = DRAFTS("claire.martin@exemple-conseil.test") } = {}) {
  const applications: Record<string, Application[]> = { nathalie: [application("a1", "p1"), application("a-old", "p-old")] };
  const mine = (candidateId: string, id: string) => applications[candidateId]?.find((each) => each.id === id) ?? null;
  const sent: SendRequest[] = [];
  const marked: string[] = [];
  const state = { followUp: { cardId: "f1", subject: "Relance de ma candidature", text: "Bonjour, je reviens vers vous au sujet de ma candidature. Nathalie", version: "v1" } as { cardId: string; subject: string; text: string; version: string } | null, sentToday, exchanges };
  const sources: SendActionSources = {
    on: () => on,
    applications: { get: async (candidateId, id) => mine(candidateId, id) },
    profiles: { list: async (candidateId) => (candidateId === "nathalie" ? [{ id: "p1", name: "Achats", archived: false }, { id: "p-old", name: "Ancien", archived: true }] : []) } as SendActionSources["profiles"],
    followUps: {
      draftOf: async (candidateId, id) => (mine(candidateId, id) ? state.followUp : null),
      sentOf: async (candidateId, id) => (mine(candidateId, id) ? { count: 0, status: "applied", version: "s1" } : null),
      markSent: async (_candidateId, id) => {
        marked.push(id);
        return { ok: true, undo: null };
      },
    },
    tailoredDocuments: { get: async (candidateId, id) => (mine(candidateId, id) ? drafts : null) },
    enrichedContacts: {
      contact: async (candidateId, id, contactId) =>
        mine(candidateId, id) && contactId === "c2" ? ({ id: "c2", name: "Paul Lefèvre", emails: ["paul.lefevre@exemple-conseil.test"], phones: [] } as never) : null,
    },
    exchanges: {
      onApplication: async (candidateId, id) => (mine(candidateId, id) ? { kept: state.exchanges.filter((each) => each.applicationId === id), offered: [] } : null),
      get: async (candidateId, id) => state.exchanges.find((each) => each.id === id && mine(candidateId, each.applicationId)) ?? null,
    },
    sends: {
      sendingAs: async (candidateId) => (candidateId === "nathalie" ? { name: "Nathalie Exemple via Jobbbox", copyTo: "nathalie.exemple@example.fr" } : null),
      room: async () => ({ sentToday: state.sentToday, cap }),
      send: async (_candidateId, request): Promise<SendResult> => {
        if (state.sentToday >= cap) return { ok: false, error: "cap", room: { sentToday: state.sentToday, cap } };
        sent.push(request);
        state.sentToday++;
        return { ok: true, sent: { id: "s", applicationId: request.applicationId, kind: request.kind, to: request.to, subject: request.subject, sentAt: new Date(), key: request.key } };
      },
    },
  };
  const [propose] = sendCoachActions(sources);
  return { propose: propose!, sources, sent, marked, state };
}

const call = (overrides: Partial<CoachActionCall> = {}): CoachActionCall => ({ candidateId: "nathalie", language: "fr", inView: { kind: "application", id: "a1" }, ...overrides });
const run = (action: CoachAction, args: Record<string, unknown>, at: CoachActionCall = call()) => action.run(action.schema.parse(args), at);
const changeOf = async (action: CoachAction, args: Record<string, unknown>) => {
  const result = await run(action, args);
  if (!result.ok || result.proposes === false) throw new Error(`no proposal: ${JSON.stringify(result)}`);
  return result.data as ProposedChange;
};
const applying = { candidateId: "nathalie", cardId: "card-1", at: new Date("2026-11-27T10:00:00Z") };

describe("propose_send (ADR-0119, #1162)", () => {
  it("« envoie la relance »: a card « Envoyer à Claire M. » with the whole text, the recipient, who it goes out as and the copy; nothing sent", async () => {
    const { propose, sent } = world();
    const change = await changeOf(propose, { document: "follow_up" });

    expect(propose).toMatchObject({ name: SEND_ACTION, kind: "propose", group: "applications", sentByCandidate: true });
    expect(propose.undo).toBeUndefined();
    expect(change).toMatchObject({
      target: { kind: "application", id: "a1", href: "/candidatures/a1/propositions" },
      what: "Envoyer à Claire M.",
      before: "Relance de ma candidature",
      after: "Bonjour, je reviens vers vous au sujet de ma candidature. Nathalie",
      value: { subject: "Relance de ma candidature", text: "Bonjour, je reviens vers vous au sujet de ma candidature. Nathalie", document: "follow_up" },
      fields: [{ name: "subject", type: "text" }, { name: "text", type: "textarea" }],
      version: "v1",
      send: { to: { email: "claire.martin@exemple-conseil.test", name: "Claire Martin" }, as: "Nathalie Exemple via Jobbbox", copyTo: "nathalie.exemple@example.fr", room: { sentToday: 0, cap: 20 } },
    });
    expect(change.send?.capReached).toBeUndefined();
    expect(sent).toEqual([]);
  });

  it("sends the Outreach Message to its own contact, or to a revealed contact named; a reply to the Exchange's sender, its text required", async () => {
    const { propose } = world();
    expect((await changeOf(propose, { document: "outreach_message" })).send?.to).toEqual({ email: "claire.martin@exemple-conseil.test", name: "Claire Martin" });
    expect((await changeOf(propose, { document: "outreach_message", contactId: "c2" })).what).toBe("Envoyer à Paul L.");
    const reply = await changeOf(propose, { document: "exchange_reply", text: "Bonjour Claire, mardi à 14 h me convient. Nathalie" });
    expect(reply).toMatchObject({ before: "Re: Votre candidature", after: "Bonjour Claire, mardi à 14 h me convient. Nathalie", version: "x1", value: { exchangeId: "x1" }, target: { href: "/candidatures/a1/echanges" } });
    expect(reply.send?.to).toEqual({ email: "claire.martin@exemple-conseil.test", name: "Claire Martin" });
    expect(await run(propose, { document: "exchange_reply" })).toMatchObject({ ok: true, proposes: false });
  });

  it("proposes nothing with no known recipient, nothing to send, or an InMail, and says why", async () => {
    expect(await run(world({ exchanges: [], drafts: DRAFTS(undefined) }).propose, { document: "follow_up" })).toMatchObject({ ok: true, proposes: false, data: { message: expect.stringContaining("Aucun destinataire") } });
    expect(await run(world().propose, { document: "follow_up", contactId: "c-unknown" })).toMatchObject({ ok: true, proposes: false });
    expect(await run(world({ drafts: DRAFTS("x@y.test", "inmail") }).propose, { document: "outreach_message" })).toMatchObject({ ok: true, proposes: false, data: { message: expect.stringContaining("LinkedIn") } });
    const none = world();
    none.state.followUp = null;
    expect(await run(none.propose, { document: "follow_up" })).toMatchObject({ ok: true, proposes: false, data: { message: expect.stringContaining("Aucune relance") } });
  });

  it("says the cap reached on the card itself, still proposed, with no « Envoyer »", async () => {
    const change = await changeOf(world({ cap: 3, sentToday: 3 }).propose, { document: "follow_up" });
    expect(change.send).toMatchObject({ room: { sentToday: 3, cap: 3 }, capReached: true });
  });

  it("reaches only the session's Candidate: another's, an Archived Application or an unknown id is not found", async () => {
    const { propose } = world();
    expect(await run(propose, { document: "follow_up" }, call({ candidateId: "paul" }))).toEqual({ ok: false, error: "not_found" });
    expect(await run(propose, { applicationId: "a-old", document: "follow_up" })).toEqual({ ok: false, error: "not_found" });
    expect(await run(propose, { document: "follow_up" }, call({ inView: undefined }))).toMatchObject({ ok: true, proposes: false });
  });

  it("is offered only while COACH_SEND_ENABLED is on", async () => {
    const offered = async (on: boolean) => {
      const actions = createCoachActions({ catalog: sendCoachActions(world({ on }).sources), settings: async () => ({ enabled: true, maxRounds: 2 }), externalApis: { record: () => {} } });
      const reply = await actions.forReply("nathalie", { recorder: { step: () => {}, site: () => {} } as never, untrustedInView: true });
      return reply?.tools.map((tool) => tool.name) ?? [];
    };
    expect(await offered(true)).toContain(SEND_ACTION);
    expect(await offered(false)).not.toContain(SEND_ACTION);
  });

  it("on the click, sends what the Candidate left, to the recipient read again, once; a Follow-up is marked as sent", async () => {
    const { propose, sent, marked } = world();
    const change = await changeOf(propose, { document: "follow_up" });
    const edited = { ...change, value: { ...change.value, text: "Bonjour Claire, un mot plus court. Nathalie" } };

    expect(await propose.apply!(edited, applying)).toEqual({ ok: true });
    expect(sent).toEqual([{ key: "card-1", applicationId: "a1", kind: "follow_up", to: { email: "claire.martin@exemple-conseil.test", name: "Claire Martin" }, subject: "Relance de ma candidature", text: "Bonjour Claire, un mot plus court. Nathalie" }]);
    expect(marked).toEqual(["a1"]);
  });

  it("refuses the click as a conflict when the draft or its recipient changed since; an empty text or a subject with a line break as invalid", async () => {
    const w = world();
    const change = await changeOf(w.propose, { document: "follow_up" });
    expect(await w.propose.apply!({ ...change, value: { ...change.value, text: " " } }, applying)).toMatchObject({ ok: false, error: "invalid" });
    expect(await w.propose.apply!({ ...change, value: { ...change.value, subject: "Relance\nBcc: x@y.z" } }, applying)).toMatchObject({ ok: false, error: "invalid" });
    expect(await w.propose.apply!({ ...change, send: { ...change.send!, to: { email: "autre@example.test" } } }, applying)).toEqual({ ok: false, error: "conflict" });
    w.state.followUp = { ...w.state.followUp!, version: "v2" };
    expect(await w.propose.apply!(change, applying)).toEqual({ ok: false, error: "conflict" });
    expect(w.sent).toEqual([]);
  });

  it("names a person « Prénom N. », a single name as it is, no name by the address", () => {
    expect(shortName({ email: "a@b.c", name: "Claire Martin" })).toBe("Claire M.");
    expect(shortName({ email: "a@b.c", name: "Jean Pierre de la Fontaine" })).toBe("Jean F.");
    expect(shortName({ email: "a@b.c", name: "Claire" })).toBe("Claire");
    expect(shortName({ email: "a@b.c" })).toBe("a@b.c");
  });
});

const masterCv: MasterCvContent = { fullName: "Nathalie Exemple", headline: "Consultante achats", email: "", phone: "", location: "Paris", summary: "", experience: [], education: [], skills: [], languages: [] };

describe.skipIf(!connectionString)("propose_send's card, clicked (needs Postgres: DATABASE_URL; #1162)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let actionCards: ActionCards;
  let mails: MailMessage[];
  let cap: number;
  let propose: CoachAction;
  let nathalie: string;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateActionCards(database);
    await migrateSends(database);
    const profiles = createProfiles(database);
    const jobOffers = createJobOffers(database);
    const applications = createApplications(database, { jobOffers, profiles });
    nathalie = (await (await testAuth.request("/api/auth/get-session", { cookie: await signInWithMagicLink(testAuth, "nathalie.exemple@example.fr") })).json()).user.id;
    await database.query(`UPDATE candidate SET given_name = 'Nathalie', family_name = 'Exemple' WHERE id = $1`, [nathalie]);
    const profile = await profiles.create(nathalie, { masterCv, searchCriteria: { targetRole: "Consultante achats", locations: ["Paris"] } });
    if (!profile.ok) throw new Error("fixture refused");
    const captured = await jobOffers.capture({ source: { url: "https://www.apec.fr/offre/9" }, title: "Consultante achats", content: "Mission de 9 mois.", employer: "Exemple Conseil" });
    if (!captured.ok) throw new Error("fixture refused");
    const saved = await applications.save(nathalie, { jobOfferId: captured.jobOffer.id, profileId: profile.profile.id });
    if (!saved.ok) throw new Error("fixture refused");
    mails = [];
    cap = 20;
    // A mailer slow enough for a second click to arrive while the first is sending.
    const mailer: Mailer = { send: async (message) => void (await new Promise((resolve) => setTimeout(resolve, 30)), mails.push(message)) };
    const sends = createSends(database, { mailer, cap: () => cap });
    const w = world();
    // The in-memory world, on Nathalie's real Application: its id, her Profile, her account.
    const real = application(saved.application.id, profile.profile.id);
    w.sources.applications = { get: async (candidateId, id) => (candidateId === nathalie && id === real.id ? real : null) };
    w.sources.profiles = { list: async (candidateId) => (candidateId === nathalie ? [{ id: profile.profile.id, name: "Achats", archived: false }] : []) } as SendActionSources["profiles"];
    w.sources.followUps.draftOf = async (candidateId, id) => (candidateId === nathalie && id === real.id ? w.state.followUp : null);
    w.sources.tailoredDocuments = { get: async () => DRAFTS("claire.martin@exemple-conseil.test") };
    w.sources.sends = sends;
    propose = sendCoachActions(w.sources)[0]!;
    actionCards = createActionCards(database, coachProposalHandlers([propose]));
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  async function card() {
    const ran = await propose.run(propose.schema.parse({ document: "follow_up" }), { candidateId: nathalie, language: "fr", inView: { kind: "application", id: (await database.query(`SELECT id FROM application`)).rows[0].id } });
    if (!ran.ok) throw new Error("not proposed");
    const change = ran.data as ProposedChange;
    return actionCards.propose(nathalie, { kind: COACH_PROPOSAL_CARD, title: change.what, body: change.after, focus: { kind: "application", id: change.target.id }, payload: { action: SEND_ACTION, change } });
  }

  it("one click gives one send, with the copy and the Reply-To right; the card says it was sent, with no « Annuler »", async () => {
    const proposed = await card();

    const decided = await actionCards.decide(nathalie, proposed.id, "accept");

    expect(decided).toMatchObject({ ok: true, card: { status: "accepted" } });
    expect(mails).toEqual([
      {
        to: "claire.martin@exemple-conseil.test",
        subject: "Relance de ma candidature",
        text: "Bonjour, je reviens vers vous au sujet de ma candidature. Nathalie",
        fromName: "Nathalie Exemple via Jobbbox",
        cc: "nathalie.exemple@example.fr",
        replyTo: "nathalie.exemple@example.fr",
      },
    ]);
    expect(decided.ok && proposalCardOf(decided.card)?.undoable).toBe(false);
    const { rows } = await database.query(`SELECT kind, recipient_email, status, sent_at FROM sent_email`);
    expect(rows).toEqual([{ kind: "follow_up", recipient_email: "claire.martin@exemple-conseil.test", status: "sent", sent_at: expect.any(Date) }]);
  });

  it("a double click sends once", async () => {
    const proposed = await card();

    const clicks = await Promise.all([actionCards.decide(nathalie, proposed.id, "accept"), actionCards.decide(nathalie, proposed.id, "accept")]);

    expect(mails).toHaveLength(1);
    expect(clicks.map((each) => (each.ok ? "sent" : each.error)).sort()).toEqual(["already_decided", "sent"]);
  });

  it("the cap reached at the click is said on the card, still pending, its « Envoyer » gone; nothing sent", async () => {
    const proposed = await card();
    cap = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const decided = await actionCards.decide(nathalie, proposed.id, "accept");
    warn.mockRestore();

    expect(decided).toMatchObject({ ok: false, error: "quota" });
    const shown = !decided.ok && "card" in decided && decided.card ? proposalCardOf(decided.card) : null;
    expect(shown).toMatchObject({ status: "pending", change: { send: { capReached: true, room: { sentToday: 0, cap: 0 } } } });
    expect(mails).toEqual([]);
  });
});
