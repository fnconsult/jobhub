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
  });
});
