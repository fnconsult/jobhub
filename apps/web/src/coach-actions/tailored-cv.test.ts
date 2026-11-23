/**
 * The Tailored CV reworked from the Coach Conversation (ADR-0113, #1097), on in-memory domain modules scoped to their
 * Candidate: read in full, changed section by section on a card reviewed change by change (the saved Tailored CV, or the
 * proposal under review with its answers kept), the Review's answers filled from what the Candidate declared.
 */
import type { CvContent } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { Application } from "../applications";
import type { ProposalAdaptation, RevisableTailoredCv, TailoredCvQuestion } from "../tailored-cv";
import { createCoachActions, type CoachAction, type CoachActionCall, type ProposalCall, type ProposedChange } from "./index";
import { TAILORED_CV_ACTIONS, tailoredCvCoachActions, type TailoredCvActionSources } from "./tailored-cv";

const master: CvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie@example.fr",
  phone: "",
  location: "Lyon",
  summary: "25 ans dans l'industrie.",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Pilotage financier." }],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
  skills: ["IFRS", "SAP", "SQL, utilisé pour le reporting"],
  languages: [{ name: "Anglais", level: "courant" }],
};

const application = { id: "a1", jobOffer: { title: "Lead Finance", employer: "Benchling", content: "You will drive FP&A with Anaplan and Looker." }, profile: { id: "p1" } } as unknown as Application;

/** Marie's Application a1, with a saved Tailored CV or a proposal under review; Paul has none. */
function world({ saved = true, proposal = false }: { saved?: boolean; proposal?: boolean } = {}) {
  const state: { saved: RevisableTailoredCv["saved"]; proposal: (RevisableTailoredCv["proposal"] & { questions: TailoredCvQuestion[] }) | null } = {
    saved: saved ? { content: structuredClone(master), language: "fr", version: 3, master } : null,
    proposal: proposal
      ? {
          revision: "9e107d9d372bb6826bd81d3542a419d6",
          language: "fr",
          adapted: { ...structuredClone(master), skills: ["SAP", "IFRS", "SQL, utilisé pour le reporting"] },
          origins: { experience: [0], education: [0], skills: [1, 0, 2], languages: [0] },
          master,
          questions: [
            { requirement: "Power BI", answer: null },
            { requirement: "Anaplan", answer: null },
          ],
          declared: [],
        }
      : null,
  };
  const calls: { method: string; args: unknown[] }[] = [];
  const mine = (candidateId: string, id: string) => (candidateId === "marie" && id === "a1" ? application : null);
  const sources: TailoredCvActionSources = {
    applications: { get: async (candidateId, id) => mine(candidateId, id) },
    profiles: { list: async (candidateId) => (candidateId === "marie" ? [{ id: "p1", name: "DAF", archived: false }] : []) } as TailoredCvActionSources["profiles"],
    tailoredCvs: {
      revisable: async (candidateId, id) => (mine(candidateId, id) ? structuredClone(state) : null),
      reviseSaved: async (...args) => {
        calls.push({ method: "reviseSaved", args });
        if (!state.saved || args[2].version !== state.saved.version) return { ok: false, error: "conflict" };
        state.saved = { ...state.saved, content: args[2].content, version: state.saved.version + 1 };
        return { ok: true, version: state.saved.version, before: state.saved.version - 1 };
      },
      reviseProposal: async (...args) => {
        calls.push({ method: "reviseProposal", args });
        const { revision, ...adaptation } = args[2];
        if (!state.proposal || revision !== state.proposal.revision) return { ok: false, error: "conflict" };
        const before: ProposalAdaptation = { adapted: state.proposal.adapted, origins: state.proposal.origins, declared: state.proposal.declared };
        state.proposal = { ...state.proposal, ...adaptation, revision: `${revision}x` };
        return { ok: true, revision: state.proposal.revision, before };
      },
      answerAll: async (...args) => {
        calls.push({ method: "answerAll", args });
        const { revision, answers } = args[2];
        if (!state.proposal || revision !== state.proposal.revision) return { ok: false, error: "conflict" };
        const before = state.proposal.questions.filter((question) => answers.some((answer) => answer.requirement === question.requirement));
        state.proposal = {
          ...state.proposal,
          revision: `${revision}a`,
          questions: state.proposal.questions.map((question) => answers.find((answer) => answer.requirement === question.requirement) ?? question),
        };
        return { ok: true, revision: state.proposal.revision, before };
      },
    },
    tailoredDocumentVersions: {
      restore: async (...args) => {
        calls.push({ method: "restore", args });
        return { ok: true, version: 5, before: 4 };
      },
    },
  };
  return { sources, state, calls };
}

const call = (more: Partial<CoachActionCall> = {}): CoachActionCall => ({ candidateId: "marie", language: "fr", inView: { kind: "application", id: "a1" }, ...more });
const applied = (accepted?: string[]): ProposalCall => ({ candidateId: "marie", cardId: "card-1", at: new Date("2026-11-23T10:00:00Z"), ...(accepted ? { accepted } : {}) });
const actionOf = (sources: TailoredCvActionSources, name: string): CoachAction => tailoredCvCoachActions(sources).find((action) => action.name === name)!;

async function proposed(action: CoachAction, args: Record<string, unknown>, at = call()): Promise<ProposedChange> {
  const result = await action.run(action.schema.parse(args), at);
  if (!result.ok || result.proposes === false) throw new Error(`nothing proposed: ${JSON.stringify(result)}`);
  return result.data as ProposedChange;
}

describe("the Tailored CV reworked from the Coach Conversation (ADR-0113, #1097)", () => {
  it("is a read and two proposals of the Documents group, the proposals offered with an Application In view (reviewed by the Candidate)", async () => {
    const actions = tailoredCvCoachActions(world().sources);
    expect(actions.map(({ name, group, kind }) => ({ name, group, kind }))).toEqual([
      { name: "read_tailored_cv", group: "documents", kind: "read" },
      { name: "propose_tailored_cv_changes", group: "documents", kind: "propose" },
      { name: "propose_tailored_cv_answers", group: "documents", kind: "propose" },
    ]);
    const offered = await createCoachActions({ catalog: actions, settings: async () => ({ enabled: true, maxRounds: 2 }), externalApis: { record: () => {} } }).forReply("marie", {
      recorder: { step: async (_step, run) => (run as () => Promise<unknown>)() as never, site: () => {} },
      untrustedInView: true,
    });
    expect(offered?.tools.map((tool) => tool.name)).toEqual([...Object.values(TAILORED_CV_ACTIONS), "redirect"]);
  });

  describe("read_tailored_cv", () => {
    it("gives the whole Tailored CV, section by section, and the open questions of a proposal under review: untrusted", async () => {
      const { sources } = world({ proposal: true });
      const action = actionOf(sources, TAILORED_CV_ACTIONS.read);
      const result = await action.run(action.schema.parse({}), call({ maxTokens: 1_500 }));
      if (!result.ok) throw new Error("not read");
      expect(result.untrusted).toBe(true);
      expect(result.pages).toEqual(["/candidatures/a1/documents?resultat=cv-adapte"]);
      const text = String(result.data);
      for (const line of ["CV adapté enregistré (version 3)", "Titre : Directrice financière", "Compétences :", "- SQL, utilisé pour le reporting", "Langues :", "- Anglais · courant", "Formation :", "Proposition en relecture", "Questions ouvertes", "- Power BI : sans réponse"]) {
        expect(text).toContain(line);
      }
      expect(text).toContain("<cv-adapte>");
      // The identity block stays out.
      expect(text).not.toContain("marie@example.fr");
    });

    it("says when there is no Tailored CV, and is not_found for another Candidate", async () => {
      const { sources } = world({ saved: false });
      const action = actionOf(sources, TAILORED_CV_ACTIONS.read);
      expect(await action.run(action.schema.parse({}), call())).toMatchObject({ ok: true, data: expect.stringContaining("propose_tailored_cv") });
      expect(await action.run(action.schema.parse({ applicationId: "a1" }), call({ candidateId: "paul" }))).toEqual({ ok: false, error: "not_found" });
    });
  });

  describe("propose_tailored_cv_changes", () => {
    it("« reformulate the skills as a list »: a Layout-only Change on the saved Tailored CV, reviewed in the Work Pane, saved as its next version", async () => {
      const { sources, state, calls } = world();
      const action = actionOf(sources, TAILORED_CV_ACTIONS.changes);
      const change = await proposed(action, { changes: [{ kind: "rephrase", section: "skills", item: "SQL, utilisé pour le reporting", text: "SQL" }] });

      expect(change).toMatchObject({
        target: { kind: "application", id: "a1", name: "Lead Finance · Benchling", href: "/candidatures/a1/documents?resultat=cv-adapte" },
        what: "CV adapté",
        before: "Version 3 enregistrée",
        after: "1 changement à relire",
        value: { base: "saved" },
        version: "3",
        layoutOnly: true,
        review: { changes: [{ id: "skills.rephrased.2", kind: "rephrased", master: "SQL, utilisé pour le reporting", tailored: "SQL" }] },
      });

      // Never applied without the changes accepted, sent explicitly.
      expect(await action.apply!(change, applied())).toEqual({ ok: false, error: "invalid", errors: [{ field: "accepted", code: "required" }] });
      const done = await action.apply!(change, applied(["skills.rephrased.2"]));
      expect(done).toEqual({ ok: true, undo: { applicationId: "a1", base: "saved", before: 3, version: 4 } });
      expect(state.saved?.content.skills).toEqual(["IFRS", "SAP", "SQL"]);
      expect(calls[0]).toMatchObject({ method: "reviseSaved", args: ["marie", "a1", { version: 3 }, { origin: { origin: "coach_proposal", cardId: "card-1" } }] });

      // Changed since: a conflict, never merged.
      expect(await action.apply!(change, applied(["skills.rephrased.2"]))).toEqual({ ok: false, error: "conflict" });

      // « Annuler »: a Restore of the version before, while it is still the current one.
      expect(await action.undo!({ applicationId: "a1", base: "saved", before: 3, version: 4 }, applied())).toEqual({ ok: true });
      expect(calls.at(-1)).toMatchObject({ method: "restore", args: ["marie", "a1", { document: "tailored_cv", version: 3 }, { current: 4 }] });
    });

    it("applies to the proposal under review, its answers kept, never relaunched; « Annuler » puts its adaptation back", async () => {
      const { sources, state, calls } = world({ saved: false, proposal: true });
      const action = actionOf(sources, TAILORED_CV_ACTIONS.changes);
      const change = await proposed(action, { changes: [{ kind: "cut", section: "skills", item: "SAP" }] });
      expect(change).toMatchObject({ before: "Proposition en relecture", value: { base: "proposal" }, version: "9e107d9d372bb682", layoutOnly: true });

      const done = await action.apply!(change, applied(["skills.cut.0"]));
      if (!done.ok) throw new Error("not applied");
      expect(state.proposal?.adapted.skills).toEqual(["IFRS", "SQL, utilisé pour le reporting"]);
      // Where each item comes from in the Master CV, through the proposal's own.
      expect(state.proposal?.origins?.skills).toEqual([0, 2]);
      expect(state.proposal?.questions.map((question) => question.requirement)).toEqual(["Power BI", "Anaplan"]);

      expect(await action.undo!(done.undo, applied())).toEqual({ ok: true });
      expect(calls.at(-1)).toMatchObject({ method: "reviseProposal", args: ["marie", "a1", { revision: "9e107d9d372bb6826bd81d3542a419d6x", adapted: { skills: ["SAP", "IFRS", "SQL, utilisé pour le reporting"] } }] });
    });

    it("« ajoute Power BI »: added when the Candidate declared it, marked; refused not_declared with the Master CV's skills section otherwise", async () => {
      const { sources, state } = world();
      const action = actionOf(sources, TAILORED_CV_ACTIONS.changes);
      const declared = await proposed(action, { changes: [{ kind: "add", section: "skills", text: "Power BI" }] }, call({ said: ["Ajoute Power BI, je l'utilise depuis 3 ans."] }));
      expect(declared.layoutOnly).toBeUndefined();
      expect(declared.review?.changes).toEqual([{ id: "skills.added.Power BI", section: "skills", kind: "added", item: "Power BI", declared: true }]);
      expect(await action.apply!(declared, applied(["skills.added.Power BI"]))).toMatchObject({ ok: true });
      expect(state.saved?.content.skills).toEqual([...master.skills, "Power BI"]);

      // Said by the Job Offer or the AI Coach, never by the Candidate: refused, the Candidate sent to their Master CV's section.
      expect(await action.run(action.schema.parse({ changes: [{ kind: "add", section: "skills", text: "Anaplan" }] }), call({ said: ["Ajoute les compétences de l'offre."] }))).toEqual({
        ok: false,
        error: "refused",
        reason: expect.stringContaining("not_declared"),
        redirect: { target: "master_cv_section", section: "skills" },
      });
    });

    it("marks a change bringing words of the Job Offer « Reprend les mots de l'offre », for an explicit accept", async () => {
      const { sources } = world();
      const change = await proposed(actionOf(sources, TAILORED_CV_ACTIONS.changes), { changes: [{ kind: "rephrase", section: "summary", text: "25 ans dans l'industrie, pilotage FP&A sous Anaplan." }] });
      expect(change.review?.changes[0]).toMatchObject({ id: "summary.rephrased", fromOffer: ["Anaplan"] });
      expect(change.layoutOnly).toBeUndefined();
    });

    it("says there is nothing to rework without a Tailored CV, and is not_found for another Candidate", async () => {
      const { sources } = world({ saved: false });
      const action = actionOf(sources, TAILORED_CV_ACTIONS.changes);
      expect(await action.run(action.schema.parse({ changes: [{ kind: "cut", section: "skills", item: "SAP" }] }), call())).toMatchObject({ ok: true, proposes: false });
      expect(await action.run(action.schema.parse({ applicationId: "a1", changes: [{ kind: "cut", section: "skills", item: "SAP" }] }), call({ candidateId: "paul" }))).toEqual({ ok: false, error: "not_found" });
    });
  });

  describe("propose_tailored_cv_answers", () => {
    it("fills the Review's answers the Candidate declared in the conversation, on a card « Réponses aux questions »; « Annuler » puts them back", async () => {
      const { sources, state, calls } = world({ saved: false, proposal: true });
      const action = actionOf(sources, TAILORED_CV_ACTIONS.answers);
      const said = ["Oui, j'utilise Power BI tous les jours, mais je n'ai jamais touché à Anaplan."];
      const change = await proposed(action, { answers: [{ requirement: "power bi", confirmed: true }, { requirement: "Anaplan", confirmed: false }] }, call({ said }));
      expect(change).toMatchObject({
        what: "Réponses aux questions",
        before: "Power BI : sans réponse · Anaplan : sans réponse",
        after: "Power BI : oui · Anaplan : non",
        value: { "Power BI": "confirmed", Anaplan: "declined" },
        version: "9e107d9d372bb682",
      });

      const done = await action.apply!(change, applied());
      expect(state.proposal?.questions).toEqual([
        { requirement: "Power BI", answer: "confirmed" },
        { requirement: "Anaplan", answer: "declined" },
      ]);
      if (!done.ok) throw new Error("not applied");
      expect(await action.undo!(done.undo, applied())).toEqual({ ok: true });
      expect(calls.at(-1)).toMatchObject({ method: "answerAll", args: ["marie", "a1", { answers: [{ requirement: "Power BI", answer: null }, { requirement: "Anaplan", answer: null }] }] });
    });

    it("never answers what the Candidate did not say, nor a question the proposal does not ask", async () => {
      const { sources } = world({ saved: false, proposal: true });
      const action = actionOf(sources, TAILORED_CV_ACTIONS.answers);
      expect(await action.run(action.schema.parse({ answers: [{ requirement: "Power BI", confirmed: true }] }), call({ said: ["Oui."] }))).toMatchObject({ ok: false, error: "refused", reason: expect.stringContaining("not_declared") });
      expect(await action.run(action.schema.parse({ answers: [{ requirement: "Kyriba", confirmed: true }] }), call({ said: ["Kyriba, oui"] }))).toMatchObject({ ok: false, error: "refused", reason: expect.stringContaining("Power BI, Anaplan") });
    });
  });
});
