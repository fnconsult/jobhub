import { ACTIVITIES } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { glyphOf, GLYPHS, MAX_STROKES, MORPH_MS, mix, phaseAt, strokesOf, type Frame, type Shape } from "./activity-glyph-frames";

const BRAIN_OUTLINE = GLYPHS.think.frames[0]!.d[0]!;
const isBrain = (d: readonly string[]) => d.includes(BRAIN_OUTLINE);
/** The feather's shaft: one stroke from its nib up to its vane, whatever its size and place. */
const isFeather = (d: readonly string[]) => d.some((path) => /^M[\d.]+ [\d.]+l-\d[\d.]* \d[\d.]*$/.test(path));
const isLens = (d: readonly string[]) => d.some((path) => /^M[\d.]+ [\d.]+a6 6 0 1 0 0 12 6 6 0 0 0 0-12z$/.test(path));
const isGlobe = (d: readonly string[]) => d.includes("M3 12h18");
const isBook = (d: readonly string[]) => d.some((path) => path.startsWith("M3 5c3-1 6-1 9 1") || path.startsWith("M5 4h12"));
/** The toolbox's body: drawn in every frame of `act`, read or proposal. */
const BOX_BODY = "M3 10.5h18v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z";
const LID_CLOSED = "M3 10.5l1.1-2.7a1.5 1.5 0 0 1 1.4-.9h13a1.5 1.5 0 0 1 1.4.9l1.1 2.7";
const LID_OPEN = "M3 10.5l.4-3a1.5 1.5 0 0 1 1.2-1.2l12.8-3.3a1.5 1.5 0 0 1 1.7.6l1.4 2.4";
const isBox = (d: readonly string[]) => strokesOf(d).includes(BOX_BODY);
const lidOf = (d: readonly string[]) => (d.includes(LID_OPEN) ? "open" : d.includes(LID_CLOSED) ? "closed" : null);
/** The key's bow, a circle of radius 1.4: its centre, or null when the frame has no key. */
const keyBow = (d: readonly string[]) => {
  const bow = strokesOf(d).map((path) => /^M([\d.]+) ([\d.]+)a1\.4 1\.4 0 1 0 0 2\.8/.exec(path)).find(Boolean);
  return bow ? [Number(bow[1]), Number(bow[2]) + 1.4] : null;
};
/** The key's shaft: where it ends, from its bow, or null. */
const keyShaftEnd = (d: readonly string[]) => {
  const shaft = strokesOf(d).find((path) => path.startsWith("M") && path.includes("L") && keyBow(d) !== null && !path.includes("a"));
  const points = shaft?.slice(1).split("L").map((point) => point.split(" ").map(Number));
  return points ? points[1]! : null;
};
/** The card, 5.2 by 5: its top left corner, or null. */
const cardOf = (d: readonly string[]) => {
  const card = strokesOf(d).map((path) => /^M([\d.]+) ([\d.]+)h5\.2v5h-5\.2z$/.exec(path)).find(Boolean);
  return card ? [Number(card[1]), Number(card[2])] : null;
};
const loopMs = (frames: readonly Frame[]) => frames.reduce((sum, frame) => sum + frame.ms + (frame.morph ?? MORPH_MS), 0);
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

  describe("act: the toolbox (a Coach Action, #788, replacing #726's pointer and card)", () => {
    const read = GLYPHS.act.frames.map((frame) => frame.d);
    const propose = glyphOf("act", "propose").frames.map((frame) => frame.d);

    it("draws the toolbox in every frame, read and proposal, in at most MAX_STROKES strokes", () => {
      for (const d of [...read, ...propose]) {
        expect(isBox(d)).toBe(true);
        expect(lidOf(d)).not.toBeNull();
        expect(strokesOf(d).length).toBeLessThanOrEqual(MAX_STROKES);
      }
    });

    it("read: the lid lifts on its left hinge, a key comes out of the right compartment, turns, goes back down, the lid closes", () => {
      expect(lidOf(read[0]!)).toBe("closed");
      expect(keyBow(read[0]!)).toBeNull();
      const firstKey = read.findIndex((d) => keyBow(d) !== null);
      const firstOpen = read.findIndex((d) => lidOf(d) === "open");
      expect(firstOpen).toBeGreaterThan(0);
      expect(firstKey).toBeGreaterThan(firstOpen);
      // Every key over the right compartment, x about 16, only while the lid is open.
      for (const d of read) {
        const bow = keyBow(d);
        if (!bow) continue;
        expect(lidOf(d)).toBe("open");
        expect(bow[0]).toBeGreaterThan(14);
        expect(bow[0]).toBeLessThan(19);
      }
      const keyed = read.filter((d) => keyBow(d) !== null);
      const heights = keyed.map((d) => keyBow(d)![1]!);
      const top = heights.indexOf(Math.min(...heights));
      expect(heights[0]).toBeGreaterThan(heights[top]!);
      expect(heights.at(-1)).toBeGreaterThan(heights[top]!);
      // It turns: its shaft points another way in one frame up there.
      const directions = keyed.map((d) => {
        const bow = keyBow(d)!;
        const end = keyShaftEnd(d)!;
        return Math.round(Math.atan2(end[1]! - bow[1]!, end[0]! - bow[0]!) * 10);
      });
      expect(new Set(directions).size).toBeGreaterThan(1);
      // Then the lid closes: the loop ends on a frame with no key, back to the closed box.
      expect(keyBow(read.at(-1)!)).toBeNull();
    });

    it("proposal: the same box, a small card comes out in place of the key", () => {
      expect(lidOf(propose[0]!)).toBe("closed");
      expect(propose.some((d) => cardOf(d) !== null)).toBe(true);
      expect(propose.some((d) => keyBow(d) !== null)).toBe(false);
      expect(read.some((d) => cardOf(d) !== null)).toBe(false);
      const heights = propose.flatMap((d) => cardOf(d)?.[1] ?? []);
      expect(Math.min(...heights)).toBeLessThan(heights[0]!);
      for (const d of propose) if (cardOf(d)) expect(lidOf(d)).toBe("open");
    });

    it("loops in about as long as the other glyphs (1 to 2 s), read and proposal", () => {
      for (const frames of [GLYPHS.act.frames, glyphOf("act", "propose").frames]) {
        expect(loopMs(frames)).toBeGreaterThanOrEqual(1000);
        expect(loopMs(frames)).toBeLessThanOrEqual(2000);
      }
    });

    it("is still, under reduced motion too, the closed box, read or proposal", () => {
      for (const still of [GLYPHS.act.still, glyphOf("act", "propose").still]) {
        expect(isBox(still)).toBe(true);
        expect(lidOf(still)).toBe("closed");
        expect(keyBow(still)).toBeNull();
        expect(cardOf(still)).toBeNull();
      }
    });

    it("is a glyph of its own, not compute's ticks", () => {
      expect(GLYPHS.act.still).not.toEqual(GLYPHS.compute.still);
    });

    it("every other step's glyph is its Activity's, whatever its label", () => {
      expect(glyphOf("act", "act")).toBe(GLYPHS.act);
      expect(glyphOf("think", "check")).toBe(GLYPHS.think);
      expect(glyphOf("think_write", "think_write")).toBe(GLYPHS.think_write);
    });
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
