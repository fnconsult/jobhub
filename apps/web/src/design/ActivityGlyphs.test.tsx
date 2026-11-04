// @vitest-environment jsdom
import { ACTIVITIES } from "@jobhub/shared";
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityGlyphs } from "./ActivityGlyphs";
import { GLYPHS } from "@/components/activity-glyph-frames";
import { renderInFrench } from "./testing";

describe("the Activity glyphs of the Design System page (#726)", () => {
  // Motion allowed: still all the same, since none is live.
  beforeEach(() => vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })));
  afterEach(() => vi.unstubAllGlobals());

  it("shows every Activity's glyph, still, beside its Step label and its id", () => {
    renderInFrench(<ActivityGlyphs />);
    const items = within(screen.getByRole("list", { name: "Glyphes d'Activité" })).getAllByRole("listitem");

    expect(items).toHaveLength(ACTIVITIES.length);
    ACTIVITIES.forEach((activity, index) => {
      const glyph = items[index]!.querySelector(`svg[data-activity="${activity}"]`)!;
      expect(glyph).not.toBeNull();
      expect(glyph.hasAttribute("data-live")).toBe(false);
      expect([...glyph.querySelectorAll("path")].map((path) => path.getAttribute("d"))).toEqual([...GLYPHS[activity].still]);
      expect(within(items[index]!).getByText(activity)).toBeTruthy();
    });
  });

  it("names a Coach Action's glyph by both its Step labels: it reads, or proposes", () => {
    renderInFrench(<ActivityGlyphs />);
    const act = screen.getByText("act").closest("li")!;

    expect(within(act).getByText("Consulte vos données · Prépare une proposition")).toBeTruthy();
  });
});
