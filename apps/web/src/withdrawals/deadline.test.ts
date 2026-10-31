import { describe, expect, it } from "vitest";
import { withdrawalDeadline, withdrawalOpen } from "./deadline";

/** An instant in French time, written without an offset ("2026-10-01T10:00"). */
const paris = (wallClock: string) => new Date(`${wallClock}:00+02:00`);
const parisWinter = (wallClock: string) => new Date(`${wallClock}:00+01:00`);

describe("the withdrawal period (C. conso. L221-18, L221-19)", () => {
  it("runs 14 days from the day after the contract was concluded, to the end of the 14th, in French time", () => {
    // Concluded on Thursday 1 October: the period runs from the 2nd to the end of Thursday 15 October.
    expect(withdrawalDeadline(paris("2026-10-01T10:00"))).toEqual(paris("2026-10-16T00:00"));
  });

  it("is open 3 days after the contract, and on its last evening, and closed the day after", () => {
    const concluded = paris("2026-10-01T10:00");

    expect(withdrawalOpen(concluded, paris("2026-10-04T10:00"))).toBe(true);
    expect(withdrawalOpen(concluded, paris("2026-10-15T23:59"))).toBe(true);
    expect(withdrawalOpen(concluded, paris("2026-10-16T00:00"))).toBe(false);
    expect(withdrawalOpen(concluded, paris("2026-10-16T10:00"))).toBe(false);
  });

  it("is never open before the contract was concluded", () => {
    expect(withdrawalOpen(paris("2026-10-01T10:00"), paris("2026-10-01T09:00"))).toBe(false);
  });

  it("ends on the next working day when its last day is a Saturday or a Sunday", () => {
    // Concluded Saturday 3 October: its 14th day is Saturday 17 October, so it runs to the end of Monday 19.
    expect(withdrawalDeadline(paris("2026-10-03T10:00"))).toEqual(paris("2026-10-20T00:00"));
  });

  it("ends on the next working day when its last day is a public holiday in France", () => {
    // Concluded Wednesday 28 October: its 14th day is Wednesday 11 November (Armistice), so it runs to the end of the 12th.
    expect(withdrawalDeadline(paris("2026-10-28T10:00"))).toEqual(parisWinter("2026-11-13T00:00"));
    // Concluded Friday 24 April: its 14th day is Friday 8 May (Victoire 1945), then a weekend: it runs to the end of Monday 11 May.
    expect(withdrawalDeadline(paris("2026-04-24T10:00"))).toEqual(paris("2026-05-12T00:00"));
  });

  it("is still open on the 15th day when the 14th was not a working day, and closed on the first day after the working day", () => {
    // Concluded Sunday 18 October: its 14th day is Sunday 1 November (also All Saints' Day), so the 15th day, Monday
    // 2 November, is still in the period; #511's « au 15e jour, il ne le voit plus » holds only when the 14th day is a working day.
    const concluded = paris("2026-10-18T10:00");

    expect(withdrawalOpen(concluded, parisWinter("2026-11-02T10:00"))).toBe(true);
    expect(withdrawalOpen(concluded, parisWinter("2026-11-03T00:00"))).toBe(false);
  });

  it("counts the holidays that move with Easter", () => {
    // Easter 2027 is 28 March: Easter Monday is 29 March. Concluded Monday 15 March 2027, its 14th day is Monday 29 March.
    expect(withdrawalDeadline(parisWinter("2027-03-15T10:00"))).toEqual(paris("2027-03-31T00:00"));
  });
});
