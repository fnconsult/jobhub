import { describe, expect, it } from "vitest";
import { journalChanges } from "./journal-changes";

describe("what a Back Office Audit entry changed, as the Journal shows it", () => {
  it("an update shows only the fields that changed, before and after", () => {
    expect(
      journalChanges(
        { profiles: 1, matchScores: 3, atsScores: null, jobDigest: "none" },
        { profiles: 1, matchScores: null, atsScores: 2, jobDigest: "daily" },
      ),
    ).toEqual([
      { field: "matchScores", before: 3, after: null },
      { field: "atsScores", before: null, after: 2 },
      { field: "jobDigest", before: "none", after: "daily" },
    ]);
  });

  it("an addition shows every field it set, with nothing before", () => {
    expect(journalChanges(null, { name: "Sophie Martin", email: "sophie@rh-conseil.fr" })).toEqual([
      { field: "name", after: "Sophie Martin" },
      { field: "email", after: "sophie@rh-conseil.fr" },
    ]);
  });

  it("a retirement shows every field it had, with nothing after", () => {
    expect(journalChanges({ name: "Sophie Martin" }, null)).toEqual([{ field: "name", before: "Sophie Martin" }]);
  });

  it("a replaced secret, recorded without values, shows no field", () => {
    expect(journalChanges(null, null)).toEqual([]);
  });

  it("a value that is not a set of fields shows as one change", () => {
    expect(journalChanges("ancien", "nouveau")).toEqual([{ field: null, before: "ancien", after: "nouveau" }]);
    expect(journalChanges(null, ["coach_manager"])).toEqual([{ field: null, after: ["coach_manager"] }]);
  });
});
