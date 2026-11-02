/**
 * The stages of a `motions` run, each reading and writing the run's work folder, so the workflow can run them as
 * separate steps (the capture runs inside Playwright, against the app on the demo data: e2e/motions.spec.ts):
 *
 *   plan     → plan.json: the motions to render (select.ts)
 *   narrate  → <id>/<locale>/narration.json and audio/: the synthetic voice (voice.ts)
 *   capture  → <id>/<locale>/capture.webm and capture.json, or capture-error.txt (capture.ts)
 *   render   → <id>/<locale>/out/: video.mp4, captions.vtt, transcript.md, poster.jpg (render.ts)
 *   publish  → the bucket and its manifest, then summary.md for the product owner (summary.ts)
 *
 * A stage that fails for one motion writes `<stage>-error.txt` beside it and goes on with the others: a broken capture
 * keeps the previous video, with a warning, and never fails the run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { motionFileKey, motionTranscript, type HelpLocale, type MotionScript } from "@jobhub/help";
import { readAppRoutes, readMotionScripts, motionScriptsDir } from "@jobhub/help/motion-scripts-content";
import { CONTENT_TYPES, IMMUTABLE, MANIFEST_KEY, readManifest, SHORT_LIVED, type Bucket, type Manifest, type PublishedMotion } from "./bucket";
import { narrate, type Narration } from "./narration";
import type { PlannedMotion } from "./select";
import { DURATION_RANGE, motionTimeline, webVtt, type Capture } from "./timeline";
import type { Voice } from "./voice";

/** The test Motion Scripts (#567): one that films the demo data, one whose capture breaks. */
export const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
export { motionScriptsDir };

export const STAGES = ["narrate", "capture", "render", "publish"] as const;
export type Stage = (typeof STAGES)[number];

/** The folder of one motion in the run. */
export function motionDir(work: string, motion: Pick<PlannedMotion, "id" | "locale">): string {
  return path.join(work, motion.id, motion.locale);
}

export function readPlan(work: string): PlannedMotion[] {
  return JSON.parse(readFileSync(path.join(work, "plan.json"), "utf8")) as PlannedMotion[];
}

export function writePlan(work: string, plan: readonly PlannedMotion[]): void {
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(work, "plan.json"), JSON.stringify(plan, null, 2));
}

/** The script a planned motion renders. Fixtures are checked against the app's routes as the build checks the others. */
export function scriptOf(motion: Pick<PlannedMotion, "id" | "locale" | "scriptsDir">): MotionScript {
  const script = readMotionScripts(motion.scriptsDir)[motion.locale].find((candidate) => candidate.id === motion.id);
  if (!script) throw new Error(`no Motion Script ${motion.locale}/${motion.id}.md in ${motion.scriptsDir}`);
  const routes = readAppRoutes();
  const missing = script.routes.filter((route) => !routes.includes(route));
  if (missing.length > 0) throw new Error(`${motion.id}: ${missing.join(", ")} is no page of the web app`);
  return script;
}

export function stageError(work: string, motion: PlannedMotion, stage: Stage): string | null {
  const file = path.join(motionDir(work, motion), `${stage}-error.txt`);
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}

export function writeStageError(work: string, motion: PlannedMotion, stage: Stage, error: unknown): void {
  mkdirSync(motionDir(work, motion), { recursive: true });
  writeFileSync(path.join(motionDir(work, motion), `${stage}-error.txt`), error instanceof Error ? error.message : String(error));
}

/** The first stage that failed for this motion, and why. */
export function failure(work: string, motion: PlannedMotion): { stage: Stage; error: string } | null {
  for (const stage of STAGES) {
    const error = stageError(work, motion, stage);
    if (error) return { stage, error };
  }
  return null;
}

export function readNarration(work: string, motion: PlannedMotion): Narration {
  return JSON.parse(readFileSync(path.join(motionDir(work, motion), "narration.json"), "utf8")) as Narration;
}

/** Stage 2: each planned motion's narration, read by `voice`. */
export async function narrateAll(work: string, voice: Voice): Promise<void> {
  for (const motion of readPlan(work)) {
    try {
      await narrate(scriptOf(motion), voice, motionDir(work, motion));
    } catch (error) {
      writeStageError(work, motion, "narrate", error);
    }
  }
}

export interface Rendered {
  duration: number;
  warnings: string[];
}

/** Stage 4: each captured motion's video, captions, transcript and poster, into `<id>/<locale>/out/`. */
export async function renderAll(work: string, renderVideo: (timeline: ReturnType<typeof motionTimeline>, dir: string, out: { video: string; poster: string }) => Promise<void>): Promise<void> {
  for (const motion of readPlan(work)) {
    if (failure(work, motion)) continue;
    const dir = motionDir(work, motion);
    try {
      const script = scriptOf(motion);
      const capture = JSON.parse(readFileSync(path.join(dir, "capture.json"), "utf8")) as Capture & { warnings?: string[] };
      const timeline = motionTimeline(script, readNarration(work, motion), capture);
      const out = path.join(dir, "out");
      mkdirSync(out, { recursive: true });
      writeFileSync(path.join(out, "captions.vtt"), webVtt(timeline));
      writeFileSync(path.join(out, "transcript.md"), motionTranscript(script));
      await renderVideo(timeline, dir, { video: path.join(out, "video.mp4"), poster: path.join(out, "poster.jpg") });
      const warnings = [...(capture.warnings ?? [])];
      if (timeline.duration < DURATION_RANGE.min || timeline.duration > DURATION_RANGE.max)
        warnings.push(`elle dure ${Math.round(timeline.duration)} s : une Explainer Video dure de ${DURATION_RANGE.min} à ${DURATION_RANGE.max} s`);
      writeFileSync(path.join(dir, "render.json"), JSON.stringify({ duration: timeline.duration, warnings } satisfies Rendered, null, 2));
    } catch (error) {
      writeStageError(work, motion, "render", error);
    }
  }
}

/** What happened to one motion in the run, for the summary. */
export interface MotionOutcome {
  id: string;
  locale: HelpLocale;
  hash: string;
  reason: PlannedMotion["reason"];
  status: "published" | "rendered" | "broken";
  /** Why it broke: the stage and its error. */
  failure?: { stage: Stage; error: string };
  /** What stays online when it broke, or what it replaced. */
  previous?: PublishedMotion;
  published?: PublishedMotion;
  duration?: number;
  warnings: string[];
}

/**
 * Stage 5: publishes each rendered motion to `bucket` (null: render only), then the manifest, which keeps the previous
 * version of every motion that broke. The local draft voice is never published.
 */
export async function publishAll(work: string, bucket: Bucket | null, now: Date = new Date()): Promise<{ outcomes: MotionOutcome[]; manifest: Manifest | null }> {
  const manifest = bucket ? await readManifest(bucket) : null;
  const outcomes: MotionOutcome[] = [];
  for (const motion of readPlan(work)) {
    const dir = motionDir(work, motion);
    const previous = manifest?.motions[motion.id]?.[motion.locale];
    const broke = failure(work, motion);
    if (broke) {
      outcomes.push({ ...base(motion), status: "broken", failure: broke, previous, warnings: [] });
      continue;
    }
    const rendered = JSON.parse(readFileSync(path.join(dir, "render.json"), "utf8")) as Rendered;
    const narration = readNarration(work, motion);
    const warnings = [...rendered.warnings];
    if (!bucket || !narration.publishable) {
      if (bucket) warnings.push(`lue par la voix de brouillon (${narration.provider}) : non publiée`);
      outcomes.push({ ...base(motion), status: "rendered", previous, duration: rendered.duration, warnings });
      continue;
    }
    try {
      const files = {
        video: motionFileKey(motion.id, motion.locale, motion.hash, "video"),
        captions: motionFileKey(motion.id, motion.locale, motion.hash, "captions"),
        transcript: motionFileKey(motion.id, motion.locale, motion.hash, "transcript"),
        poster: motionFileKey(motion.id, motion.locale, motion.hash, "poster"),
      };
      for (const key of Object.values(files)) await bucket.put(key, path.join(dir, "out", path.basename(key)), CONTENT_TYPES[path.extname(key)]!, IMMUTABLE);
      const published: PublishedMotion = { hash: motion.hash, duration: rendered.duration, renderedAt: now.toISOString(), voice: `${narration.provider}/${narration.voice}`, files };
      manifest!.motions[motion.id] = { ...manifest!.motions[motion.id], [motion.locale]: published };
      outcomes.push({ ...base(motion), status: "published", previous, published, duration: rendered.duration, warnings });
    } catch (error) {
      writeStageError(work, motion, "publish", error);
      outcomes.push({ ...base(motion), status: "broken", failure: { stage: "publish", error: String(error instanceof Error ? error.message : error) }, previous, warnings });
    }
  }
  if (bucket && manifest) {
    const file = path.join(work, MANIFEST_KEY);
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    await bucket.put(MANIFEST_KEY, file, CONTENT_TYPES[".json"]!, SHORT_LIVED);
  }
  return { outcomes, manifest };
}

function base(motion: PlannedMotion) {
  return { id: motion.id, locale: motion.locale, hash: motion.hash, reason: motion.reason };
}
