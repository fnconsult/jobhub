/**
 * The video's timeline: where each step of the capture, each sentence of the narration and each zoom fall, once a title
 * card opens the video. The Remotion composition plays it (`remotion/Motion.tsx`) and the WebVTT captions are written
 * from it, so the captions say exactly what the voice says, when it says it.
 *
 *   const timeline = motionTimeline(script, narration, capture);
 *   writeFileSync("captions.vtt", webVtt(timeline));
 */
import type { MotionScript } from "@jobhub/help";
import type { Narration } from "./narration";

/** Seconds of the opening title card, and of the last frame held at the end. */
export const INTRO_SECONDS = 3;
export const OUTRO_SECONDS = 1.5;
export const FPS = 30;
/** An Explainer Video lasts 30 to 90 s (CONTEXT.md): outside, the run warns. */
export const DURATION_RANGE = { min: 30, max: 90 } as const;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the capture wrote (`capture.json`): each step's start and end in the recording, in ms, and its zoom. */
export interface Capture {
  video: string;
  width: number;
  height: number;
  steps: { start: number; end: number; zoom: Box | null }[];
  /** Every page the capture went through (paths), to compare with the script's routes. */
  visited: string[];
}

export interface Timeline {
  title: string;
  locale: MotionScript["locale"];
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
  /** Where the capture's first step starts in the recording, in seconds: the video is played from there. */
  videoFrom: number;
  video: string;
  steps: { title: string; at: number; length: number; zoom: Box | null }[];
  audio: { file: string; at: number; duration: number }[];
  cues: { start: number; end: number; text: string }[];
}

export function motionTimeline(script: MotionScript, narration: Narration, capture: Capture): Timeline {
  if (capture.steps.length !== script.steps.length) throw new Error(`the capture played ${capture.steps.length} steps of ${script.steps.length}`);
  const origin = capture.steps[0]!.start;
  const steps = script.steps.map((step, index) => {
    const captured = capture.steps[index]!;
    return { title: step.title, at: INTRO_SECONDS + (captured.start - origin) / 1000, length: (captured.end - captured.start) / 1000, zoom: captured.zoom };
  });
  const audio = narration.steps.flatMap((step, index) => step.sentences.map((sentence) => ({ file: sentence.file, at: steps[index]!.at + sentence.start, duration: sentence.duration })));
  const cues = narration.steps.flatMap((step, index) =>
    step.sentences.flatMap((sentence) => captionCues(sentence.text, steps[index]!.at + sentence.start, sentence.duration)),
  );
  const last = steps.at(-1)!;
  return {
    title: script.title,
    locale: script.locale,
    width: capture.width,
    height: capture.height,
    duration: round(last.at + last.length + OUTRO_SECONDS),
    videoFrom: origin / 1000,
    video: capture.video,
    steps,
    audio,
    cues,
  };
}

/** Two lines of 42 characters at most per caption (the usual subtitling limit). */
const LINE = 42;

/** One sentence as captions: cut into pieces of two lines at most, each timed by its share of the sentence's characters. */
export function captionCues(text: string, start: number, duration: number): Timeline["cues"] {
  const pieces: string[] = [];
  let current = "";
  // A line never breaks just inside « … » (after « or before ») nor before French high punctuation.
  const unbroken = text.replace(/« /g, "«\u00a0").replace(/ ([»:;?!])/g, "\u00a0$1");
  for (const word of unbroken.split(" ")) {
    const next = current ? `${current} ${word}` : word;
    if (current && !twoLines(next).split("\n").every((line) => line.length <= LINE)) {
      pieces.push(current);
      current = word;
    } else current = next;
  }
  if (current) pieces.push(current);
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  let at = start;
  return pieces.map((piece) => {
    const length = (duration * piece.length) / total;
    const cue = { start: round(at), end: round(at + length), text: twoLines(piece) };
    at += length;
    return cue;
  });
}

function twoLines(text: string): string {
  if (text.length <= LINE) return text;
  // The break that makes the longer line shortest.
  const longer = (index: number) => Math.max(index, text.length - index - 1);
  let best = -1;
  for (let index = text.indexOf(" "); index !== -1; index = text.indexOf(" ", index + 1)) if (best === -1 || longer(index) < longer(best)) best = index;
  return best === -1 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

/** The WebVTT captions file (`kind="captions"`, #568). */
export function webVtt(timeline: Pick<Timeline, "cues">): string {
  return ["WEBVTT", "", ...timeline.cues.flatMap((cue, index) => [`${index + 1}`, `${timestamp(cue.start)} --> ${timestamp(cue.end)}`, cue.text, ""])].join("\n");
}

function timestamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
