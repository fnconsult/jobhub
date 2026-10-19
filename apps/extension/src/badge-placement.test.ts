import { describe, expect, it } from "vitest";
import { badgePlacement, placementCss } from "./badge-placement";

describe("badgePlacement", () => {
  it("puts the badge at the bottom right of a job site's own page", () => {
    expect(badgePlacement(true, 24)).toEqual({ right: 24, bottom: 24 });
  });

  // iledefrance.fr sizes the gestmax.fr iframe to its whole content (~5400 px): its bottom is out of sight (#187).
  it("puts the badge at the top right of an iframe, where the posting starts", () => {
    expect(badgePlacement(false, 24)).toEqual({ right: 24, top: 24 });
  });
});

describe("placementCss", () => {
  it("writes each side as a CSS declaration", () => {
    expect(placementCss({ right: 24, top: 24 })).toBe("right: 24px; top: 24px;");
  });
});
