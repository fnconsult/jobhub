import type { SignalementType } from "@/signalements/values";

/**
 * The Signalement's three glyphs (#280, #375), drawn in a 24 × 24 box: a six-legged bug (head, body, centre line, three
 * legs on each side), ⓘ and ○□△. All three are drawn on ONE shared skeleton, 9 subpaths each `M C C C C Z`, so SVG's
 * SMIL `<animate attributeName="d">` morphs one into another (#279): lines are drawn out and back, a side of no length
 * closes a triangle, and a subpath a glyph does not need shrinks to a point. Drawn with butt caps, so a point shows
 * nothing. Geometry from the throwaway prototype (prototype/signalement-icon, PrototypeSignalementIcon.html).
 */

type Point = readonly [x: number, y: number];

const round = (n: number) => +n.toFixed(2);
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const xy = (p: Point) => `${round(p[0])} ${round(p[1])}`;

/** A cubic that runs straight from `a` to `b`. */
const straight = (a: Point, b: Point): [Point, Point, Point] => [lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b];
const subpath = (start: Point, curves: ReadonlyArray<readonly [Point, Point, Point]>) =>
  `M${xy(start)}${curves.map(([c1, c2, end]) => `C${xy(c1)} ${xy(c2)} ${xy(end)}`).join("")}Z`;

function ellipse(cx: number, cy: number, rx: number, ry: number) {
  const kx = 0.5523 * rx;
  const ky = 0.5523 * ry;
  return subpath(
    [cx, cy - ry],
    [
      [[cx + kx, cy - ry], [cx + rx, cy - ky], [cx + rx, cy]],
      [[cx + rx, cy + ky], [cx + kx, cy + ry], [cx, cy + ry]],
      [[cx - kx, cy + ry], [cx - rx, cy + ky], [cx - rx, cy]],
      [[cx - rx, cy - ky], [cx - kx, cy - ry], [cx, cy - ry]],
    ],
  );
}
const circle = (cx: number, cy: number, r: number) => ellipse(cx, cy, r, r);
const polygon = (p0: Point, p1: Point, p2: Point, p3: Point) => subpath(p0, [straight(p0, p1), straight(p1, p2), straight(p2, p3), straight(p3, p0)]);
const square = (x: number, y: number, size: number) => polygon([x, y], [x + size, y], [x + size, y + size], [x, y + size]);
/** The fourth side has no length. */
const triangle = (a: Point, b: Point, c: Point) => polygon(a, b, c, a);
/** Out and back: drawn by its stroke. */
const line = (a: Point, b: Point) => {
  const middle = lerp(a, b, 0.5);
  return polygon(a, middle, b, middle);
};
/** Nothing: a line of no length. */
const point = (p: Point) => line(p, p);

/** The bug's six legs: where each joins the body, and its tip; three on each side. */
const LEGS: ReadonlyArray<readonly [Point, Point]> = [
  [[8.6, 10.5], [4.6, 7.8]],
  [[7.4, 14], [3.4, 14]],
  [[8, 17.5], [4.4, 20.4]],
  [[15.4, 10.5], [19.4, 7.8]],
  [[16.6, 14], [20.6, 14]],
  [[16, 17.5], [19.6, 20.4]],
];
/** In ⓘ and ○□△ the legs shrink to nothing where they join the body. */
const NO_LEGS = LEGS.map(([joint]) => point(joint));

export const SIGNALEMENT_GLYPHS = {
  bug: [ellipse(12, 14.5, 4.6, 6), circle(12, 6.4, 2.1), line([12, 11], [12, 20.5]), ...LEGS.map(([joint, tip]) => line(joint, tip))].join(""),
  info: [circle(12, 12, 9), circle(12, 7.6, 0.55), line([12, 10.8], [12, 17]), ...NO_LEGS].join(""),
  shapes: [circle(7, 16, 3.6), square(13, 12.4, 7), triangle([12, 3.5], [16.2, 10.2], [7.8, 10.2]), ...NO_LEGS].join(""),
} as const;

const GLYPH_OF_TYPE = { bug: "bug", idee: "shapes", question: "info" } as const satisfies Record<SignalementType, keyof typeof SIGNALEMENT_GLYPHS>;

/** The glyph a Signalement's type shows: the bug for a Bug, ○□△ for an Idée, ⓘ for a Question. */
export const signalementGlyph = (type: SignalementType): string => SIGNALEMENT_GLYPHS[GLYPH_OF_TYPE[type]];
