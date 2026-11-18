/**
 * The draft Coach Actions (ADR-0077 as amended by ADR-0109): the AI Coach reads an Application's drafts (the pending
 * Follow-up, the Cover Letter, the Outreach Message) and proposes a new text for one, as an Action Card the Candidate
 * applies, edits first or ignores. On in-memory domain modules scoped to their Candidate.
 */
import { describe, expect, it } from "vitest";
import type { Application } from "../applications";
import type { ApplicationDrafts } from "../tailored-documents";
import { DRAFT_ACTIONS, draftCoachActions, type DraftActionSources, type FollowUpDraftState } from "./drafts";
import { createCoachActions, type CoachAction, type CoachActionCall, type ProposalCall, type ProposedChange } from "./index";

const application = (id: string, profileId: string, title: string): Application =>
  ({
    id,
    status: "applied",
    jobOffer: { id: `o-${id}`, title, employer: "Fynd Recrutement" },
    profile: { id: profileId, name: "HEAD OF BU" },
    interviews: [],
  }) as unknown as Application;

const DRAFTED = new Date("2026-11-02T09:00:00Z");
const LONG_FOLLOW_UP =
  "Bonjour,\n\nJe me permets de revenir vers vous au sujet de ma candidature au poste de Head of BU, que je vous ai adressée récemment. Ce rôle correspond à mon projet.\n\nCordialement,";

/** Marie's world: an Application with a pending Follow-up, a Cover Letter and an Outreach Message; an archived one; Paul has none. */
function world() {
  const applications: Record<string, Application[]> = {
    marie: [application("a1", "p-bu", "Head Of Business Unit"), application("a-old", "p-old", "Contrôleuse")],
  };
  const mine = (candidateId: string, applicationId: string) => applications[candidateId]?.find((each) => each.id === applicationId) ?? null;
  const drafts: ApplicationDrafts = {
    documentLanguage: "fr",
    coverLetter: {
      language: "fr",
      text: "Madame, Monsieur,\n\nLettre longue.\n\nCordialement,",
      draftedAt: DRAFTED,
      updatedAt: DRAFTED,
      provenance: null,
    } as unknown as ApplicationDrafts["coverLetter"],
    outreachMessage: {
      language: "fr",
      channel: "email",
      subject: "Votre poste de Head of BU",
      contactRoles: [],
      contact: null,
      text: "Bonjour, message long.",
      draftedAt: DRAFTED,
      updatedAt: DRAFTED,
      provenance: null,
    } as unknown as ApplicationDrafts["outreachMessage"],
  };
  let followUp: FollowUpDraftState | null = {
    cardId: "fu-1",
    subject: "Relance de ma candidature : Head Of Business Unit",
    text: LONG_FOLLOW_UP,
    version: "v-fu-1",
  };
  const written: {
    document: string;
    value: Record<string, string>;
    version: string;
    cardId: string;
  }[] = [];
  const sources: DraftActionSources = {
    applications: { get: async (candidateId, id) => mine(candidateId, id) },
    profiles: {
      list: async (candidateId) =>
        candidateId === "marie"
          ? [
              { id: "p-bu", name: "HEAD OF BU", archived: false },
              { id: "p-old", name: "Ancien", archived: true },
            ]
          : [],
    },
    tailoredDocuments: {
      get: async (candidateId, id) => (mine(candidateId, id) ? drafts : null),
      rework: async (_candidateId, _applicationId, input, { version, origin }) => {
        written.push({
          document: input.document,
          value: {
            text: input.text,
            ...(input.subject ? { subject: input.subject } : {}),
          },
          version,
          cardId: origin.cardId,
        });
        return version === DRAFTED.toISOString() ? { ok: true, undo: { before: "kept" } } : { ok: false, error: "conflict" };
      },
      unrework: async () => ({ ok: true }),
    },
    followUps: {
      draftOf: async (candidateId, id) => (mine(candidateId, id) ? followUp : null),
      reword: async (_candidateId, _applicationId, draft, { version, origin }) => {
        written.push({
          document: "follow_up",
          value: { text: draft.text, subject: draft.subject },
          version,
          cardId: origin.cardId,
        });
        return version === followUp?.version ? { ok: true, undo: { before: "kept" } } : { ok: false, error: "conflict" };
      },
      unreword: async () => ({ ok: true }),
    },
  };
  return { sources, drafts, written, noFollowUp: () => (followUp = null) };
}

const call = (candidateId = "marie", more: Partial<CoachActionCall> = {}): CoachActionCall => ({ candidateId, language: "fr", ...more });
const onApplication = (candidateId = "marie") => call(candidateId, { inView: { kind: "application", id: "a1" } });
const applied = (candidateId = "marie"): ProposalCall => ({
  candidateId,
  cardId: "card-1",
  at: new Date("2026-11-18T13:50:00Z"),
});
const actionOf = (sources: DraftActionSources, name: string): CoachAction => draftCoachActions(sources).find((action) => action.name === name)!;

async function proposed(action: CoachAction, args: Record<string, unknown>, at = onApplication()): Promise<ProposedChange> {
  const result = await action.run(action.schema.parse(args), at);
  if (!result.ok || result.proposes === false) throw new Error(`nothing proposed: ${JSON.stringify(result)}`);
  return result.data as ProposedChange;
}

describe("the draft Coach Actions (ADR-0109)", () => {
  it("are a read and a proposal of the Documents group; the proposal is a draft the Candidate sends themselves", () => {
    const actions = draftCoachActions(world().sources);

    expect(
      actions.map(({ name, group, kind, copiesText, sentByCandidate }) => ({
        name,
        group,
        kind,
        copiesText,
        sentByCandidate,
      })),
    ).toEqual([
      {
        name: "read_draft",
        group: "documents",
        kind: "read",
        copiesText: false,
        sentByCandidate: undefined,
      },
      {
        name: "propose_draft_text",
        group: "documents",
        kind: "propose",
        copiesText: true,
        sentByCandidate: true,
      },
    ]);
  });

  it("stay offered with an Application In view, where the Candidate asks: the narrowing spares a draft they send themselves", async () => {
    const actions = createCoachActions({
      catalog: draftCoachActions(world().sources),
      settings: async () => ({ enabled: true, maxRounds: 2 }),
      externalApis: { record: () => {} },
    });
    const offered = await actions.forReply("marie", {
      recorder: { step: async () => undefined as never, site: () => {} },
      untrustedInView: true,
    });

    expect(offered?.tools.map((tool) => tool.name)).toEqual(Object.values(DRAFT_ACTIONS));
  });

  describe("read_draft", () => {
    it("gives the pending Follow-up's subject and text, the Application In view, as data from a draft written from the Job Offer", async () => {
      const read = actionOf(world().sources, DRAFT_ACTIONS.read);

      const result = await read.run(read.schema.parse({ document: "follow_up" }), onApplication());

      expect(result).toMatchObject({
        ok: true,
        untrusted: true,
        pages: ["/candidatures/a1/propositions"],
      });
      if (!result.ok) throw new Error("not read");
      expect(result.data).toContain("Relance de ma candidature : Head Of Business Unit");
      expect(result.data).toContain("Ce rôle correspond à mon projet.");
    });

    it("gives the Cover Letter's and the Outreach Message's text", async () => {
      const read = actionOf(world().sources, DRAFT_ACTIONS.read);

      const letter = await read.run(read.schema.parse({ document: "cover_letter" }), onApplication());
      const message = await read.run(read.schema.parse({ document: "outreach_message" }), onApplication());

      expect(letter).toMatchObject({
        ok: true,
        pages: ["/candidatures/a1/documents?resultat=lettre"],
      });
      expect(letter.ok && letter.data).toContain("Lettre longue.");
      expect(message.ok && message.data).toContain("Votre poste de Head of BU");
    });

    it("says, in our own words before the draft, that Jobbbox keeps only its current version: asked for « les 2 versions », the AI Coach can say so", async () => {
      const read = actionOf(world().sources, DRAFT_ACTIONS.read);

      const result = await read.run(read.schema.parse({ document: "cover_letter" }), onApplication());

      if (!result.ok) throw new Error("not read");
      const said = String(result.data);
      expect(said.indexOf("seule version")).toBeGreaterThanOrEqual(0);
      expect(said.indexOf("seule version")).toBeLessThan(said.indexOf("<brouillon>"));
      expect(said).toMatch(/« Remplacer et rédiger » la remplace/);
    });

    it("says there is none when no Follow-up waits, so the AI Coach says so instead of failing", async () => {
      const { sources, noFollowUp } = world();
      noFollowUp();
      const read = actionOf(sources, DRAFT_ACTIONS.read);

      const result = await read.run(read.schema.parse({ document: "follow_up" }), onApplication());

      expect(result).toMatchObject({ ok: true });
      expect(result.ok && result.data).toMatch(/Aucune relance/);
    });

    it("finds no one else's Application, nor an Archived one", async () => {
      const read = actionOf(world().sources, DRAFT_ACTIONS.read);

      expect(await read.run(read.schema.parse({ document: "follow_up", applicationId: "a1" }), call("paul"))).toEqual({ ok: false, error: "not_found" });
      expect(await read.run(read.schema.parse({ document: "follow_up", applicationId: "a-old" }), call())).toEqual({ ok: false, error: "not_found" });
    });
  });

  describe("propose_draft_text", () => {
    it("proposes the Follow-up shortened: before → after on the Application's « Propositions », its form a subject and a text", async () => {
      const propose = actionOf(world().sources, DRAFT_ACTIONS.rework);

      const change = await proposed(propose, {
        document: "follow_up",
        text: "Bonjour,\n\nOù en est ma candidature ?\n\nCordialement,",
      });

      expect(change).toMatchObject({
        target: {
          kind: "application",
          id: "a1",
          name: "Head Of Business Unit · Fynd Recrutement",
          href: "/candidatures/a1/propositions",
        },
        what: "Relance",
        before: LONG_FOLLOW_UP,
        after: "Bonjour,\n\nOù en est ma candidature ?\n\nCordialement,",
        value: {
          subject: "Relance de ma candidature : Head Of Business Unit",
          text: "Bonjour,\n\nOù en est ma candidature ?\n\nCordialement,",
        },
        version: "v-fu-1",
      });
      expect(change.fields.map((field) => [field.name, field.type])).toEqual([
        ["subject", "text"],
        ["text", "textarea"],
      ]);
    });

    it("applies the text as the Candidate left it, from the version seen, the card as its Origin; « Annuler » puts the draft before back", async () => {
      const { sources, written } = world();
      const propose = actionOf(sources, DRAFT_ACTIONS.rework);
      const change = await proposed(propose, {
        document: "follow_up",
        text: "Court.",
      });

      const result = await propose.apply!({ ...change, value: { ...change.value, text: "Court, revu par moi." } }, applied());

      expect(result).toEqual({
        ok: true,
        undo: {
          document: "follow_up",
          applicationId: "a1",
          undo: { before: "kept" },
        },
      });
      expect(written).toEqual([
        {
          document: "follow_up",
          value: {
            text: "Court, revu par moi.",
            subject: "Relance de ma candidature : Head Of Business Unit",
          },
          version: "v-fu-1",
          cardId: "card-1",
        },
      ]);
      expect(await propose.undo!((result as { undo: unknown }).undo, applied())).toEqual({ ok: true });
    });

    it("is refused as a conflict when the draft changed since the card", async () => {
      const propose = actionOf(world().sources, DRAFT_ACTIONS.rework);
      const change = await proposed(propose, {
        document: "follow_up",
        text: "Court.",
      });

      expect(await propose.apply!({ ...change, version: "v-older" }, applied())).toEqual({ ok: false, error: "conflict" });
    });

    it("proposes a Cover Letter's new text, opened in its Result, applied from the draft's last change", async () => {
      const { sources, written } = world();
      const propose = actionOf(sources, DRAFT_ACTIONS.rework);

      const change = await proposed(propose, {
        document: "cover_letter",
        text: "Madame, Monsieur,\n\nLettre courte.\n\nCordialement,",
      });
      await propose.apply!(change, applied());

      expect(change).toMatchObject({
        target: { href: "/candidatures/a1/documents?resultat=lettre" },
        what: "Lettre de motivation",
        version: DRAFTED.toISOString(),
      });
      expect(change.fields.map((field) => field.name)).toEqual(["text"]);
      expect(written[0]).toMatchObject({
        document: "cover_letter",
        value: { text: "Madame, Monsieur,\n\nLettre courte.\n\nCordialement," },
      });
    });

    it("proposes nothing when there is no draft to rework: the AI Coach is told where the Candidate drafts one", async () => {
      const { sources, noFollowUp } = world();
      noFollowUp();
      const propose = actionOf(sources, DRAFT_ACTIONS.rework);

      const result = await propose.run(propose.schema.parse({ document: "follow_up", text: "Court." }), onApplication());

      expect(result).toMatchObject({ ok: true, proposes: false });
    });

    it("refuses a new text with a paragraph in another language than the draft's, telling the AI Coach to keep its language (#1074)", async () => {
      const propose = actionOf(world().sources, DRAFT_ACTIONS.rework);
      const mixed = "Bonjour,\n\nI am writing to follow up on my application for the Head of Business Unit position, which I sent you recently.\n\nCordialement,";

      const result = await propose.run(propose.schema.parse({ document: "follow_up", text: mixed }), onApplication());

      expect(result).toMatchObject({ ok: false, error: "refused", reason: expect.stringMatching(/en français/) });
    });

    it("proposes nothing when the text is the same", async () => {
      const propose = actionOf(world().sources, DRAFT_ACTIONS.rework);

      const result = await propose.run(propose.schema.parse({ document: "follow_up", text: LONG_FOLLOW_UP }), onApplication());

      expect(result).toMatchObject({ ok: true, proposes: false });
    });

    it("asks which Application when none is In view or named", async () => {
      const propose = actionOf(world().sources, DRAFT_ACTIONS.rework);

      expect(await propose.run(propose.schema.parse({ document: "follow_up", text: "Court." }), call())).toMatchObject({ ok: true, proposes: false });
    });
  });
});
