import { describe, expect, it } from "vitest";
import type { CoachProposalCard } from "@/coach-proposals/card";
import { asShownMessage } from "./chat-conversation";

describe("a saved message as shown", () => {
  it("keeps an AI Coach reply's Coach proposals (#715), so a reopened conversation shows them under it", () => {
    const card = { id: "c1", status: "accepted", undoable: true } as CoachProposalCard;

    expect(asShownMessage({ from: "coach", text: "Voici", at: "2026-11-04T17:20:00.000Z", cards: [card] })).toEqual({
      from: "coach",
      text: "Voici",
      provenance: null,
      at: "2026-11-04T17:20:00.000Z",
      cards: [card],
    });
    expect(asShownMessage({ from: "coach", text: "Voici", cards: [] })).toEqual({ from: "coach", text: "Voici" });
    // What its Coach Actions saw, by name, for « Le coach a consulté… » after a reload (#788).
    expect(asShownMessage({ from: "coach", text: "Voici", at: "2026-11-04T17:20:00.000Z", seenNames: { "/candidatures/a1": "Airbus · DAF" } })).toMatchObject({
      seenNames: { "/candidatures/a1": "Airbus · DAF" },
    });
  });

  it("keeps what a saved reply sent in all its AI calls (#805), so a reopened conversation's Activité sums them all", () => {
    const sent = { calls: 3, turns: 2, rounds: 1, inputTokens: 5200, cachedInputTokens: 1200, outputTokens: 310 };

    expect(asShownMessage({ from: "coach", text: "Voici", at: "2026-11-04T17:20:00.000Z", sent })).toMatchObject({ sent });
    // Saved before #791: nothing summed, its Provenance's last call only.
    expect(asShownMessage({ from: "coach", text: "Voici", at: "2026-11-04T17:20:00.000Z", sent: null })).toMatchObject({ sent: null });
  });
});
