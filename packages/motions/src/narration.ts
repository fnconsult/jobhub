/**
 * The narration of one Motion Script in one language: each sentence of each step read by the voice, in its own audio
 * file, with its duration. The capture holds each step at least as long as its narration (`stepDurations`), so the
 * voice and the screen stay together; the captions are timed on the same sentences (`captions.ts`).
 *
 *   const narration = await narrate(script, voice, dir); // writes dir/audio/<step>-<sentence>.mp3 and narration.json
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { narrationSentences, type MotionScript } from "@jobhub/help";
import type { Voice } from "./voice";

/** Silence between two sentences of a step, and after a step's last one, in seconds. */
export const SENTENCE_GAP = 0.35;
export const STEP_GAP = 0.8;

export interface SpokenSentence {
  text: string;
  /** Relative to the narration's folder: `audio/0-1.mp3`. */
  file: string;
  /** Seconds. */
  duration: number;
  /** Seconds from its step's start. */
  start: number;
}

export interface Narration {
  provider: string;
  voice: string;
  publishable: boolean;
  steps: { sentences: SpokenSentence[]; duration: number }[];
}

/** Reads each sentence with `voice`, writes the audio files and `narration.json` into `dir`. */
export async function narrate(script: MotionScript, voice: Voice, dir: string, measure: (file: string) => number = audioDuration): Promise<Narration> {
  mkdirSync(path.join(dir, "audio"), { recursive: true });
  const steps: Narration["steps"] = [];
  for (const [stepIndex, step] of script.steps.entries()) {
    const sentences: SpokenSentence[] = [];
    let at = 0;
    for (const [index, text] of narrationSentences(step.narration).entries()) {
      const audio = await voice.speak(text, script.locale);
      const file = `audio/${stepIndex}-${index}.${audio.extension}`;
      writeFileSync(path.join(dir, file), audio.data);
      const duration = measure(path.join(dir, file));
      sentences.push({ text, file, duration, start: at });
      at += duration + SENTENCE_GAP;
    }
    steps.push({ sentences, duration: Math.max(0, at - SENTENCE_GAP) + STEP_GAP });
  }
  const narration: Narration = { provider: voice.provider, voice: voice.voices[script.locale], publishable: voice.publishable, steps };
  writeFileSync(path.join(dir, "narration.json"), JSON.stringify(narration, null, 2));
  return narration;
}

/** How long each step must stay on screen, in milliseconds: its narration, the gap after it included. */
export function stepDurations(narration: Narration): number[] {
  return narration.steps.map((step) => Math.round(step.duration * 1000));
}

/** An audio file's duration in seconds, read by ffprobe. */
export function audioDuration(file: string): number {
  const run = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" });
  const seconds = Number(run.stdout.trim());
  if (run.status !== 0 || !Number.isFinite(seconds)) throw new Error(`ffprobe could not read ${file}: ${run.error?.message ?? run.stderr}`);
  return seconds;
}
