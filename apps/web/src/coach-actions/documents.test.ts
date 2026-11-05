/**
 * The « Documents » Coach Actions (#721, ADR-0077), on in-memory domain modules scoped to their Candidate: a Tailored CV,
 * a Cover Letter or an Outreach Message proposed on an Application, each launched by the Candidate from its card through
 * the AI action its page runs (its route, its Task Playbook, its own Provenance), never written by the AI Coach itself.
 * A draft that exists is said to be replaced, edits included, and the Candidate confirms it; applied from the draft seen.
 */
import type { DocumentLanguage } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { Application } from "../applications";
import type { ApplicationTailoredCv } from "../tailored-cv";
import type { ApplicationDrafts } from "../tailored-documents";
import { DOCUMENT_ACTIONS, documentCoachActions, type DocumentActionSources } from "./documents";
import type { CoachAction, CoachActionCall, ProposalCall, ProposedChange } from "./index";
import { createCoachActions } from "./index";

const application = (id: string, profileId: string, title: string): Application =>
  ({ id, status: "applied", jobOffer: { id: `o-${id}`, title, employer: "Acme Industrie" }, profile: { id: profileId, name: "DAF" }, interviews: [] }) as unknown as Application;

const DRAFTED = new Date("2026-11-02T09:00:00Z");

/** Marie's world: an Application of her active Profile and one of her archived Profile; Paul has none. */
function world({ documentLanguage = "fr" as DocumentLanguage } = {}) {
  const applications: Record<string, Application[]> = { marie: [application("a1", "p-daf", "DAF H/F"), application("a-old", "p-old", "Contrôleuse")] };
  const tailoredCv: ApplicationTailoredCv = { documentLanguage, proposal: null, saved: null };
  const drafts: ApplicationDrafts = { documentLanguage, coverLetter: null, outreachMessage: null };
  const mine = (candidateId: string, applicationId: string) => applications[candidateId]?.find((each) => each.id === applicationId) ?? null;
  const sources: DocumentActionSources = {
    applications: { get: async (candidateId, id) => mine(candidateId, id) },
    profiles: {
      list: async (candidateId) =>
        candidateId === "marie"
          ? [
              { id: "p-daf", name: "DAF", archived: false },
              { id: "p-old", name: "Ancien", archived: true },
            ]
          : [],
    },
    tailoredCvs: { get: async (candidateId, id) => (mine(candidateId, id) ? tailoredCv : null) },
    tailoredDocuments: { get: async (candidateId, id) => (mine(candidateId, id) ? drafts : null) },
  };
  return { sources, tailoredCv, drafts };
}

const call = (candidateId = "marie", more: Partial<CoachActionCall> = {}): CoachActionCall => ({ candidateId, language: "fr", ...more });
const onApplication = (candidateId = "marie") => call(candidateId, { inView: { kind: "application", id: "a1" } });
const applied = (candidateId = "marie"): ProposalCall => ({ candidateId, cardId: "card-1", at: new Date("2026-11-05T10:00:00Z") });
const actionOf = (sources: DocumentActionSources, name: string): CoachAction => documentCoachActions(sources).find((action) => action.name === name)!;

async function proposed(action: CoachAction, args: Record<string, unknown>, at = onApplication()): Promise<ProposedChange> {
  const result = await action.run(action.schema.parse(args), at);
  if (!result.ok || result.proposes === false) throw new Error(`nothing proposed: ${JSON.stringify(result)}`);
  return result.data as ProposedChange;
}

describe("the « Documents » Coach Actions (#721)", () => {
  it("are three proposals of the Documents group, none copying text: they stay offered on an Application, whose Job Offer the AI action reads by its own rules", () => {
    const actions = documentCoachActions(world().sources);

    expect(actions.map(({ name, group, kind, copiesText }) => ({ name, group, kind, copiesText }))).toEqual([
      { name: "propose_tailored_cv", group: "documents", kind: "propose", copiesText: false },
      { name: "propose_cover_letter", group: "documents", kind: "propose", copiesText: false },
      { name: "propose_outreach_message", group: "documents", kind: "propose", copiesText: false },
    ]);
    for (const action of actions) {
      // Launched, never undone: Stop ends it.
      expect(action.apply).toBeTypeOf("function");
      expect(action.undo).toBeUndefined();
      // The AI Coach is told never to write the document in its reply.
      expect(action.description).toMatch(/jamais .*toi-même/);
    }
  });

  it("are offered with an Application In view, untrusted text: nothing narrows them", async () => {
    const actions = createCoachActions({ catalog: documentCoachActions(world().sources), settings: async () => ({ enabled: true, maxRounds: 2 }), externalApis: { record: () => {} } });
    const offered = await actions.forReply("marie", { recorder: { step: async () => undefined as never, site: () => {} }, untrustedInView: true });

    expect(offered?.tools.map((tool) => tool.name)).toEqual(Object.values(DOCUMENT_ACTIONS));
  });

  describe("propose_tailored_cv: « Préparer » runs the Tailored CV proposal, its Review opened in the Work Pane", () => {
    it("proposes it for the Application In view: the route its page runs, in its Document Language, and its Tailored CV Review to open", async () => {
      const { sources } = world();

      const change = await proposed(actionOf(sources, DOCUMENT_ACTIONS.tailoredCv), {});

      expect(change).toEqual({
        target: { kind: "application", id: "a1", name: "DAF H/F · Acme Industrie", href: "/candidatures/a1/documents?resultat=cv-adapte" },
        what: "CV adapté",
        before: "Aucun CV adapté",
        after: "Une proposition à relire changement par changement · Français",
        value: {},
        fields: [],
        version: "any",
        launches: true,
        runs: { kind: "tailored_cv", url: "/api/applications/a1/tailored-cv", body: { language: "fr" }, opens: "/candidatures/a1/documents?resultat=cv-adapte" },
      });
      // Never a replacement to confirm: the proposal never overwrites the saved Tailored CV.
      expect(change.replaces).toBeUndefined();
    });

    it("says the saved Tailored CV stays as it is, and writes in the language asked", async () => {
      const { sources, tailoredCv } = world();
      tailoredCv.saved = { language: "fr", masterCvVersion: 1, content: {} as never, matchScore: { master: 60, tailored: 70 }, savedAt: DRAFTED, provenance: null };

      const change = await proposed(actionOf(sources, DOCUMENT_ACTIONS.tailoredCv), { applicationId: "a1", language: "en" });

      expect(change.before).toBe("CV adapté enregistré le 2 novembre 2026, gardé tel quel");
      expect(change.after).toBe("Une proposition à relire changement par changement · Anglais");
      expect(change.runs?.body).toEqual({ language: "en" });
    });

    it("finds nothing for another Candidate's Application, an Archived Application, or an unknown id; asks which one when none is In view", async () => {
      const action = actionOf(world().sources, DOCUMENT_ACTIONS.tailoredCv);

      expect(await action.run({ applicationId: "a1" }, call("paul"))).toEqual({ ok: false, error: "not_found" });
      expect(await action.run({ applicationId: "a-old" }, call())).toEqual({ ok: false, error: "not_found" });
      expect(await action.run({ applicationId: "nope" }, call())).toEqual({ ok: false, error: "not_found" });
      expect(await action.run({}, call())).toMatchObject({ ok: true, proposes: false, data: { message: expect.stringMatching(/quelle candidature/) } });
    });

    it("« Préparer » is accepted while the Application is still the Candidate's, with nothing to undo; gone since, not_found", async () => {
      const { sources } = world();
      const action = actionOf(sources, DOCUMENT_ACTIONS.tailoredCv);
      const change = await proposed(action, {});

      expect(await action.apply!(change, applied())).toEqual({ ok: true });
      expect(await action.apply!(change, applied("paul"))).toEqual({ ok: false, error: "not_found" });
    });
  });

  describe("propose_cover_letter and propose_outreach_message: « Rédiger » runs the drafting", () => {
    it("proposes a Cover Letter with no draft yet: nothing to replace", async () => {
      const { sources } = world();

      const change = await proposed(actionOf(sources, DOCUMENT_ACTIONS.coverLetter), {});

      expect(change).toEqual({
        target: { kind: "application", id: "a1", name: "DAF H/F · Acme Industrie", href: "/candidatures/a1/documents?resultat=lettre" },
        what: "Lettre de motivation",
        before: "Aucun brouillon",
        after: "Un brouillon rédigé par votre coach IA · Français",
        value: {},
        fields: [],
        version: "none",
        launches: true,
        runs: { kind: "tailored_documents", url: "/api/applications/a1/tailored-documents", body: { document: "cover_letter", language: "fr" }, opens: "/candidatures/a1/documents?resultat=lettre" },
      });
    });

    it("a draft that exists: the card says it will be replaced, edits included, and asks to confirm", async () => {
      const { sources, drafts } = world();
      drafts.coverLetter = { language: "fr", text: "Madame, Monsieur…", draftedAt: DRAFTED, updatedAt: new Date("2026-11-03T15:00:00Z"), provenance: null };

      const change = await proposed(actionOf(sources, DOCUMENT_ACTIONS.coverLetter), {});

      expect(change.before).toBe("Brouillon du 2 novembre 2026, modifié depuis");
      expect(change.replaces).toBe("Votre brouillon actuel sera remplacé, vos modifications comprises.");
      expect(change.version).toBe("2026-11-03T15:00:00.000Z");
    });

    it("an Outreach Message, by email or InMail as asked, its draft said to be replaced", async () => {
      const { sources, drafts } = world();
      drafts.outreachMessage = { language: "fr", text: "Bonjour", subject: "", channel: "email", contactRoles: [], contact: null, draftedAt: DRAFTED, updatedAt: DRAFTED, provenance: null };

      const change = await proposed(actionOf(sources, DOCUMENT_ACTIONS.outreachMessage), { channel: "inmail" });

      expect(change).toMatchObject({
        what: "Message d'approche",
        before: "Brouillon du 2 novembre 2026",
        replaces: "Votre brouillon actuel sera remplacé, vos modifications comprises.",
        runs: { kind: "tailored_documents", url: "/api/applications/a1/tailored-documents", body: { document: "outreach_message", language: "fr", channel: "inmail" }, opens: "/candidatures/a1/documents?resultat=message" },
      });
    });

    it("« Rédiger » from the draft seen; a draft written or edited since is a conflict: not what the Candidate confirmed", async () => {
      const { sources, drafts } = world();
      const action = actionOf(sources, DOCUMENT_ACTIONS.coverLetter);
      const change = await proposed(action, {});

      expect(await action.apply!(change, applied())).toEqual({ ok: true });

      drafts.coverLetter = { language: "fr", text: "Une lettre écrite depuis", draftedAt: DRAFTED, updatedAt: DRAFTED, provenance: null };
      expect(await action.apply!(change, applied())).toEqual({ ok: false, error: "conflict" });
      const again = await proposed(action, {});
      expect(await action.apply!(again, applied())).toEqual({ ok: true });
      expect(await action.apply!(again, applied("paul"))).toEqual({ ok: false, error: "not_found" });
    });
  });
});
