import { describe, expect, it } from "vitest";
import { addPlace, movedOption } from "./places-input";

describe("adding a place to the Search Criteria's Locations", () => {
  it("adds it after the places already there, trimmed", () => {
    expect(addPlace(["Lyon (69)"], "  Île-de-France ")).toEqual({ places: ["Lyon (69)", "Île-de-France"] });
  });

  it("adds a place typed with no suggestion as it is: a foreign city, Remote", () => {
    expect(addPlace([], "Genève")).toEqual({ places: ["Genève"] });
    expect(addPlace(["Genève"], "Remote")).toEqual({ places: ["Genève", "Remote"] });
  });

  it("refuses a place already there, compared without case or accents", () => {
    expect(addPlace(["Île-de-France"], "ile-de-france")).toEqual({ refused: "duplicate" });
    expect(addPlace(["Saint-Étienne (42)"], "SAINT-ETIENNE (42)")).toEqual({ refused: "duplicate" });
  });

  it("refuses a sixth place", () => {
    expect(addPlace(["Lyon", "Paris", "Nantes", "Lille", "Rennes"], "Bordeaux")).toEqual({ refused: "full" });
  });

  it("adds nothing for a blank place", () => {
    expect(addPlace(["Lyon"], "   ")).toEqual({ refused: "blank" });
  });
});

describe("moving through the suggestions with the arrow keys", () => {
  it("goes down from none to the first, and wraps from the last to the first", () => {
    expect(movedOption(null, 3, "down")).toBe(0);
    expect(movedOption(0, 3, "down")).toBe(1);
    expect(movedOption(2, 3, "down")).toBe(0);
  });

  it("goes up from none to the last, and wraps from the first to the last", () => {
    expect(movedOption(null, 3, "up")).toBe(2);
    expect(movedOption(1, 3, "up")).toBe(0);
    expect(movedOption(0, 3, "up")).toBe(2);
  });

  it("is on none when there are no suggestions", () => {
    expect(movedOption(null, 0, "down")).toBeNull();
    expect(movedOption(null, 0, "up")).toBeNull();
  });
});
