import { describe, expect, it } from "vitest";
import { SIGNALEMENT_GLYPHS, signalementGlyph } from "./signalement-glyphs";

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const PAIR = `${NUMBER} ${NUMBER}`;
/** One subpath of the shared skeleton: a move, four cubic curves, closed. */
const SUBPATH = new RegExp(`^M${PAIR}(?:C${PAIR} ${PAIR} ${PAIR}){4}Z$`);

const subpathsOf = (d: string) => d.split(/(?=M)/);
const pointsOf = (subpath: string) => [...subpath.matchAll(new RegExp(PAIR, "g"))].map(([pair]) => pair);
/** A subpath drawn as a single point: every coordinate the same (with butt caps, nothing shows). */
const isPoint = (subpath: string) => new Set(pointsOf(subpath)).size === 1;

describe("the Signalement glyphs (#375): bug, ⓘ and ○□△ on one shared skeleton, so SMIL can morph one into another", () => {
  it("each glyph is 9 subpaths, each M C C C C Z: the same commands, so `d` interpolates", () => {
    for (const [name, d] of Object.entries(SIGNALEMENT_GLYPHS)) {
      const subpaths = subpathsOf(d);
      expect(subpaths, name).toHaveLength(9);
      for (const subpath of subpaths) expect(subpath, name).toMatch(SUBPATH);
    }
  });

  it("the bug has six legs; in ⓘ and ○□△ the same six subpaths shrink to a point", () => {
    const legs = (d: string) => subpathsOf(d).slice(3);
    expect(legs(SIGNALEMENT_GLYPHS.bug).filter(isPoint)).toHaveLength(0);
    expect(legs(SIGNALEMENT_GLYPHS.info).every(isPoint)).toBe(true);
    expect(legs(SIGNALEMENT_GLYPHS.shapes).every(isPoint)).toBe(true);
    // The first three subpaths draw something in every glyph.
    for (const d of Object.values(SIGNALEMENT_GLYPHS)) expect(subpathsOf(d).slice(0, 3).some(isPoint)).toBe(false);
  });

  it("a Bug shows the bug, an Idée ○□△, a Question ⓘ", () => {
    expect(signalementGlyph("bug")).toBe(SIGNALEMENT_GLYPHS.bug);
    expect(signalementGlyph("idee")).toBe(SIGNALEMENT_GLYPHS.shapes);
    expect(signalementGlyph("question")).toBe(SIGNALEMENT_GLYPHS.info);
    expect(new Set(Object.values(SIGNALEMENT_GLYPHS)).size).toBe(3);
  });
});
