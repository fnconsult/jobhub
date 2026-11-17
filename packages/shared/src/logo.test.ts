import { describe, expect, it } from "vitest";
import { AA_NON_TEXT_CONTRAST, contrastRatio } from "./design/audit";
import { designTokens } from "./design/tokens";
import { LOGO, logoFormFor, logoIconSvg, logoSvg } from "./logo";

const dots = (svg: string) => svg.match(/<circle\b/g)?.length ?? 0;
const ids = (svg: string) => [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const fills = (svg: string) => new Set([...svg.matchAll(/\b(?:fill|stop-color|stroke)="(#[0-9a-f]{3,6})"/gi)].map((match) => match[1]!.toLowerCase()));

describe("the logo's symbol, « La boîte qui répond » (ADR-0105)", () => {
  it("draws the offer in the slot and the three dots of the coach answering", () => {
    const svg = logoSvg("symbol");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain(LOGO.bubble);
    expect(dots(svg)).toBe(3);
  });

  it("is drawn flat below 40 px: no dots, no gradient, which do not survive 16 px", () => {
    const small = logoSvg("small");
    expect(dots(small)).toBe(0);
    expect(small).not.toContain("Gradient");
    expect(logoFormFor(16)).toBe("small");
    expect(logoFormFor(32)).toBe("small");
    expect(logoFormFor(48)).toBe("symbol");
    expect(logoFormFor(512)).toBe("symbol");
  });

  it("keeps two symbols on one page apart", () => {
    const page = logoSvg("symbol", { id: "a" }) + logoSvg("symbol", { id: "b" });
    expect(new Set(ids(page)).size).toBe(ids(page).length);
  });

  it("is decorative unless it is named: the name beside it, or its `alt`, says « Jobbbox »", () => {
    expect(logoSvg("symbol")).toContain('aria-hidden="true"');
    const named = logoSvg("small", { title: "Jobbbox" });
    expect(named).toContain('role="img"');
    expect(named).toContain("<title>Jobbbox</title>");
    expect(named).not.toContain("aria-hidden");
  });

  it("reads on the light and on the dark background, its colours the same in both themes (3:1, graphics)", () => {
    for (const theme of ["light", "dark"] as const) {
      const background = designTokens.color.background[theme];
      // The bubble's face draws the silhouette: each of its shades, and the flat one of the small form.
      for (const face of [...LOGO.colors.front, LOGO.colors.flat]) expect(contrastRatio(face, background)).toBeGreaterThanOrEqual(AA_NON_TEXT_CONTRAST);
    }
    // The offer reads on the bubble, the slot on the offer, at every size.
    for (const face of [...LOGO.colors.front, LOGO.colors.flat]) expect(contrastRatio(LOGO.colors.paper, face)).toBeGreaterThanOrEqual(AA_NON_TEXT_CONTRAST);
    expect(contrastRatio(LOGO.colors.slot, LOGO.colors.paper)).toBeGreaterThanOrEqual(AA_NON_TEXT_CONTRAST);
  });
});

describe("an icon made of the logo", () => {
  const box = (svg: string) => /<svg[^>]*\bviewBox="([^"]+)"/.exec(svg)![1]!.split(" ").map(Number);
  const symbolAt = (svg: string) => {
    const match = /<g transform="translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)">/.exec(svg)!;
    return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
  };

  it("sets the symbol on its tile, inside the share of the canvas it is given", () => {
    const svg = logoIconSvg({ size: 512, background: "#eef0fd", shape: "rounded", inset: 0.14 });
    expect(box(svg)).toEqual([0, 0, 512, 512]);
    expect(svg).toMatch(/<rect width="512" height="512" rx="[\d.]+" fill="#eef0fd"\/>/);
    const { x, y, scale } = symbolAt(svg);
    expect(x).toBeCloseTo(512 * 0.14, 0);
    expect(y).toBeCloseTo(512 * 0.14, 0);
    expect(scale * LOGO.box).toBeCloseTo(512 * (1 - 2 * 0.14), 0);
    expect(dots(svg)).toBe(3);
  });

  it("is drawn flat on a small icon", () => {
    expect(dots(logoIconSvg({ size: 16 }))).toBe(0);
    expect(dots(logoIconSvg({ size: 128 }))).toBe(3);
  });

  it("keeps a maskable icon's symbol in the safe circle, the background to the edge", () => {
    const svg = logoIconSvg({ size: 512, background: "#eef0fd", shape: "square", inset: 0.24 });
    expect(svg).toContain('<rect width="512" height="512" fill="#eef0fd"/>');
    const { scale } = symbolAt(svg);
    // The safe zone is the circle of 40 % of the size's radius around the centre: the symbol's square fits in it.
    const half = (scale * LOGO.box) / 2;
    expect(Math.hypot(half, half)).toBeLessThanOrEqual(512 * 0.4);
  });

  it("is one colour, the slot cut out, for a monochrome icon (Android 13)", () => {
    const svg = logoIconSvg({ size: 432, inset: 0.3, monochrome: true });
    expect(fills(svg)).toEqual(new Set(["#ffffff", "#000000"]));
    expect(svg).toContain("<mask");
    expect(svg).toContain(LOGO.bubble);
  });

  it("leaves the background out unless it is given", () => {
    expect(logoIconSvg({ size: 128 })).not.toMatch(/<rect [^>]*width="128"/);
  });
});
