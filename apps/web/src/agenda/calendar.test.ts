import { describe, expect, it } from "vitest";
import { calendarPeriod, readAgendaAddress } from "./calendar";

describe("calendarPeriod: the week", () => {
  it("runs Monday to Sunday around the date, whatever day it is", () => {
    // Tuesday 20 October 2026.
    expect(calendarPeriod("semaine", "2026-10-20")).toEqual({
      first: "2026-10-19",
      last: "2026-10-25",
      weeks: [["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]],
      previous: "2026-10-12",
      next: "2026-10-26",
    });
    // A Sunday belongs to the week that began on the Monday before.
    expect(calendarPeriod("semaine", "2026-10-25").first).toBe("2026-10-19");
    // A Monday starts its own week.
    expect(calendarPeriod("semaine", "2026-10-26").first).toBe("2026-10-26");
  });
});

describe("calendarPeriod: the month", () => {
  it("lays the month out in Monday-first weeks, with the days of the months around it to fill the first and last rows", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const october = calendarPeriod("mois", "2026-10-20");
    expect(october.first).toBe("2026-10-01");
    expect(october.last).toBe("2026-10-31");
    expect(october.weeks).toHaveLength(5);
    expect(october.weeks[0]).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(october.weeks[4]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(october.previous).toBe("2026-09-01");
    expect(october.next).toBe("2026-11-01");
  });

  it("renders a month that starts on a Sunday: its 1st closes the first row", () => {
    // 1 November 2026 is a Sunday.
    const november = calendarPeriod("mois", "2026-11-30");
    expect(november.first).toBe("2026-11-01");
    expect(november.last).toBe("2026-11-30");
    expect(november.weeks).toHaveLength(6);
    expect(november.weeks[0]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(november.weeks[5]).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
  });

  it("fits a February that starts on a Monday in four rows, and crosses the year at either end", () => {
    // 1 February 2027 is a Monday; 2027 is not a leap year.
    const february = calendarPeriod("mois", "2027-02-14");
    expect(february.weeks).toHaveLength(4);
    expect(february.weeks[0]![0]).toBe("2027-02-01");
    expect(february.weeks[3]![6]).toBe("2027-02-28");
    expect(calendarPeriod("mois", "2026-12-31").next).toBe("2027-01-01");
    expect(calendarPeriod("mois", "2027-01-31").previous).toBe("2026-12-01");
  });

  it("keeps whole days across the clock changes (end of March, end of October)", () => {
    expect(calendarPeriod("semaine", "2026-03-29").weeks[0]).toEqual(["2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29"]);
    expect(calendarPeriod("semaine", "2026-10-25").weeks[0]).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(calendarPeriod("mois", "2026-03-15").weeks.flat()).toContain("2026-03-29");
  });
});

describe("readAgendaAddress: the view and date an address asks for", () => {
  /** Monday 26 October 2026, 00:30 in French time (UTC+1 since the 25th), still the 25th in UTC. */
  const NOW = new Date("2026-10-25T23:30:00.000Z");

  it("reads the view and the day", () => {
    expect(readAgendaAddress({ vue: "semaine", date: "2026-11-04" }, NOW)).toEqual({ view: "semaine", date: "2026-11-04", chosen: true });
    expect(readAgendaAddress({ vue: "mois", date: "2027-02-01" }, NOW)).toEqual({ view: "mois", date: "2027-02-01", chosen: true });
    expect(readAgendaAddress({ vue: "liste" }, NOW)).toEqual({ view: "liste", date: "2026-10-26", chosen: true });
  });

  it("is the list on today, in French time, when the address names no view, and says so", () => {
    expect(readAgendaAddress({}, NOW)).toEqual({ view: "liste", date: "2026-10-26", chosen: false });
    expect(readAgendaAddress({ vue: "semaine" }, NOW)).toEqual({ view: "semaine", date: "2026-10-26", chosen: true });
  });

  it("falls back on the list and on today for a view or a day it does not know", () => {
    expect(readAgendaAddress({ vue: "annee", date: "2026-11-04" }, NOW)).toEqual({ view: "liste", date: "2026-11-04", chosen: false });
    for (const date of ["2026-02-30", "2026-13-01", "demain", "2026-1-5", ""]) {
      expect(readAgendaAddress({ vue: "mois", date }, NOW).date).toBe("2026-10-26");
    }
    expect(readAgendaAddress({ vue: ["mois", "semaine"], date: ["2026-11-04"] }, NOW)).toEqual({ view: "liste", date: "2026-10-26", chosen: false });
  });
});
