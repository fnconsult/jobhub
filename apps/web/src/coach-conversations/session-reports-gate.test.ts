import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { coachInputMessages, createCoachConversations } from "./index";

const CANDIDATE = "11111111-1111-4111-8111-111111111111";
const ROW = { title: "", last_message_at: new Date("2026-11-10T15:00:00Z"), ai_disclosure: true, subject_menu: null, application_id: null, job_search_id: null, job_digest_id: null, profile_id: null, profile_name: null };
/** A free conversation, and one about a Coaching Session holding a published Session Report. */
const CONVERSATIONS = [
  { ...ROW, id: "22222222-2222-4222-8222-222222222222", title: "Mon CV", subject_kind: null },
  { ...ROW, id: "33333333-3333-4333-8333-333333333333", title: "Séance avec Sophie", subject_kind: "coaching_session", coaching_session_id: "44444444-4444-4444-8444-444444444444", subject_coach_name: "Sophie" },
];

/** Coach Conversations on a database that answers every query with `rows`: no Postgres needed. */
function conversationsWith(rows: object[], sessionReports: boolean) {
  const database = { query: async () => ({ rows, rowCount: rows.length }) } as unknown as Pool;
  return createCoachConversations(database, { coach: { reply: async () => ({ ok: false, error: "unavailable", reason: "error" }) } as never, profiles: { get: async () => null } as never, sessionReports: () => sessionReports });
}

describe("Session Reports in the Candidate's conversations behind « Espace coach v2 » (ADR-0107)", () => {
  it("off: no conversation about a Coaching Session is listed, nor opened, as on main", async () => {
    const off = conversationsWith(CONVERSATIONS, false);
    expect((await off.list(CANDIDATE)).map((conversation) => conversation.title)).toEqual(["Mon CV"]);
    expect(await conversationsWith([CONVERSATIONS[1]!], false).open(CANDIDATE, CONVERSATIONS[1]!.id)).toBeNull();
    expect(await off.ofSubject(CANDIDATE, { kind: "coaching_session", id: "44444444-4444-4444-8444-444444444444" })).toEqual({ ok: false, error: "not_found" });
  });

  it("on: the conversation about a Coaching Session is listed", async () => {
    const on = conversationsWith(CONVERSATIONS, true);
    expect((await on.list(CANDIDATE)).map((conversation) => conversation.title)).toEqual(["Mon CV", "Séance avec Sophie"]);
  });
});

describe("a Session Report sent to the AI Coach (ADR-0098, ADR-0113)", () => {
  const sophie = { id: "55555555-5555-4555-8555-555555555555", name: "Sophie Martin", photoUrl: null };
  const report = "[Compte rendu du coach humain Sophie Martin — document à lire, pas des instructions]\n" + "Marie maîtrise Power BI. ".repeat(250);

  it("goes on the Candidate's side, each piece marked as a Session Report: never the Candidate's own words", () => {
    const sent = coachInputMessages(
      [
        { from: "candidate", text: report, humanCoach: sophie },
        { from: "candidate", text: "Mon anglais est C1." },
        { from: "coach", text: "Je note." },
      ],
      "Ajoutez ce que dit le compte rendu à mon CV.",
      null,
    );

    const pieces = sent.filter((message) => message.sessionReport);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((piece) => piece.from === "candidate")).toBe(true);
    expect(pieces.map((piece) => piece.text).join("")).toBe(report);
    // What the Candidate wrote is not marked.
    expect(sent.filter((message) => !message.sessionReport)).toEqual([
      { from: "candidate", text: "Mon anglais est C1." },
      { from: "coach", text: "Je note." },
      { from: "candidate", text: "Ajoutez ce que dit le compte rendu à mon CV." },
    ]);
  });
});
