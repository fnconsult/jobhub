/**
 * The Document Version Coach Actions (#1079): asked « montre-moi les versions de ma lettre », the AI Coach lists the
 * versions kept, reads the one asked for, and proposes to restore it as an Action Card; it never restores one itself.
 * On in-memory domain modules scoped to their Candidate.
 */
import { describe, expect, it } from "vitest";
import type { Application } from "../applications";
import type { DocumentVersions, RestoreOptions, TailoredDocumentVersion } from "../tailored-documents/versions";
import { createCoachActions, type CoachAction, type CoachActionCall, type ProposalCall, type ProposedChange } from "./index";
import { DOCUMENT_VERSION_ACTIONS, documentVersionCoachActions, type DocumentVersionActionSources } from "./versions";

const application = (id: string, profileId: string): Application =>
  ({ id, status: "applied", jobOffer: { id: `o-${id}`, title: "Consultante achats de transition", employer: "Exemple Conseil" }, profile: { id: profileId, name: "Achats" }, interviews: [] }) as unknown as Application;

const letter = (version: number, more: Partial<TailoredDocumentVersion> = {}): TailoredDocumentVersion => ({
  version,
  savedAt: new Date(`2026-11-18T0${version}:30:00Z`),
  source: "drafted",
  restoredFrom: null,
  current: false,
  language: "fr",
  subject: null,
  text: `Madame, Monsieur, lettre ${version}.`,
  cv: null,
  provenance: null,
  ...more,
});

/** Marie's world: an Application whose Cover Letter has two versions (the second hers, current), and an archived one. */
function world() {
  const applications: Record<string, Application[]> = { marie: [application("a1", "p1"), application("a-old", "p-old")] };
  const mine = (candidateId: string, applicationId: string) => applications[candidateId]?.find((each) => each.id === applicationId) ?? null;
  let versions: DocumentVersions = {
    tailored_cv: [],
    cover_letter: [letter(2, { source: "candidate", current: true, text: "Ma lettre, retouchée par moi." }), letter(1)],
    outreach_message: [],
  };
  const restores: { input: unknown; options: RestoreOptions | undefined }[] = [];
  const sources: DocumentVersionActionSources = {
    applications: { get: async (candidateId, id) => mine(candidateId, id) },
    profiles: {
      list: async (candidateId) => (candidateId === "marie" ? [{ id: "p1", name: "Achats", archived: false }, { id: "p-old", name: "Ancien", archived: true }] : []) as never,
    },
    tailoredDocumentVersions: {
      list: async (candidateId, id) => (mine(candidateId, id) ? versions : null),
      restore: async (_candidateId, _applicationId, input, options) => {
        restores.push({ input, options });
        const current = versions.cover_letter[0]!.version;
        if (options?.current !== undefined && options.current !== current) return { ok: false, error: "conflict" };
        const restored = letter(current + 1, { source: "restored", restoredFrom: (input as { version: number }).version, current: true });
        versions = { ...versions, cover_letter: [restored, ...versions.cover_letter.map((each) => ({ ...each, current: false }))] };
        return { ok: true, version: restored.version, before: current };
      },
    },
  };
  return { sources, restores };
}

const call = (candidateId = "marie", more: Partial<CoachActionCall> = {}): CoachActionCall => ({ candidateId, language: "fr", ...more });
const onApplication = (candidateId = "marie") => call(candidateId, { inView: { kind: "application", id: "a1" } });
const applied: ProposalCall = { candidateId: "marie", cardId: "card-1", at: new Date("2026-11-18T13:50:00Z") };
const actionOf = (sources: DocumentVersionActionSources, name: string): CoachAction => documentVersionCoachActions(sources).find((action) => action.name === name)!;

async function proposed(action: CoachAction, args: Record<string, unknown>): Promise<ProposedChange> {
  const result = await action.run(action.schema.parse(args), onApplication());
  if (!result.ok || result.proposes === false) throw new Error(`nothing proposed: ${JSON.stringify(result)}`);
  return result.data as ProposedChange;
}

describe("the Document Version Coach Actions (#1079)", () => {
  it("are a read and a proposal of the Documents group, neither copying text the AI Coach wrote", () => {
    expect(documentVersionCoachActions(world().sources).map(({ name, group, kind, copiesText }) => ({ name, group, kind, copiesText }))).toEqual([
      { name: "read_document_versions", group: "documents", kind: "read", copiesText: false },
      { name: "propose_document_restore", group: "documents", kind: "propose", copiesText: false },
    ]);
  });

  it("stay offered with an Application In view, where the Candidate asks for their versions", async () => {
    const actions = createCoachActions({ catalog: documentVersionCoachActions(world().sources), settings: async () => ({ enabled: true, maxRounds: 2 }), externalApis: { record: () => {} } });
    const offered = await actions.forReply("marie", { recorder: { step: async () => undefined as never, site: () => {} }, untrustedInView: true });

    expect(offered?.tools.map((tool) => tool.name)).toEqual(Object.values(DOCUMENT_VERSION_ACTIONS));
  });

  describe("read_document_versions", () => {
    it("lists each version, newest first, with its date in Paris, origin and language, the current one said, and where they are", async () => {
      const read = actionOf(world().sources, DOCUMENT_VERSION_ACTIONS.read);

      const result = await read.run(read.schema.parse({ document: "cover_letter" }), onApplication());

      expect(result).toMatchObject({ ok: true, pages: ["/candidatures/a1/documents?resultat=lettre"] });
      const said = String(result.ok && result.data);
      expect(said).toContain("Version 2 (actuelle) · 18 novembre 2026 à 03:30 · modifiée par le candidat · en français");
      expect(said).toContain("Version 1 · 18 novembre 2026 à 02:30 · rédigée par le coach IA · en français");
      expect(said.indexOf("Version 2")).toBeLessThan(said.indexOf("Version 1"));
      expect(said).toMatch(/Documents › Lettre de motivation, sous « Versions » ; Jobbbox en garde les 20 dernières/);
      // The list names no text: nothing written from the Job Offer.
      expect(said).not.toContain("Madame, Monsieur");
    });

    it("reads one version's text, as data written from the Job Offer", async () => {
      const read = actionOf(world().sources, DOCUMENT_VERSION_ACTIONS.read);

      const result = await read.run(read.schema.parse({ document: "cover_letter", version: 1 }), onApplication());

      expect(result).toMatchObject({ ok: true, untrusted: true });
      expect(String(result.ok && result.data)).toMatch(/<version>[\s\S]*Madame, Monsieur, lettre 1\.[\s\S]*<\/version>/);
    });

    it("says which versions there are when the one asked for is not kept, and that a document not written yet has none", async () => {
      const read = actionOf(world().sources, DOCUMENT_VERSION_ACTIONS.read);

      const missing = await read.run(read.schema.parse({ document: "cover_letter", version: 7 }), onApplication());
      expect(missing.ok && missing.data).toBe("La lettre de motivation n'a pas de version 7. Ses versions : 2, 1.");
      const none = await read.run(read.schema.parse({ document: "outreach_message" }), onApplication());
      expect(none.ok && none.data).toMatch(/pas encore de message d'approche.*propose_outreach_message/);
    });

    it("finds no one else's Application, nor an Archived one", async () => {
      const read = actionOf(world().sources, DOCUMENT_VERSION_ACTIONS.read);

      expect(await read.run(read.schema.parse({ document: "cover_letter", applicationId: "a1" }), call("paul"))).toEqual({ ok: false, error: "not_found" });
      expect(await read.run(read.schema.parse({ document: "cover_letter", applicationId: "a-old" }), call())).toEqual({ ok: false, error: "not_found" });
    });
  });

  describe("propose_document_restore", () => {
    it("proposes to bring an earlier version back: the current text before, that version's after, nothing to edit, from the current version seen", async () => {
      const { sources, restores } = world();
      const change = await proposed(actionOf(sources, DOCUMENT_VERSION_ACTIONS.restore), { document: "cover_letter", version: 1 });

      expect(change).toMatchObject({
        target: { kind: "application", id: "a1", href: "/candidatures/a1/documents?resultat=lettre" },
        what: "Lettre de motivation : remettre la version 1",
        before: "Ma lettre, retouchée par moi.",
        after: "Madame, Monsieur, lettre 1.",
        value: { document: "cover_letter", version: "1" },
        fields: [],
        version: "2",
      });
      // Proposing restores nothing.
      expect(restores).toEqual([]);
    });

    it("proposes nothing for the current version, nor one not kept", async () => {
      const propose = actionOf(world().sources, DOCUMENT_VERSION_ACTIONS.restore);

      expect(await propose.run(propose.schema.parse({ document: "cover_letter", version: 2 }), onApplication())).toMatchObject({ ok: true, proposes: false, data: { message: expect.stringMatching(/déjà la version actuelle/) } });
      expect(await propose.run(propose.schema.parse({ document: "cover_letter", version: 9 }), onApplication())).toMatchObject({ ok: true, proposes: false });
      expect(await propose.run(propose.schema.parse({ document: "outreach_message", version: 1 }), onApplication())).toMatchObject({ ok: true, proposes: false });
    });

    it("« Appliquer » restores it as a new version from the version seen, keeping the card as its Origin; « Annuler » restores the one before", async () => {
      const { sources, restores } = world();
      const propose = actionOf(sources, DOCUMENT_VERSION_ACTIONS.restore);
      const change = await proposed(propose, { document: "cover_letter", version: 1 });

      const done = await propose.apply!(change, applied);

      expect(done).toEqual({ ok: true, undo: { applicationId: "a1", document: "cover_letter", before: 2, restored: 3 } });
      expect(restores[0]).toEqual({ input: { document: "cover_letter", version: 1 }, options: { current: 2, origin: { origin: "coach_proposal", cardId: "card-1", appliedAt: applied.at } } });

      expect(await propose.undo!(done.ok && done.undo, { candidateId: "marie" } as never)).toEqual({ ok: true });
      expect(restores[1]).toEqual({ input: { document: "cover_letter", version: 2 }, options: { current: 3 } });
    });

    it("a document changed since the card is a conflict: nothing is restored", async () => {
      const { sources } = world();
      const propose = actionOf(sources, DOCUMENT_VERSION_ACTIONS.restore);
      const change = await proposed(propose, { document: "cover_letter", version: 1 });

      expect(await propose.apply!({ ...change, version: "1" }, applied)).toEqual({ ok: false, error: "conflict" });
    });
  });
});
