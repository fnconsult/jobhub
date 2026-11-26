import { describe, expect, it } from "vitest";
import type { Changed, Signalement, SignalementStatus, Signalements, TriageableSignalement } from "./index";
import { createSignalementTriage, TRIAGE_KEYS } from "./triage";

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
  const store: Pick<Signalements, "triageable" | "triageableOne" | "changeStatus"> = {
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
  return { store, changes };
}

const triageOf = (rows: TriageableSignalement[]) => {
  const { store, changes } = fakeSignalements(rows);
  return { triage: createSignalementTriage({ signalements: store, identityOf: async (id) => (id === MARIE ? IDENTITY : id === MIMI ? MIMI_IDENTITY : null), environment: "staging" }), changes };
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
