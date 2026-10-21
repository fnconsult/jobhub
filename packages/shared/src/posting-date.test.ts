import { describe, expect, it } from "vitest";
import { parseStatedDate } from "./posting-date";

describe("reading a stated Posting date", () => {
  it("reads an ISO 8601 date as UTC midnight", () => {
    expect(parseStatedDate("2026-10-19")).toEqual(new Date("2026-10-19T00:00:00Z"));
  });

  it("reads a French day/month/year date as UTC midnight", () => {
    expect(parseStatedDate("19/10/2026")).toEqual(new Date("2026-10-19T00:00:00Z"));
    expect(parseStatedDate("5/3/2026")).toEqual(new Date("2026-03-05T00:00:00Z"));
  });

  it("states no date for a day/month/year that does not exist", () => {
    expect(parseStatedDate("31/02/2026")).toBeUndefined();
    expect(parseStatedDate("10/19/2026")).toBeUndefined();
  });
});
