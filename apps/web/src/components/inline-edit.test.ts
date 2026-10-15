import { describe, expect, it } from "vitest";
import { inlineCommit } from "./inline-edit";

describe("inlineCommit: what leaving an inline-edit field does", () => {
  it("saves a changed value", () => {
    expect(inlineCommit({ saved: "Lyon", value: "Paris", required: true })).toBe("save");
  });

  it("does nothing when the value is the one saved, spaces around it aside", () => {
    expect(inlineCommit({ saved: "Lyon", value: "Lyon", required: true })).toBe("unchanged");
    expect(inlineCommit({ saved: "Lyon", value: "  Lyon ", required: true })).toBe("unchanged");
  });

  it("puts the saved value back when a required field is left blank", () => {
    expect(inlineCommit({ saved: "Lyon", value: "   ", required: true })).toBe("revert");
  });

  it("saves a blank optional field: the Candidate cleared it", () => {
    expect(inlineCommit({ saved: "85000", value: "", required: false })).toBe("save");
  });
});
