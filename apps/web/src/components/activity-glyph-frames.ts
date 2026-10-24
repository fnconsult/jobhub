/**
 * The Activity glyph's drawings and motion (#314, ported from the prototype's glyph on `prototype/ai-provenance-bar`): line
 * icons in `icons.tsx`'s style (24 grid, stroke 1.5), each Activity a loop of frames, each frame held, then morphed into the
 * next. ActivityGlyph (components/ActivityGlyph) samples each frame's strokes into points and draws them, mixed, from
 * JavaScript (Safari animates no SVG `d`); under prefers-reduced-motion it shows the Activity's still frame.
 *
 *   think        the brain in profile: its folds shift, sparks flicker at the front
 *   think_write  the brain, then the feather
 *   write        the feather writing: its nib runs along a line that grows behind it
 *   search       the magnifier sweeping
 *   web_search   magnifier → globe (it turns) → book (its pages turn)
 *   read         the book turning its pages
 *   compute      the ticks appearing one by one (rules, no AI)
 *
 * Pure: no DOM, so it is tested on its own.
 */
import type { Activity } from "@jobhub/shared";

/** One frame: its paths, how long it holds (ms), then how long it takes to morph into the next (ms, MORPH_MS by default). */
export interface Frame {
  d: readonly string[];
  ms: number;
  morph?: number;
}

/** The strokes the glyph draws: a frame with fewer pads with invisible ones, which grow in or fade out. */
export const MAX_STROKES = 9;
/** The points each stroke is sampled into. */
export const POINTS = 40;
/** A morph from one frame into the next, unless the frame says. */
export const MORPH_MS = 280;
/** The morph from what the glyph shows into the next Activity's first frame. */
export const ENTER_MS = 320;

export type Point = readonly [number, number];
/** A frame as drawn: each stroke's points, and how visible it is (0: a padding stroke, 1: drawn). */
export type Shape = readonly { points: readonly Point[]; on: number }[];

// The checklist: the tasks icon at rest.
const TASKS = ["M10 6h10M10 12h10M10 18h10", "M4 6l1.2 1.2L7.5 5", "M4 12l1.2 1.2 2.3-2.2", "M4 18l1.2 1.2 2.3-2.2"];

// The brain in profile, front to the left: the outline, the cerebellum and the brainstem stay; the folds (the lateral
// fissure, the central sulcus, a frontal and a parietal fold) shift, and sparks flicker at the front: it thinks.
const PROFILE = [
  "M6 16.5C3.8 16 2.5 14.2 2.5 12c0-1.2.4-2.3 1.1-3.1C3.7 6.6 5.6 4.8 8 4.5c1-.9 2.4-1.4 3.9-1.2 1.2-.5 2.6-.4 3.7.3 2.3.3 4.2 2 4.8 4.2 1 .7 1.6 1.9 1.6 3.2 0 2.6-2.1 4.7-4.7 4.7H6z",
  "M14.2 16.5c0 1.6 1.3 2.8 2.9 2.8 1.5 0 2.6-1.1 2.6-2.6",
  "M11.2 16.5l-.6 4",
];
const FOLDS = ["M4 12.6c2.5-.4 5 .2 7.2 1.8", "M12.4 3.6c-.6 2.2.6 3.6-.2 5.8-.5 1.3-.2 2.4.6 3.2", "M6.4 6.6c1.3.6 2 1.8 1.8 3.2", "M16.8 5.6c-.4 1.8.4 3.2 2 3.8"];
const BRAIN: Frame[] = [
  { d: [...PROFILE, ...FOLDS], ms: 160 },
  { d: [...PROFILE, "M4 12.2c2.6-.8 5.2-.2 7.4 1.4", "M12.8 3.6c-.9 2.1.4 3.8-.5 5.8-.4 1.2 0 2.4.9 3.1", "M6 7.2c1.5.3 2.4 1.4 2.4 2.9", "M17.4 5.8c-.7 1.7 0 3.3 1.6 4"], ms: 120 },
  { d: [...PROFILE, "M4 13c2.4 0 4.9.6 7 2.1", "M12 3.6c-.3 2.3.9 3.5.1 5.7-.6 1.4-.4 2.5.4 3.3", "M6.8 6.2c1.1.8 1.7 2 1.4 3.4", "M16.2 5.6c-.2 1.9.7 3.1 2.4 3.6"], ms: 120 },
  // The sparks, at the front.
  { d: [...PROFILE, ...FOLDS, "M1.2 8.4L.4 7.8M1 12H0"], ms: 140 },
];

// The magnifier: its lens, centred on (x, y), sweeps over a page: it searches.
const lens = (x: number, y: number) => [`M${x} ${y - 6}a6 6 0 1 0 0 12 6 6 0 0 0 0-12z`, `M${x + 4.3} ${y + 4.3}L${x + 8.5} ${y + 8.5}`];
const SEARCH: Frame[] = [
  { d: lens(10, 10), ms: 120 },
  { d: lens(8, 9), ms: 60, morph: 260 },
  { d: lens(11, 8), ms: 60, morph: 260 },
  { d: lens(9, 11), ms: 60, morph: 260 },
];

// The book: open, it turns its pages, right to left: it reads.
const BOOK_OPEN = ["M3 5c3-1 6-1 9 1v14c-3-2-6-2-9-1z", "M21 5c-3-1-6-1-9 1v14c3-2 6-2 9-1z"];
const PAGE_RIGHT = "M12 6c2-1.6 4-2.4 6-2.6v14c-2 .2-4 1-6 2.6";
const PAGE_UP = "M12 6c.4-1.8.9-3 1.4-4v14c-.5 1-1 2.2-1.4 4";
const PAGE_LEFT = "M12 6c-2-1.6-4-2.4-6-2.6v14c2 .2 4 1 6 2.6";
const READ: Frame[] = [
  { d: BOOK_OPEN, ms: 120, morph: 120 },
  { d: [...BOOK_OPEN, PAGE_RIGHT], ms: 30, morph: 170 },
  { d: [...BOOK_OPEN, PAGE_UP], ms: 0, morph: 170 },
  { d: [...BOOK_OPEN, PAGE_LEFT], ms: 30, morph: 120 },
];

// The globe: it turns (its meridian narrows and widens): it goes out on the web.
const meridian = (width: number) => `M12 3a${width} 9 0 1 0 0 18a${width} 9 0 1 0 0-18z`;
const globe = (width: number) => ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M3 12h18", "M4.5 7.5h15M4.5 16.5h15", meridian(width)];
const GLOBE: Frame[] = [6, 3.5, 0.6, 3.5].map((width) => ({ d: globe(width), ms: 0, morph: 220 }));
// The closed book of results, before it opens.
const RESULTS = ["M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z", "M5 18a2 2 0 0 1 2-2h12"];

// A web search: the magnifier sweeps, the globe turns, then the book of results is read.
const WEB_SEARCH: Frame[] = [SEARCH[0]!, SEARCH[1]!, SEARCH[2]!, ...GLOBE, ...GLOBE, { d: RESULTS, ms: 120 }, ...READ, ...READ];

// The feather, its nib at (x, y), `scale` its size; drawn with relative commands, so it moves whole.
const quill = (x: number, y: number, scale: number) => {
  const n = (value: number) => +(value * scale).toFixed(2);
  const at = (value: number) => +value.toFixed(2);
  return [
    `M${at(x + n(16.2))} ${at(y + n(-14.2))}a${n(6)} ${n(6)} 0 0 0 ${n(-8.5)} 0l${n(-5.7)} ${n(5.7)}v${n(6.5)}h${n(6.5)}l${n(5.7)} ${n(-5.7)}a${n(6)} ${n(6)} 0 0 0 0 ${n(-8.5)}z`,
    `M${at(x + n(11))} ${at(y + n(-11))}l${n(-11)} ${n(11)}`,
    `M${at(x + n(12.5))} ${at(y + n(-5.5))}h${n(-7.5)}`,
  ];
};
const FEATHER = quill(4, 18, 1);
// The nib runs along the line, up and down like handwriting, and the line grows behind it. Nearly full size (0.92), so
// the feather reads as one; the nib travels x 2.2 → 5.4 to stay in the 24 grid.
const WRITE: Frame[] = [
  { d: [...quill(2.2, 20, 0.92), "M1.6 22h.5"], ms: 60, morph: 220 },
  { d: [...quill(3, 19.3, 0.92), "M1.6 22h1.4"], ms: 0, morph: 220 },
  { d: [...quill(3.8, 20.1, 0.92), "M1.6 22h2.2"], ms: 0, morph: 220 },
  { d: [...quill(4.6, 19.3, 0.92), "M1.6 22h3"], ms: 0, morph: 220 },
  { d: [...quill(5.4, 20, 0.92), "M1.6 22h3.8"], ms: 160, morph: 340 },
];

// The ticks appear one by one: it checks and ranks.
const COMPUTE: Frame[] = [
  { d: [TASKS[0]!], ms: 120 },
  { d: TASKS.slice(0, 2), ms: 120 },
  { d: TASKS.slice(0, 3), ms: 120 },
  { d: TASKS, ms: 260 },
];

export const GLYPHS: Record<Activity, { frames: readonly Frame[]; still: readonly string[] }> = {
  think: { frames: BRAIN, still: BRAIN[0]!.d },
  // A model writes its text: the brain thinks, then the feather writes.
  think_write: { frames: [...BRAIN, ...BRAIN, ...WRITE, ...WRITE], still: BRAIN[0]!.d },
  write: { frames: WRITE, still: FEATHER },
  search: { frames: SEARCH, still: lens(10, 10) },
  // Still, the globe: what tells a web search from a search.
  web_search: { frames: WEB_SEARCH, still: globe(6) },
  read: { frames: READ, still: BOOK_OPEN },
  compute: { frames: COMPUTE, still: TASKS },
};

/** A frame's strokes: each of its paths split at every move, so each stroke is one line to sample. */
export function strokesOf(d: readonly string[]): string[] {
  return d.flatMap((path) => path.split(/(?=M)/).map((stroke) => stroke.trim()).filter(Boolean));
}

/** Where a loop of frames is at `elapsed` ms: the frame it shows, the next, and how far it has morphed into it (0 to 1). */
export function phaseAt(frames: readonly Frame[], elapsed: number): { from: number; to: number; progress: number } {
  const spans = frames.map((frame) => frame.ms + (frame.morph ?? MORPH_MS));
  const total = spans.reduce((sum, span) => sum + span, 0);
  let into = ((elapsed % total) + total) % total;
  let from = 0;
  while (from < frames.length - 1 && into >= spans[from]!) into -= spans[from++]!;
  const frame = frames[from]!;
  const progress = into <= frame.ms ? 0 : Math.min(1, (into - frame.ms) / (frame.morph ?? MORPH_MS));
  return { from, to: (from + 1) % frames.length, progress };
}

/** Two shapes mixed: each point `progress` of the way from `a` to `b`, each stroke's visibility too. */
export function mix(a: Shape, b: Shape, progress: number): Shape {
  return a.map((stroke, index) => {
    const into = b[index]!;
    return {
      points: stroke.points.map(([x, y], at) => [x + (into.points[at]![0] - x) * progress, y + (into.points[at]![1] - y) * progress] as const),
      on: stroke.on + (into.on - stroke.on) * progress,
    };
  });
}

/** In and out, slow at both ends. */
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** A stroke's points as a path. */
export const pathOf = (points: readonly Point[]) => `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}`;
