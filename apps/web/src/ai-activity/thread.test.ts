import type { Provenance } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { CoachMessage } from "../coach/conversation";
import type { CoachProposalCard } from "../coach-proposals/card";
import { messageAnchor, threadReplies } from "./thread";

const provenance: Provenance = { v: 1, steps: [], sites: [], startedAt: "2026-11-05T14:00:00.000Z", wallMs: 1_000 };

const card: CoachProposalCard = {
  id: "card-1",
  status: "accepted",
  decidedAt: "2026-11-05T14:05:00.000Z",
  undoable: true,
  change: {
    target: { kind: "profile", id: "p", name: "Contrôle de gestion", href: "/profils/p" },
    what: "Lieux",
    before: "Toulouse",
    after: "Toulouse, Blagnac",
    value: {},
    fields: [],
  },
};

describe("threadReplies (#808): the AI Coach replies the page's thread shows, as the Activité entries take them", () => {
  it("is each saved reply, known by when it was saved, with the Candidate's question before it, its Provenance, what it sent, the names it saw and its cards", () => {
    const messages: (CoachMessage | { from: "stopped" })[] = [
      { from: "candidate", text: "Je devrais ajouter Blagnac ?" },
      { from: "coach", text: "Oui.", provenance, at: "2026-11-05T14:00:00.000Z", sent: null, seenNames: { "/profils/p": "Contrôle de gestion" }, cards: [card] },
      { from: "candidate", text: "Arrêtez" },
      { from: "stopped" },
      { from: "candidate", text: "Et maintenant ?" },
      // A reply not saved yet (no time) is not one.
      { from: "coach", text: "…" },
    ];
    expect(threadReplies(messages)).toEqual([
      {
        messageId: "2026-11-05T14:00:00.000Z",
        at: "2026-11-05T14:00:00.000Z",
        question: "Je devrais ajouter Blagnac ?",
        provenance,
        sent: null,
        seenNames: { "/profils/p": "Contrôle de gestion" },
        cards: [{ id: "card-1", status: "accepted", decidedAt: "2026-11-05T14:05:00.000Z", change: { target: { href: "/profils/p", name: "Contrôle de gestion" }, what: "Lieux", before: "Toulouse", after: "Toulouse, Blagnac" } }],
      },
    ]);
  });

  it("has no question for a reply with no message of the Candidate's before it", () => {
    expect(threadReplies([{ from: "coach", text: "Bienvenue", at: "2026-11-05T14:00:00.000Z", provenance: null }])[0]).toMatchObject({ question: null, sent: null, cards: [] });
  });
});

it("keeps a Human Coach's signed Session Report out of AI Activity", () => {
  expect(threadReplies([{ from: "coach", text: "Session Report", at: "2026-11-10T15:00:00Z", humanCoach: { id: "h", name: "Sophie Martin", photoUrl: null } }])).toEqual([]);
});

describe("messageAnchor", () => {
  it("names a reply's place in the thread by its message, for « Voir dans la conversation »", () => {
    expect(messageAnchor("2026-11-05T14:00:00.000Z")).toBe('[data-message-id="2026-11-05T14:00:00.000Z"]');
  });
});
