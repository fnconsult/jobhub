import { describe, expect, it } from "vitest";
import { dateChangeKind, firstPlannedAt, type Reschedule } from "./index";

/** "Now" in these tests: Tuesday 20 October 2026, 10:00 French time. */
const NOW = new Date("2026-10-20T08:00:00.000Z");
const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const OCT_22 = new Date("2026-10-22T12:30:00.000Z");
const OCT_24 = new Date("2026-10-24T07:00:00.000Z");

describe("dateChangeKind: whether changing an Agenda Item's date is a Reschedule", () => {
  it("is a correction, leaving no trace, within the hour after the date was entered or last changed", () => {
    expect(dateChangeKind({ from: OCT_22, to: OCT_24, dateSetAt: minutesBefore(30), now: NOW })).toBe("correction");
    expect(dateChangeKind({ from: OCT_22, to: OCT_24, dateSetAt: minutesBefore(60), now: NOW })).toBe("correction");
  });

  it("is a Reschedule more than an hour after", () => {
    expect(dateChangeKind({ from: OCT_22, to: OCT_24, dateSetAt: minutesBefore(120), now: NOW })).toBe("reschedule");
    expect(dateChangeKind({ from: OCT_22, to: OCT_24, dateSetAt: minutesBefore(61), now: NOW })).toBe("reschedule");
  });

  it("is nothing when the date stays the same", () => {
    expect(dateChangeKind({ from: OCT_22, to: new Date(OCT_22), dateSetAt: minutesBefore(120), now: NOW })).toBe("none");
    expect(dateChangeKind({ from: null, to: null, dateSetAt: null, now: NOW })).toBe("none");
  });

  it("is an entry when there was no date yet, and a cancellation when the date is cleared, at any time", () => {
    expect(dateChangeKind({ from: null, to: OCT_22, dateSetAt: null, now: NOW })).toBe("entry");
    expect(dateChangeKind({ from: OCT_22, to: null, dateSetAt: minutesBefore(5), now: NOW })).toBe("cancellation");
    expect(dateChangeKind({ from: OCT_22, to: null, dateSetAt: minutesBefore(500), now: NOW })).toBe("cancellation");
  });
});

describe("firstPlannedAt: the date first planned, for « Reporté · initialement prévu le … »", () => {
  const reschedule = (previousAt: Date, newAt: Date | null): Reschedule => ({ previousAt, newAt, by: "candidate", at: NOW });

  it("is the date before the first Reschedule", () => {
    expect(firstPlannedAt([reschedule(OCT_22, OCT_24), reschedule(OCT_24, new Date("2026-10-26T08:00:00.000Z"))])).toEqual(OCT_22);
  });

  it("is null when the item was never Rescheduled", () => {
    expect(firstPlannedAt([])).toBeNull();
  });

  it("starts again after a cancellation: a date entered afterwards is a new plan", () => {
    expect(firstPlannedAt([reschedule(OCT_22, OCT_24), reschedule(OCT_24, null)])).toBeNull();
    expect(firstPlannedAt([reschedule(OCT_22, null), reschedule(OCT_24, new Date("2026-10-26T08:00:00.000Z"))])).toEqual(OCT_24);
  });
});
