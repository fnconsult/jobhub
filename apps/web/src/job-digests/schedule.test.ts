import { describe, expect, it } from "vitest";
import { latestSlot } from "./schedule";

describe("when a Job Digest goes out (07:00 Europe/Paris; weekly ones on Monday)", () => {
  it("daily: the latest 07:00 in Paris, summer or winter time", () => {
    // Thursday 15 October 2026, summer time (UTC+2).
    expect(latestSlot("daily", new Date("2026-10-15T09:30:00+02:00"))).toEqual(new Date("2026-10-15T07:00:00+02:00"));
    expect(latestSlot("daily", new Date("2026-10-15T07:00:00+02:00"))).toEqual(new Date("2026-10-15T07:00:00+02:00"));
    expect(latestSlot("daily", new Date("2026-10-15T06:59:59+02:00"))).toEqual(new Date("2026-10-14T07:00:00+02:00"));
    // Winter time (UTC+1).
    expect(latestSlot("daily", new Date("2026-12-01T12:00:00Z"))).toEqual(new Date("2026-12-01T07:00:00+01:00"));
    // Around midnight UTC, it is already the next day in Paris.
    expect(latestSlot("daily", new Date("2026-12-01T23:30:00Z"))).toEqual(new Date("2026-12-01T07:00:00+01:00"));
  });

  it("daily: across the change to winter time (last Sunday of October)", () => {
    expect(latestSlot("daily", new Date("2026-10-25T08:00:00+01:00"))).toEqual(new Date("2026-10-25T07:00:00+01:00"));
    expect(latestSlot("daily", new Date("2026-10-25T06:30:00+01:00"))).toEqual(new Date("2026-10-24T07:00:00+02:00"));
  });

  it("weekly: the latest Monday 07:00 in Paris", () => {
    // Thursday 15 October 2026 → Monday 12 October.
    expect(latestSlot("weekly", new Date("2026-10-15T09:30:00+02:00"))).toEqual(new Date("2026-10-12T07:00:00+02:00"));
    // Monday before 07:00 → the Monday before.
    expect(latestSlot("weekly", new Date("2026-10-12T06:00:00+02:00"))).toEqual(new Date("2026-10-05T07:00:00+02:00"));
    expect(latestSlot("weekly", new Date("2026-10-12T07:00:00+02:00"))).toEqual(new Date("2026-10-12T07:00:00+02:00"));
    // Sunday → the Monday six days before.
    expect(latestSlot("weekly", new Date("2026-10-18T22:00:00+02:00"))).toEqual(new Date("2026-10-12T07:00:00+02:00"));
    // Across the change of time: Monday 26 October is in winter time.
    expect(latestSlot("weekly", new Date("2026-10-27T12:00:00+01:00"))).toEqual(new Date("2026-10-26T07:00:00+01:00"));
  });
});
