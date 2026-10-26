import { describe, expect, it } from "vitest";
import { signalementDay } from "./day";

describe("the day a Signalement notification and « Mes signalements » name (#377)", () => {
  const now = new Date("2026-10-26T10:00:00Z");

  it("is the day and month in Paris time, in the Interface Language", () => {
    expect(signalementDay(new Date("2026-10-25T09:30:00Z"), now, "fr")).toBe("25 octobre");
    expect(signalementDay(new Date("2026-10-25T09:30:00Z"), now, "en")).toBe("October 25");
  });

  it("is the Paris day, not the UTC one, late in the evening", () => {
    expect(signalementDay(new Date("2026-03-01T23:30:00Z"), now, "fr")).toBe("2 mars");
  });

  it("names the year when it was another year", () => {
    expect(signalementDay(new Date("2025-12-31T09:00:00Z"), now, "fr")).toBe("31 décembre 2025");
    expect(signalementDay(new Date("2025-12-31T09:00:00Z"), now, "en")).toBe("December 31, 2025");
  });
});
