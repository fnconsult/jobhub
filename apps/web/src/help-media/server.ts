import { motionScript, type HelpArticle } from "@jobhub/help";
import { currentHelpMediaOrigin } from "./origin";
import { parseManifest, publishedVideo, transcriptOfMarkdown, transcriptOfScript, type MotionManifest, type PublishedVideo, type TranscriptStep } from ".";

/** How long a manifest read is used before it is read again: the bucket caches it 60 s too (packages/motions). */
const MANIFEST_TTL_MS = 60_000;
/** How long a page waits for the bucket: past it, the Tutorial shows without its video, and is read again next time. */
const FETCH_TIMEOUT_MS = 2_000;

// On globalThis, like the Platform Settings: Next.js bundles server code into several chunks, one cache must serve them.
const holder = globalThis as { __jobhubHelpMedia?: { manifests: Map<string, { at: number; manifest: MotionManifest }>; transcripts: Map<string, TranscriptStep[]> } };
const cache = () => (holder.__jobhubHelpMedia ??= { manifests: new Map(), transcripts: new Map() });

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

/**
 * The manifest of the bucket at `origin`, read by the server (never by the viewer's browser), at most once a minute. A
 * read that fails keeps the last one; with none, no video is published, and the Help Centre shows the Tutorials alone.
 */
export async function motionManifest(origin = currentHelpMediaOrigin(), now = Date.now()): Promise<MotionManifest> {
  const known = cache().manifests.get(origin);
  if (known && now - known.at < MANIFEST_TTL_MS) return known.manifest;
  const text = await fetchText(`${origin}/manifest.json`);
  let manifest: MotionManifest | null = null;
  if (text !== null) {
    try {
      manifest = parseManifest(JSON.parse(text));
    } catch {
      manifest = null;
    }
  }
  const kept = manifest ?? known?.manifest ?? {};
  cache().manifests.set(origin, { at: now, manifest: kept });
  return kept;
}

/** A Tutorial's Explainer Video in its language, and its transcript; null when the Tutorial has none published. */
export interface TutorialVideo {
  video: PublishedVideo;
  title: string;
  transcript: TranscriptStep[];
}

/**
 * The video of `article` (a Tutorial with a `motion`), in the article's language, with its descriptive transcript: the
 * Motion Script's own steps when the video was rendered from the text in the repo (same hash), else the transcript
 * published with it, so the transcript always says what the video says; the repo's text if that cannot be read.
 */
export async function tutorialVideo(article: Pick<HelpArticle, "motion" | "locale">): Promise<TutorialVideo | null> {
  if (!article.motion) return null;
  const script = motionScript(article.motion, article.locale);
  if (!script) return null;
  const origin = currentHelpMediaOrigin();
  const video = publishedVideo(await motionManifest(origin), article.motion, article.locale, origin);
  if (!video) return null;
  if (video.hash === script.hash) return { video, title: script.title, transcript: transcriptOfScript(script) };
  const transcripts = cache().transcripts;
  let published = transcripts.get(video.transcript);
  if (!published) {
    const markdown = await fetchText(video.transcript);
    const steps = markdown ? transcriptOfMarkdown(markdown) : [];
    // A published file never changes (its folder is its render): kept for good once read.
    if (steps.length > 0) transcripts.set(video.transcript, (published = steps));
  }
  return { video, title: script.title, transcript: published ?? transcriptOfScript(script) };
}
