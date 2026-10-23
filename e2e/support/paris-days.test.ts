import { describe, expect, it } from "vitest";
import { parisDay } from "./paris-days";

describe("parisDay: the day some days from now, in French time", () => {
  it("counts days on the calendar, not 24-hour spans, across the night the clocks go back", () => {
    // 00:57 on Saturday 24 October 2026 in Paris; Sunday 25th lasts 25 hours.
    const now = new Date("2026-10-23T22:57:00Z");
    expect([-1, 0, 1, 2].map((offset) => parisDay(offset, now))).toEqual(["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"]);
  });

  it("counts days on the calendar across the night the clocks go forward", () => {
    // 23:30 on Saturday 28 March 2026 in Paris; Sunday 29th lasts 23 hours.
    const now = new Date("2026-03-28T22:30:00Z");
    expect([0, 1, 2].map((offset) => parisDay(offset, now))).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
  });

  it("takes today in French time, not UTC", () => {
    expect(parisDay(0, new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(parisDay(1, new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-02");
  });
});
