import { ACTIVITIES } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { GLYPHS, MAX_STROKES, mix, phaseAt, strokesOf, type Shape } from "./activity-glyph-frames";

const BRAIN_OUTLINE = GLYPHS.think.frames[0]!.d[0]!;
const isBrain = (d: readonly string[]) => d.includes(BRAIN_OUTLINE);
/** The feather's shaft: one stroke from its nib up to its vane, whatever its size and place. */
const isFeather = (d: readonly string[]) => d.some((path) => /^M[\d.]+ [\d.]+l-\d[\d.]* \d[\d.]*$/.test(path));
const isLens = (d: readonly string[]) => d.some((path) => /^M[\d.]+ [\d.]+a6 6 0 1 0 0 12 6 6 0 0 0 0-12z$/.test(path));
const isGlobe = (d: readonly string[]) => d.includes("M3 12h18");
const isBook = (d: readonly string[]) => d.some((path) => path.startsWith("M3 5c3-1 6-1 9 1") || path.startsWith("M5 4h12"));
/** Runs of the same kind, in order: [brain, brain, feather] → [brain, feather]. */
const runs = (kinds: string[]) => kinds.filter((kind, index) => kind !== kinds[index - 1]);

describe("the Activity glyph's frames (#314, ported from the prototype's glyph)", () => {
  it("every Activity moves (more than one frame) and holds a still frame for reduced motion", () => {
    for (const activity of ACTIVITIES) {
      expect(GLYPHS[activity].frames.length, activity).toBeGreaterThan(1);
      expect(GLYPHS[activity].still.length, activity).toBeGreaterThan(0);
    }
  });

  it("no frame has more strokes than the glyph draws, so none is cut off when it morphs", () => {
    for (const activity of ACTIVITIES) {
      for (const frame of GLYPHS[activity].frames) expect(strokesOf(frame.d).length, activity).toBeLessThanOrEqual(MAX_STROKES);
      expect(strokesOf(GLYPHS[activity].still).length, activity).toBeLessThanOrEqual(MAX_STROKES);
    }
  });

  it("think: the brain in profile, its folds shifting, sparks flickering", () => {
    const frames = GLYPHS.think.frames.map((frame) => frame.d);
    expect(frames.every(isBrain)).toBe(true);
    expect(new Set(frames.map((d) => d.join("|"))).size).toBe(frames.length);
    expect(Math.max(...frames.map((d) => strokesOf(d).length))).toBeGreaterThan(strokesOf(frames[0]!).length);
  });

  it("think then write: the brain, then the feather", () => {
    const kinds = GLYPHS.think_write.frames.map((frame) => (isBrain(frame.d) ? "brain" : isFeather(frame.d) ? "feather" : "other"));
    expect(runs(kinds)).toEqual(["brain", "feather"]);
  });

  it("write: the feather writing, its nib along a line that grows", () => {
    const frames = GLYPHS.write.frames.map((frame) => frame.d);
    expect(frames.every(isFeather)).toBe(true);
    const lines = frames.map((d) => Number(/^M1\.6 22h([\d.]+)$/.exec(d.find((path) => path.startsWith("M1.6 22h")) ?? "")?.[1]));
    for (let index = 1; index < lines.length; index++) expect(lines[index]).toBeGreaterThan(lines[index - 1]!);
    expect(isFeather(GLYPHS.write.still)).toBe(true);
  });

  it("search: the magnifier sweeping", () => {
    const frames = GLYPHS.search.frames.map((frame) => frame.d);
    expect(frames.every(isLens)).toBe(true);
    expect(new Set(frames.map((d) => d[0])).size).toBeGreaterThan(1);
  });

  it("web search: magnifier → globe → book", () => {
    const kinds = GLYPHS.web_search.frames.map((frame) => (isLens(frame.d) ? "magnifier" : isGlobe(frame.d) ? "globe" : isBook(frame.d) ? "book" : "other"));
    expect(runs(kinds)).toEqual(["magnifier", "globe", "book"]);
  });

  it("read: the book turning its pages", () => {
    const frames = GLYPHS.read.frames.map((frame) => frame.d);
    expect(frames.every(isBook)).toBe(true);
    expect(new Set(frames.map((d) => d[2] ?? "")).size).toBeGreaterThanOrEqual(3);
  });

  it("compute: the ticks appearing one by one", () => {
    const counts = GLYPHS.compute.frames.map((frame) => strokesOf(frame.d).length);
    for (let index = 1; index < counts.length; index++) expect(counts[index]).toBeGreaterThan(counts[index - 1]!);
  });
});

describe("the glyph's morph", () => {
  it("splits a frame into its strokes, one per move", () => {
    expect(strokesOf(["M10 6h10M10 12h10", "M4 6l1.2 1.2L7.5 5"])).toEqual(["M10 6h10", "M10 12h10", "M4 6l1.2 1.2L7.5 5"]);
  });

  it("goes through each frame: it holds, then morphs into the next, then loops", () => {
    const frames = [
      { d: ["a"], ms: 100, morph: 200 },
      { d: ["b"], ms: 0, morph: 100 },
    ];
    expect(phaseAt(frames, 50)).toEqual({ from: 0, to: 1, progress: 0 });
    expect(phaseAt(frames, 200)).toEqual({ from: 0, to: 1, progress: 0.5 });
    expect(phaseAt(frames, 350)).toEqual({ from: 1, to: 0, progress: 0.5 });
    expect(phaseAt(frames, 400 + 50)).toEqual({ from: 0, to: 1, progress: 0 });
  });

  it("mixes two shapes point by point; a stroke that is not in one fades in or out", () => {
    const a: Shape = [{ points: [[0, 0], [10, 0]], on: 1 }, { points: [[12, 12], [12, 12]], on: 0 }];
    const b: Shape = [{ points: [[0, 10], [10, 10]], on: 1 }, { points: [[2, 2], [4, 4]], on: 1 }];
    expect(mix(a, b, 0)).toEqual(a);
    expect(mix(a, b, 1)).toEqual(b);
    expect(mix(a, b, 0.5)).toEqual([{ points: [[0, 5], [10, 5]], on: 1 }, { points: [[7, 7], [8, 8]], on: 0.5 }]);
  });
});
