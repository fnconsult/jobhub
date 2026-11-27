import { describe, expect, it } from "vitest";
import type { GuardrailTrigger } from "../guardrails";
import { IssuesError, type GitHubIssues } from "./github-issues";
import type { Changed, SaveDraftResult, Signalement, SignalementStatus, Signalements, TriageableSignalement, TriageMissingReason } from "./index";
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

/** A Signalement triage may read, as the store gives it: nothing done by triage yet, unless `more` says so. */
const row = (candidateId: string, signalement: Signalement, more: Partial<Omit<TriageableSignalement, "candidateId" | "signalement">> = {}): TriageableSignalement => ({
  candidateId,
  signalement,
  statusChangedBy: null,
  issueNumber: null,
  draft: null,
  ...more,
});

/** Signalements as the store holds them: `triageable` already keeps only those sent with the AI notice; `missing`, why the others are not. */
function fakeSignalements(rows: TriageableSignalement[], missing: Record<string, TriageMissingReason> = {}) {
  const changes: { id: string; status: SignalementStatus; by?: string }[] = [];
  const links: { id: string; number: number; kind: string; by: string }[] = [];
  const drafts: { id: string; draft: unknown; by?: string }[] = [];
  const store: Pick<Signalements, "triageable" | "triageableOne" | "whyNotTriageable" | "changeStatus" | "linkIssue" | "saveDraft"> = {
    async linkIssue(id, issue, by) {
      links.push({ id, ...issue, by });
      const found = rows.find((each) => each.signalement.id === id);
      if (found) found.issueNumber ??= issue.number;
      return Boolean(found);
    },
    async whyNotTriageable(id) {
      return missing[id] ?? "unknown";
    },
    async saveDraft(id, draft, options = {}): Promise<SaveDraftResult | null> {
      const found = rows.find((each) => each.signalement.id === id);
      if (!found) return null;
      if (found.signalement.status === "traite") return { ok: false, refused: "already_handled" };
      const { fr, en } = draft as { fr?: string; en?: string };
      if (!fr || !en) return { ok: false, errors: [{ field: fr ? "en" : "fr", code: "required" }] };
      drafts.push({ id, draft, by: options.by });
      found.draft = { proposedBy: options.by ?? null, proposedAt: new Date("2026-11-26T09:00:00Z") };
      return { ok: true, draft: { fr, en, proposedBy: options.by ?? null, proposedAt: new Date("2026-11-26T09:00:00Z"), editedAt: null, forCandidate: fr } };
    },
    async triageable({ statuses } = {}) {
      return rows.filter((each) => !statuses || statuses.includes(each.signalement.status));
    },
    async triageableOne(id) {
      return rows.find((each) => each.signalement.id === id) ?? null;
    },
    async changeStatus(id, status, _within, by): Promise<Changed | null> {
      const found = rows.find((each) => each.signalement.id === id);
      if (!found) return null;
      changes.push({ id, status, by });
      const before = found.signalement;
      found.signalement = { ...before, status };
      found.statusChangedBy = by ?? null;
      return { before, after: found.signalement };
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

const triageOf = (rows: TriageableSignalement[], failure?: IssuesError, missing: Record<string, TriageMissingReason> = {}) => {
  const { store, changes, links, drafts } = fakeSignalements(rows, missing);
  const github = fakeGitHub(failure);
  const triggers: GuardrailTrigger[] = [];
  const triage = createSignalementTriage({
    signalements: store,
    identityOf: async (id) => (id === MARIE ? IDENTITY : id === MIMI ? MIMI_IDENTITY : null),
    environment: "staging",
    issues: github.issues,
    issueUrl: (number) => `https://github.com/fnconsult/jobhub/issues/${number}`,
    triggers: { record: (trigger) => void triggers.push(trigger) },
    now: () => new Date("2026-11-26T09:00:00Z"),
  });
  return { triage, changes, links, drafts, written: github.written, triggers };
};

describe("Signalement triage's queue (#1139, ADR-0118): what an Agent Key reads", () => {
  it("gives each Signalement with exactly the keys planned: type, message, date, status, its context and a Question's copy", async () => {
    const { triage } = triageOf([row(MARIE, signalement())]);

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
      "issue",
      "brouillon",
    ]);
    expect(item).toMatchObject({ id: "0b6c2f1e-1111-4111-8111-111111111111", type: "bug", sentAt: "2026-11-25T09:00:00.000Z", status: "nouveau", environment: "staging", version: "35e2ea1", device: "Chrome 141, Mac", interfaceLanguage: "fr", textSize: "large", issue: null, brouillon: null });
    const one = await triage.one(item!.id);
    expect(one).toEqual({ ok: true, signalement: item });
    expect(Object.keys(one.ok ? one.signalement : {})).toEqual([...TRIAGE_KEYS]);
  });

  it("shows what triage already did (#1173): the issue linked, with its page, and the draft's signature and date, never its text", async () => {
    const { triage } = triageOf([row(MARIE, signalement({ status: "vu" }), { statusChangedBy: "key:triage-beta", issueNumber: 1175, draft: { proposedBy: "key:triage-beta", proposedAt: new Date("2026-11-26T09:00:00Z") } })]);

    const [item] = await triage.queue();

    expect(item!.issue).toEqual({ number: 1175, url: "https://github.com/fnconsult/jobhub/issues/1175" });
    expect(Object.keys(item!.issue!)).toEqual(["number", "url"]);
    expect(item!.brouillon).toEqual({ proposePar: "key:triage-beta", date: "2026-11-26T09:00:00.000Z" });
    expect(Object.keys(item!.brouillon!)).toEqual(["proposePar", "date"]);
  });

  it("redacts every text: the Candidate's name and email come out as « [NOM] » and « [E-MAIL] », their first name too", async () => {
    const question = signalement({
      type: "question",
      message: "Marie Dupont ici, l'aide ne m'a pas dit comment changer mon offre.",
      attachedQuestion: "Je suis Marie, comment passer à l'offre Standard ? Écrivez-moi à marie.dupont@example.fr",
      attachedCoachReply: "Bonjour Marie, je ne trouve pas d'article sur ce point. Appelez le 06 12 34 56 78.",
    });
    const { triage } = triageOf([row(MARIE, signalement()), row(MARIE, { ...question, id: "0b6c2f1e-3333-4333-8333-333333333333" })]);

    const [bug, asked] = await triage.queue();

    expect(bug!.message).toBe("Bonjour, je suis [NOM] ([E-MAIL]) : le bouton « Enregistrer » ne fait rien.");
    expect(asked!.message).toBe("[NOM] ici, l'aide ne m'a pas dit comment changer mon offre.");
    expect(asked!.attachedQuestion).toBe("Je suis [PRÉNOM], comment passer à l'offre Standard ? Écrivez-moi à [E-MAIL]");
    expect(asked!.attachedCoachReply).toBe("Bonjour [PRÉNOM], je ne trouve pas d'article sur ce point. Appelez le [TÉLÉPHONE].");
    expect(JSON.stringify(await triage.queue())).not.toMatch(/Marie|Dupont|marie\.dupont|06 12/);
  });

  it("redacts the Preferred Name too, one that is neither the first nor the last name", async () => {
    const { triage } = triageOf([row(MIMI, signalement({ message: "Je suis Mimi Dupont, dites Mimi. Marie sur mon CV." }))]);

    const [item] = await triage.queue();

    expect(item!.message).not.toMatch(/Mimi|Marie|Dupont/);
    expect(item!.message).toBe("Je suis [PRÉNOM] [NOM DE FAMILLE], dites [PRÉNOM]. [PRÉNOM 2] sur mon CV.");
  });

  it("gives the page's path with each id replaced by its type, never an id", async () => {
    const { triage } = triageOf([row(MARIE, signalement())]);

    expect((await triage.queue())[0]!.path).toBe("/candidatures/:id/documents");
    expect(JSON.stringify(await triage.queue())).not.toContain("0b6c2f1e-2222");
  });

  it("never gives the Candidate's email, name, Plan or id, the team's reply, nor any object of theirs", async () => {
    const { triage } = triageOf([row(MARIE, signalement())]);

    const given = JSON.stringify(await triage.queue());

    expect(given).not.toContain(MARIE);
    expect(given).not.toMatch(/"(candidate\w*|plan|email|reply)"|Merci Marie/i);
  });

  it("filters the queue by status", async () => {
    const seen = signalement({ id: "0b6c2f1e-4444-4444-8444-444444444444", status: "vu" });
    const { triage } = triageOf([row(MARIE, signalement()), row(MARIE, seen)]);

    expect((await triage.queue({ statuses: ["vu"] })).map((each) => each.id)).toEqual([seen.id]);
  });

  it("says why it finds none (#1173): deleted, treated, sent without the AI notice, or unknown; nothing of the Candidate", async () => {
    const { triage } = triageOf([], undefined, { "0b6c2f1e-1111-4111-8111-111111111111": "deleted", "0b6c2f1e-2222-4222-8222-222222222222": "treated", "0b6c2f1e-3333-4333-8333-333333333333": "no_ai_notice" });

    expect(await triage.one("0b6c2f1e-1111-4111-8111-111111111111")).toEqual({ ok: false, error: "not_found", reason: "deleted" });
    expect(await triage.one("0b6c2f1e-2222-4222-8222-222222222222")).toEqual({ ok: false, error: "not_found", reason: "treated" });
    expect(await triage.one("0b6c2f1e-3333-4333-8333-333333333333")).toEqual({ ok: false, error: "not_found", reason: "no_ai_notice" });
    expect(await triage.one("0b6c2f1e-9999-4999-8999-999999999999")).toEqual({ ok: false, error: "not_found", reason: "unknown" });
  });

  it("keeps one « traité » readable, until its purge (#1173)", async () => {
    const { triage } = triageOf([row(MARIE, signalement({ status: "traite" }))]);

    expect(await triage.one(ID)).toMatchObject({ ok: true, signalement: { id: ID, status: "traite" } });
  });
});

describe("Signalement triage marks « vu » (#1139)", () => {
  it("sets « vu », signed key:<name>, and only « vu »; answers its id, status and signature, never its message (#1173)", async () => {
    const { triage, changes } = triageOf([row(MARIE, signalement())]);

    const done = await triage.markSeen("0b6c2f1e-1111-4111-8111-111111111111", "triage-beta");

    expect(done).toEqual({ ok: true, seen: { id: "0b6c2f1e-1111-4111-8111-111111111111", statut: "vu", statutMajPar: "key:triage-beta" } });
    expect(Object.keys(done.ok ? done.seen : {})).toEqual(["id", "statut", "statutMajPar"]);
    expect(changes).toEqual([{ id: "0b6c2f1e-1111-4111-8111-111111111111", status: "vu", by: "key:triage-beta" }]);
  });

  it("changes nothing on one already « vu », refuses one « traité », and finds none it may not read", async () => {
    const { triage, changes } = triageOf([
      row(MARIE, signalement({ status: "vu" })),
      row(MARIE, signalement({ id: "0b6c2f1e-5555-4555-8555-555555555555", status: "traite" })),
    ]);

    expect(await triage.markSeen("0b6c2f1e-1111-4111-8111-111111111111", "triage-beta")).toEqual({ ok: true, seen: { id: "0b6c2f1e-1111-4111-8111-111111111111", statut: "vu", statutMajPar: null } });
    expect(await triage.markSeen("0b6c2f1e-5555-4555-8555-555555555555", "triage-beta")).toEqual({ ok: false, error: "already_handled" });
    expect(await triage.markSeen("0b6c2f1e-9999-4999-8999-999999999999", "triage-beta")).toEqual({ ok: false, error: "not_found", reason: "unknown" });
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
    const { triage, written, links, triggers } = triageOf([row(MARIE, signalement())]);

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
    const { triage, written, links } = triageOf([row(MARIE, signalement())]);

    const done = await triage.proposeIssue(ID, "triage-beta", { commentOn: 1188 });

    expect(done).toEqual({ ok: true, issue: { number: 1188, url: "https://github.com/fnconsult/jobhub/issues/1188#issuecomment-9", kind: "commented" } });
    expect(written).toEqual([{ kind: "commented", number: 1188, body: expect.stringContaining(`Signalement \`${ID}\``) }]);
    expect(written[0]!.body).toContain("Chrome 141, Mac");
    expect(links).toEqual([{ id: ID, number: 1188, kind: "commented", by: "key:triage-beta" }]);
  });

  it("blocks a text with the Candidate's data, says why (422), publishes nothing and records the Guardrail Trigger", async () => {
    const { triage, written, links, triggers } = triageOf([row(MARIE, signalement())]);

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
    const { triage, written } = triageOf([row(MARIE, signalement())]);

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

  it("says why it finds none (#1173)", async () => {
    const { triage, written } = triageOf([], undefined, { [ID]: "deleted" });

    expect(await triage.proposeIssue(ID, "triage-beta", PROPOSED)).toEqual({ ok: false, error: "not_found", reason: "deleted" });
    expect(await triage.proposeIssue("0b6c2f1e-9999-4999-8999-999999999999", "triage-beta", PROPOSED)).toEqual({ ok: false, error: "not_found", reason: "unknown" });
    expect(written).toEqual([]);
  });

  it("still links an issue, or comments on a duplicate, once Support has marked it « traité » (#1173)", async () => {
    const { triage, written, links } = triageOf([row(MARIE, signalement({ status: "traite" }))]);

    expect(await triage.proposeIssue(ID, "triage-beta", { commentOn: 1188 })).toMatchObject({ ok: true, issue: { number: 1188, kind: "commented" } });
    expect(written).toHaveLength(1);
    expect(links).toEqual([{ id: ID, number: 1188, kind: "commented", by: "key:triage-beta" }]);
  });

  it("refuses a second issue for one already linked, naming it (409 already_linked, #1173): publishes nothing", async () => {
    const { triage, written, links, triggers } = triageOf([row(MARIE, signalement(), { issueNumber: 1175 })]);

    expect(await triage.proposeIssue(ID, "triage-beta", PROPOSED)).toEqual({ ok: false, error: "already_linked", issue: { number: 1175, url: "https://github.com/fnconsult/jobhub/issues/1175" } });
    expect(await triage.proposeIssue(ID, "triage-beta", { commentOn: 1188 })).toMatchObject({ ok: false, error: "already_linked" });
    expect(written).toEqual([]);
    expect(links).toEqual([]);
    expect(triggers).toEqual([]);
  });

  it("says why GitHub was not written, and links nothing", async () => {
    for (const reason of ["missing_token", "not_found", "refused", "failed"] as const) {
      const { triage, links } = triageOf([row(MARIE, signalement())], new IssuesError(reason));

      expect(await triage.proposeIssue(ID, "triage-beta", PROPOSED)).toEqual({ ok: false, error: "github", reason });
      expect(links).toEqual([]);
    }
  });
});

describe("Signalement triage proposes a draft reply (#1141, ADR-0118)", () => {
  const DRAFT = { fr: "Merci, nous avons trouvé la cause.", en: "Thank you, we found the cause." };

  it("keeps it in French and English, signed by its key; never sends it; answers its signature and date, never its text (#1173)", async () => {
    const { triage, drafts, changes } = triageOf([row(MARIE, signalement())]);

    const done = await triage.proposeDraft(ID, "triage-beta", DRAFT);

    expect(done).toEqual({ ok: true, proposed: { id: ID, brouillon: { proposePar: "key:triage-beta", date: "2026-11-26T09:00:00.000Z" } } });
    expect(Object.keys(done.ok ? done.proposed : {})).toEqual(["id", "brouillon"]);
    expect(Object.keys(done.ok ? done.proposed.brouillon : {})).toEqual(["proposePar", "date"]);
    expect(JSON.stringify(done)).not.toMatch(/Merci|Thank you/);
    expect(drafts).toEqual([{ id: ID, draft: DRAFT, by: "key:triage-beta" }]);
    expect(changes).toEqual([]);
  });

  it("refuses one missing a language, one on a Signalement « traité », and finds none it may not read", async () => {
    const { triage } = triageOf([
      row(MARIE, signalement()),
      row(MARIE, signalement({ id: "0b6c2f1e-5555-4555-8555-555555555555", status: "traite" })),
    ]);

    expect(await triage.proposeDraft(ID, "triage-beta", { fr: "Merci." })).toEqual({ ok: false, error: "invalid", errors: [{ field: "en", code: "required" }] });
    expect(await triage.proposeDraft("0b6c2f1e-5555-4555-8555-555555555555", "triage-beta", DRAFT)).toEqual({ ok: false, error: "already_handled" });
    expect(await triage.proposeDraft("0b6c2f1e-9999-4999-8999-999999999999", "triage-beta", DRAFT)).toEqual({ ok: false, error: "not_found", reason: "unknown" });
  });
});
