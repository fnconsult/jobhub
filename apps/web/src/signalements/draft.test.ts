import { describe, expect, it } from "vitest";
import { forgetDraft, keepDraft, keptDraft } from "./draft";

describe("the Signalement dialog's draft, kept in memory for the visit (#375)", () => {
  it("starts as an empty Bug", () => {
    expect(keptDraft()).toEqual({ type: "bug", text: "" });
  });

  it("what was typed and the type chosen come back at the next opening", () => {
    keepDraft({ type: "idee", text: "Court" });
    expect(keptDraft()).toEqual({ type: "idee", text: "Court" });
  });

  it("is forgotten once sent: an empty Bug again", () => {
    keepDraft({ type: "idee", text: "Pouvoir trier par date" });
    forgetDraft();
    expect(keptDraft()).toEqual({ type: "bug", text: "" });
  });
});
