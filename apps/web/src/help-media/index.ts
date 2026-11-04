/**
 * The Help Centre's Explainer Videos (ADR-0066, #568), as the web app plays them: from the origin of the Scaleway bucket
 * (HELP_MEDIA_ORIGIN, a Platform Setting, https://media.jobbbox.ai by default), whose `manifest.json`, written by the
 * `motions` workflow (`packages/motions`), names the render each script shows in each language. Nothing here reads the
 * network: `server.ts` fetches and caches the manifest.
 *
 *   const origin = helpMediaOrigin(settings);                    // "https://media.jobbbox.ai"
 *   contentSecurityPolicy(origin);                               // "media-src https://media.jobbbox.ai"
 *   const video = publishedVideo(manifest, "retrouver-une-candidature", "fr", origin);   // its URLs and duration, or null
 *   videoDuration(video.duration);                               // "1 min 05 s"
 */
import { MOTION_MEDIA_ORIGIN, plainNarration, type MotionScript } from "@jobhub/help/motion-scripts";
import { parseSetting, platformSetting } from "../platform-settings/catalog";
import type { PlatformSettingsSnapshot } from "../platform-settings/resolver";

export { isoDuration, VIDEO_ANCHOR, videoDuration } from "./format";

type Locale = "fr" | "en";

/** The bucket's origin in use: the Back Office's, else env's, else https://media.jobbbox.ai; the default when one is refused. */
export function helpMediaOrigin(settings: Pick<PlatformSettingsSnapshot, "setting">): string {
  const value = settings.setting("HELP_MEDIA_ORIGIN")?.value;
  const parsed = value ? parseSetting(platformSetting("HELP_MEDIA_ORIGIN")!, value) : null;
  return parsed?.ok ? String(parsed.value) : MOTION_MEDIA_ORIGIN;
}

/**
 * The Content-Security-Policy every answer carries: media (the `<video>` and its `<track>`) only from the bucket's
 * origin, nothing else (#568). The poster is an image: `img-src` is not restricted, nor is anything else yet.
 */
export function contentSecurityPolicy(origin: string): string {
  return `media-src ${origin}`;
}

/** One render of one script in one language, as the manifest names it (`PublishedMotion` in packages/motions). */
export interface ManifestEntry {
  hash: string;
  duration: number;
  files: { video: string; captions: string; transcript: string; poster: string };
}

/** The manifest's motions, by script and language; entries the app cannot use left out. */
export type MotionManifest = Record<string, Partial<Record<Locale, ManifestEntry>>>;

/** A bucket key the motions workflow writes: `<id>/<locale>/<hash>/<render>/<file>`, nothing that leaves the bucket. */
const KEY = /^[a-z0-9][a-z0-9-]*\/(?:fr|en)\/[0-9a-f]+\/[0-9A-Z]+\/(?:video\.mp4|captions\.vtt|transcript\.md|poster\.jpg)$/;

/** The manifest's JSON as the app uses it: an entry with a missing or odd field is no video. */
export function parseManifest(json: unknown): MotionManifest {
  const motions = (json as { motions?: unknown } | null)?.motions;
  const manifest: MotionManifest = {};
  if (!motions || typeof motions !== "object") return manifest;
  for (const [id, locales] of Object.entries(motions as Record<string, unknown>)) {
    if (!locales || typeof locales !== "object") continue;
    for (const locale of ["fr", "en"] as const) {
      const entry = (locales as Record<string, unknown>)[locale] as Partial<ManifestEntry> | undefined;
      const files = entry?.files;
      const usable =
        entry &&
        typeof entry.hash === "string" &&
        typeof entry.duration === "number" &&
        Number.isFinite(entry.duration) &&
        entry.duration > 0 &&
        files &&
        (["video", "captions", "transcript", "poster"] as const).every((file) => typeof files[file] === "string" && KEY.test(files[file]));
      if (!usable) continue;
      manifest[id] = { ...manifest[id], [locale]: { hash: entry.hash!, duration: entry.duration!, files: { ...files! } } };
    }
  }
  return manifest;
}

/** A published Explainer Video, ready for the player: its files' addresses on the bucket's origin, and its duration. */
export interface PublishedVideo {
  id: string;
  locale: Locale;
  hash: string;
  /** Seconds. */
  duration: number;
  video: string;
  captions: string;
  transcript: string;
  poster: string;
}

/** The video of script `id` in `locale`, or null when none is published in that language: no player, no gap (#568). */
export function publishedVideo(manifest: MotionManifest, id: string, locale: Locale, origin: string): PublishedVideo | null {
  const entry = manifest[id]?.[locale];
  if (!entry) return null;
  const at = (key: string) => `${origin.replace(/\/$/, "")}/${key}`;
  return {
    id,
    locale,
    hash: entry.hash,
    duration: entry.duration,
    video: at(entry.files.video),
    captions: at(entry.files.captions),
    transcript: at(entry.files.transcript),
    poster: at(entry.files.poster),
  };
}

/** Each published script's duration in `locale`, in seconds: what the Coach Panel's « Voir la vidéo (durée) » needs. */
export function publishedDurations(manifest: MotionManifest, locale: Locale): Record<string, number> {
  return Object.fromEntries(Object.entries(manifest).flatMap(([id, locales]) => (locales[locale] ? [[id, locales[locale]!.duration]] : [])));
}

/** A transcript's steps: each step's title and its narration's paragraphs. */
export type TranscriptStep = { title: string; paragraphs: string[] };

/** The steps of the Motion Script in the repo: the transcript of a video rendered from this very text (same hash). */
export function transcriptOfScript(script: Pick<MotionScript, "steps">): TranscriptStep[] {
  return script.steps.map((step) => ({ title: step.title, paragraphs: paragraphsOf(step.narration) }));
}

/**
 * The steps of a published `transcript.md` (`motionTranscript` in @jobhub/help): `# title`, the « Voix de synthèse »
 * line, then `## step` and its narration. Read when the video was rendered from an older text than the repo's, so the
 * transcript always says what the video says.
 */
export function transcriptOfMarkdown(markdown: string): TranscriptStep[] {
  const steps: TranscriptStep[] = [];
  for (const part of markdown.replace(/\r\n/g, "\n").split(/^## /m).slice(1)) {
    const [title = "", ...body] = part.split("\n");
    if (title.trim()) steps.push({ title: title.trim(), paragraphs: paragraphsOf(body.join("\n")) });
  }
  return steps;
}

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map(plainNarration)
    .filter(Boolean);
}
