import { describe, expect, it } from "vitest";
import type { GuardrailTrigger } from "../guardrails";
import { IssuesError, type GitHubIssues } from "./github-issues";
import type { Changed, SaveDraftResult, Signalement, SignalementStatus, Signalements, TriageableSignalement } from "./index";
import { createSignalementTriage, ISSUE_LABELS, TRIAGE_KEYS } from "./triage";

/** A fictitious Candidate: never a real Signalement's text, in a test or anywhere in git. */
const MARIE = "candidate-marie";
const IDENTITY = { fullName: ["Marie Dupont"], givenName: ["Marie"], lastName: ["Dupont"], preferredName: "Marie", email: ["marie.dupont@example.fr"] };
/** Another, whose Preferred Name is neither her first nor her last name. */
const MIMI = "candidate-mimi";
const MIMI_IDENTITY = { fullName: ["Marie Dupont"], givenName: ["Marie"], lastName: ["Dupont"], preferredName: "Mimi", email: ["marie.dupont@example.fr"] };

const signalement = (more: Partial<Signalement> = {}): Signalement => ({
  id: "0b6c2f1e-1111-4111-8111-111111111111",
  type: "bug",
  message: "Bonjour, je suis Marie Dupont (marie.dupont@example.fr) : le bouton « Enregistrer » ne fait rien.",
  attachedQuestion: null,
  attachedCoachReply: null,
  context: { path: "/candidatures/0b6c2f1e-2222-4222-8222-222222222222/documents", version: "35e2ea1", browser: "Chrome 141, Mac", interfaceLanguage: "fr", textSize: "large" },
  aiNoticeShown: true,
  status: "nouveau",
  statusChangedAt: null,
  reply: "Merci Marie, nous regardons.",
  repliedAt: new Date("2026-11-25T10:00:00Z"),
  replyUpdatedAt: new Date("2026-11-25T10:00:00Z"),
  createdAt: new Date("2026-11-25T09:00:00Z"),
  ...more,
});

/** Signalements as the store holds them: `triageable` already keeps only those sent with the AI notice. */
function fakeSignalements(rows: TriageableSignalement[]) {
  const changes: { id: string; status: SignalementStatus; by?: string }[] = [];
  const links: { id: string; number: number; kind: string; by: string }[] = [];
  const drafts: { id: string; draft: unknown; by?: string }[] = [];
  const store: Pick<Signalements, "triageable" | "triageableOne" | "changeStatus" | "linkIssue" | "saveDraft"> = {
    async linkIssue(id, issue, by) {
      links.push({ id, ...issue, by });
      return rows.some((row) => row.signalement.id === id);
    },
    async saveDraft(id, draft, options = {}): Promise<SaveDraftResult | null> {
      const row = rows.find((each) => each.signalement.id === id);
      if (!row) return null;
      if (row.signalement.status === "traite") return { ok: false, refused: "already_handled" };
      const { fr, en } = draft as { fr?: string; en?: string };
      if (!fr || !en) return { ok: false, errors: [{ field: fr ? "en" : "fr", code: "required" }] };
      drafts.push({ id, draft, by: options.by });
      return { ok: true, draft: { fr, en, proposedBy: options.by ?? null, proposedAt: new Date("2026-11-26T09:00:00Z"), editedAt: null, forCandidate: fr } };
    },
    async triageable({ statuses } = {}) {
      return rows.filter((row) => !statuses || statuses.includes(row.signalement.status));
    },
    async triageableOne(id) {
      return rows.find((row) => row.signalement.id === id) ?? null;
    },
    async changeStatus(id, status, _within, by): Promise<Changed | null> {
      const row = rows.find((each) => each.signalement.id === id);
      if (!row) return null;
      changes.push({ id, status, by });
      const before = row.signalement;
      row.signalement = { ...before, status };
      return { before, after: row.signalement };
    },
  };
  return { store, changes, links, drafts };
}

/** GitHub as Jobbbox writes to it: each issue opened or comment written, or the failure asked for. */
function fakeGitHub(failure?: IssuesError) {
  const written: { kind: "opened" | "commented"; number?: number; title?: string; body: string; labels?: readonly string[] }[] = [];
  const issues: Pick<GitHubIssues, "open" | "comment"> = {
    async open(issue) {
      if (failure) throw failure;
      written.push({ kind: "opened", ...issue });
      return { number: 1201, url: "https://github.com/fnconsult/jobhub/issues/1201" };
    },
    async comment(number, body) {
      if (failure) throw failure;
      written.push({ kind: "commented", number, body });
      return { number, url: `https://github.com/fnconsult/jobhub/issues/${number}#issuecomment-9` };
    },
  };
  return { issues, written };
}

const triageOf = (rows: TriageableSignalement[], failure?: IssuesError) => {
  const { store, changes, links, drafts } = fakeSignalements(rows);
  const github = fakeGitHub(failure);
  const triggers: GuardrailTrigger[] = [];
  const triage = createSignalementTriage({
    signalements: store,
    identityOf: async (id) => (id === MARIE ? IDENTITY : id === MIMI ? MIMI_IDENTITY : null),
    environment: "staging",
    issues: github.issues,
    triggers: { record: (trigger) => void triggers.push(trigger) },
    now: () => new Date("2026-11-26T09:00:00Z"),
  });
  return { triage, changes, links, drafts, written: github.written, triggers };
};

describe("Signalement triage's queue (#1139, ADR-0118): what an Agent Key reads", () => {
  it("gives each Signalement with exactly the keys planned: type, message, date, status, its context and a Question's copy", async () => {
    const { triage } = triageOf([{ candidateId: MARIE, signalement: signalement() }]);

    const [item] = await triage.queue();

    expect(Object.keys(item!)).toEqual([...TRIAGE_KEYS]);
    expect(Object.keys(item!)).toEqual([
      "id",
      "type",
      "message",
      "sentAt",
      "status",
      "environment",
      "version",
      "device",
      "interfaceLanguage",
      "textSize",
      "path",
      "attachedQuestion",
      "attachedCoachReply",
    ]);
    expect(item).toMatchObject({ id: "0b6c2f1e-1111-4111-8111-111111111111", type: "bug", sentAt: "2026-11-25T09:00:00.000Z", status: "nouveau", environment: "staging", version: "35e2ea1", device: "Chrome 141, Mac", interfaceLanguage: "fr", textSize: "large" });
    expect(Object.keys((await triage.one(item!.id))!)).toEqual([...TRIAGE_KEYS]);
  });

  it("redacts every text: the Candidate's name and email come out as « [NOM] » and « [E-MAIL] », their first name too", async () => {
    const question = signalement({
      type: "question",
      message: "Marie Dupont ici, l'aide ne m'a pas dit comment changer mon offre.",
      attachedQuestion: "Je suis Marie, comment passer à l'offre Standard ? Écrivez-moi à marie.dupont@example.fr",
      attachedCoachReply: "Bonjour Marie, je ne trouve pas d'article sur ce point. Appelez le 06 12 34 56 78.",
    });
    const { triage } = triageOf([{ candidateId: MARIE, signalement: signalement() }, { candidateId: MARIE, signalement: { ...question, id: "0b6c2f1e-3333-4333-8333-333333333333" } }]);

    const [bug, asked] = await triage.queue();

    expect(bug!.message).toBe("Bonjour, je suis [NOM] ([E-MAIL]) : le bouton « Enregistrer » ne fait rien.");
    expect(asked!.message).toBe("[NOM] ici, l'aide ne m'a pas dit comment changer mon offre.");
    expect(asked!.attachedQuestion).toBe("Je suis [PRÉNOM], comment passer à l'offre Standard ? Écrivez-moi à [E-MAIL]");
    expect(asked!.attachedCoachReply).toBe("Bonjour [PRÉNOM], je ne trouve pas d'article sur ce point. Appelez le [TÉLÉPHONE].");
    expect(JSON.stringify(await triage.queue())).not.toMatch(/Marie|Dupont|marie\.dupont|06 12/);
  });

  it("redacts the Preferred Name too, one that is neither the first nor the last name", async () => {
    const { triage } = triageOf([{ candidateId: MIMI, signalement: signalement({ message: "Je suis Mimi Dupont, dites Mimi. Marie sur mon CV." }) }]);

    const [item] = await triage.queue();

    expect(item!.message).not.toMatch(/Mimi|Marie|Dupont/);
    expect(item!.message).toBe("Je suis [PRÉNOM] [NOM DE FAMILLE], dites [PRÉNOM]. [PRÉNOM 2] sur mon CV.");
  });

  it("gives the page's path with each id replaced by its type, never an id", async () => {
    const { triage } = triageOf([{ candidateId: MARIE, signalement: signalement() }]);

    expect((await triage.queue())[0]!.path).toBe("/candidatures/:id/documents");
    expect(JSON.stringify(await triage.queue())).not.toContain("0b6c2f1e-2222");
  });

  it("never gives the Candidate's email, name, Plan or id, the team's reply, nor any object of theirs", async () => {
    const { triage } = triageOf([{ candidateId: MARIE, signalement: signalement() }]);

    const given = JSON.stringify(await triage.queue());

    expect(given).not.toContain(MARIE);
    expect(given).not.toMatch(/"(candidate\w*|plan|email|reply)"|Merci Marie/i);
  });

  it("filters the queue by status", async () => {
    const seen = signalement({ id: "0b6c2f1e-4444-4444-8444-444444444444", status: "vu" });
    const { triage } = triageOf([{ candidateId: MARIE, signalement: signalement() }, { candidateId: MARIE, signalement: seen }]);

    expect((await triage.queue({ statuses: ["vu"] })).map((each) => each.id)).toEqual([seen.id]);
  });

  it("finds none it may not read", async () => {
    const { triage } = triageOf([]);

    expect(await triage.one("0b6c2f1e-1111-4111-8111-111111111111")).toBeNull();
  });
});

describe("Signalement triage marks « vu » (#1139)", () => {
  it("sets « vu », signed key:<name>, and only « vu »", async () => {
    const { triage, changes } = triageOf([{ candidateId: MARIE, signalement: signalement() }]);

    const done = await triage.markSeen("0b6c2f1e-1111-4111-8111-111111111111", "triage-beta");

    expect(done).toMatchObject({ ok: true, signalement: { status: "vu" } });
    expect(changes).toEqual([{ id: "0b6c2f1e-1111-4111-8111-111111111111", status: "vu", by: "key:triage-beta" }]);
  });

  it("changes nothing on one already « vu », refuses one « traité », and finds none it may not read", async () => {
    const { triage, changes } = triageOf([
      { candidateId: MARIE, signalement: signalement({ status: "vu" }) },
      { candidateId: MARIE, signalement: signalement({ id: "0b6c2f1e-5555-4555-8555-555555555555", status: "traite" }) },
    ]);

    expect(await triage.markSeen("0b6c2f1e-1111-4111-8111-111111111111", "triage-beta")).toMatchObject({ ok: true, signalement: { status: "vu" } });
    expect(await triage.markSeen("0b6c2f1e-5555-4555-8555-555555555555", "triage-beta")).toEqual({ ok: false, error: "already_handled" });
    expect(await triage.markSeen("0b6c2f1e-9999-4999-8999-999999999999", "triage-beta")).toEqual({ ok: false, error: "not_found" });
    expect(changes).toEqual([]);
  });
});

/** The issue an agent proposes for the fixture Bug, in its own words. */
const PROPOSED = {
  title: "Lettre de motivation : « Enregistrer » sans effet",
  summary: "Sur la page des documents d'une candidature, le bouton « Enregistrer » d'une lettre de motivation reste sans effet.",
  steps: "1. Ouvrir /candidatures/:id/documents.\n2. Modifier la lettre.\n3. Cliquer sur « Enregistrer ».",
  expected: "La lettre est enregistrée.",
  environment: "Beta",
  version: "35e2ea1",
  device: "Chrome 141, Mac",
};
const ID = "0b6c2f1e-1111-4111-8111-111111111111";

describe("Signalement triage proposes an issue, which Jobbbox publishes (#1141, ADR-0118)", () => {
  it("publishes a clean issue on GitHub, labelled needs-triage and signalement, the Signalement's id in its body, and links it", async () => {
    const { triage, written, links, triggers } = triageOf([{ candidateId: MARIE, signalement: signalement() }]);

    const done = await triage.proposeIssue(ID, "triage-beta", PROPOSED);

    expect(done).toEqual({ ok: true, issue: { number: 1201, url: "https://github.com/fnconsult/jobhub/issues/1201", kind: "opened" } });
    expect(ISSUE_LABELS).toEqual(["needs-triage", "signalement"]);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ kind: "opened", title: PROPOSED.title, labels: ["needs-triage", "signalement"] });
    for (const part of [PROPOSED.summary, PROPOSED.steps, PROPOSED.expected, "Beta", "35e2ea1", "Chrome 141, Mac", `Signalement \`${ID}\``]) expect(written[0]!.body).toContain(part);
    expect(links).toEqual([{ id: ID, number: 1201, kind: "opened", by: "key:triage-beta" }]);
    expect(triggers).toEqual([]);
  });

  it("comments on the issue that already covers it, with the new Signalement's id, instead of opening one", async () => {
    const { triage, written, links } = triageOf([{ candidateId: MARIE, signalement: signalement() }]);

    const done = await triage.proposeIssue(ID, "triage-beta", { commentOn: 1188 });

    expect(done).toEqual({ ok: true, issue: { number: 1188, url: "https://github.com/fnconsult/jobhub/issues/1188#issuecomment-9", kind: "commented" } });
    expect(written).toEqual([{ kind: "commented", number: 1188, body: expect.stringContaining(`Signalement \`${ID}\``) }]);
    expect(written[0]!.body).toContain("Chrome 141, Mac");
    expect(links).toEqual([{ id: ID, number: 1188, kind: "commented", by: "key:triage-beta" }]);
  });

  it("blocks a text with the Candidate's data, says why (422), publishes nothing and records the Guardrail Trigger", async () => {
    const { triage, written, links, triggers } = triageOf([{ candidateId: MARIE, signalement: signalement() }]);

    const naming = await triage.proposeIssue(ID, "triage-beta", { ...PROPOSED, summary: "Marie Dupont ne peut pas enregistrer sa lettre." });
    const quoting = await triage.proposeIssue(ID, "triage-beta", { ...PROPOSED, steps: "Le bouton « Enregistrer » ne fait rien, selon le message." });
    const contact = await triage.proposeIssue(ID, "triage-beta", { commentOn: 1188, summary: "Joindre marie.dupont@example.fr" });

    expect(naming).toEqual({ ok: false, error: "blocked", guardrail: "candidate_data_in_issue", reasons: ["identity"], fields: ["summary"] });
    expect(quoting).toMatchObject({ ok: false, error: "blocked", reasons: ["verbatim_quote"], fields: ["steps"] });
    expect(contact).toMatchObject({ ok: false, error: "blocked", reasons: ["email"], fields: ["summary"] });
    expect(written).toEqual([]);
    expect(links).toEqual([]);
    expect(triggers).toEqual([1, 2, 3].map(() => ({ guardrail: "candidate_data_in_issue", setting: "block", action: "blocked", agent: "signalement_triage", at: new Date("2026-11-26T09:00:00Z") })));
  });

  it("refuses a text missing its title or summary, too long, or a duplicate's number that is not one", async () => {
    const { triage, written } = triageOf([{ candidateId: MARIE, signalement: signalement() }]);

    expect(await triage.proposeIssue(ID, "triage-beta", { ...PROPOSED, title: " ", summary: undefined })).toEqual({
      ok: false,
      error: "invalid",
      errors: [
        { field: "title", code: "required" },
        { field: "summary", code: "required" },
      ],
    });
    expect(await triage.proposeIssue(ID, "triage-beta", { ...PROPOSED, title: "x".repeat(201) })).toMatchObject({ ok: false, errors: [{ field: "title", code: "too_long" }] });
    expect(await triage.proposeIssue(ID, "triage-beta", { commentOn: "1188" })).toMatchObject({ ok: false, errors: [{ field: "commentOn", code: "invalid" }] });
    expect(await triage.proposeIssue(ID, "triage-beta", null)).toMatchObject({ ok: false, error: "invalid" });
    expect(written).toEqual([]);
  });

  it("finds none it may not read, and refuses one already « traité »", async () => {
    const { triage, written } = triageOf([{ candidateId: MARIE, signalement: signalement({ status: "traite" }) }]);

    expect(await triage.proposeIssue("0b6c2f1e-9999-4999-8999-999999999999", "triage-beta", PROPOSED)).toEqual({ ok: false, error: "not_found" });
    expect(await triage.proposeIssue(ID, "triage-beta", PROPOSED)).toEqual({ ok: false, error: "already_handled" });
    expect(written).toEqual([]);
  });

  it("says why GitHub was not written, and links nothing", async () => {
    for (const reason of ["missing_token", "not_found", "refused", "failed"] as const) {
      const { triage, links } = triageOf([{ candidateId: MARIE, signalement: signalement() }], new IssuesError(reason));

      expect(await triage.proposeIssue(ID, "triage-beta", PROPOSED)).toEqual({ ok: false, error: "github", reason });
      expect(links).toEqual([]);
    }
  });
});

describe("Signalement triage proposes a draft reply (#1141, ADR-0118)", () => {
  const DRAFT = { fr: "Merci, nous avons trouvé la cause.", en: "Thank you, we found the cause." };

  it("keeps it in French and English, signed by its key; never sends it", async () => {
    const { triage, drafts, changes } = triageOf([{ candidateId: MARIE, signalement: signalement() }]);

    expect(await triage.proposeDraft(ID, "triage-beta", DRAFT)).toEqual({
      ok: true,
      draft: { fr: DRAFT.fr, en: DRAFT.en, proposedBy: "key:triage-beta", proposedAt: "2026-11-26T09:00:00.000Z", forCandidate: DRAFT.fr },
    });
    expect(drafts).toEqual([{ id: ID, draft: DRAFT, by: "key:triage-beta" }]);
    expect(changes).toEqual([]);
  });

  it("refuses one missing a language, one on a Signalement « traité », and finds none it may not read", async () => {
    const { triage } = triageOf([
      { candidateId: MARIE, signalement: signalement() },
      { candidateId: MARIE, signalement: signalement({ id: "0b6c2f1e-5555-4555-8555-555555555555", status: "traite" }) },
    ]);

    expect(await triage.proposeDraft(ID, "triage-beta", { fr: "Merci." })).toEqual({ ok: false, error: "invalid", errors: [{ field: "en", code: "required" }] });
    expect(await triage.proposeDraft("0b6c2f1e-5555-4555-8555-555555555555", "triage-beta", DRAFT)).toEqual({ ok: false, error: "already_handled" });
    expect(await triage.proposeDraft("0b6c2f1e-9999-4999-8999-999999999999", "triage-beta", DRAFT)).toEqual({ ok: false, error: "not_found" });
  });
});
