/**
 * Renders one Explainer Video with Remotion (ADR-0066): the « Motion » composition plays the Timeline over the capture
 * and the narration's audio, into `video.mp4` (H.264, AAC); `poster.jpg` is its title card. Licence: see README.md.
 *
 *   await renderMotion(timeline, dir);  // dir holds capture.webm and audio/, as the Timeline names them
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { FPS, INTRO_SECONDS, type Timeline } from "./timeline";

const entryPoint = path.join(path.dirname(fileURLToPath(import.meta.url)), "remotion", "index.ts");

/** One bundle per folder of assets: Remotion serves `dir` as its public folder (staticFile). */
export async function renderMotion(timeline: Timeline, dir: string, out: { video: string; poster: string }): Promise<void> {
  const serveUrl = await bundle({ entryPoint, publicDir: dir, enableCaching: false });
  const inputProps = { timeline };
  // A Chromium named by the environment (Playwright's, locally); Remotion downloads its own headless shell otherwise.
  const browserExecutable = process.env.MOTIONS_CHROMIUM ?? null;
  const composition = await selectComposition({ serveUrl, id: "Motion", inputProps, browserExecutable });
  await renderMedia({ composition, serveUrl, codec: "h264", audioCodec: "aac", outputLocation: out.video, inputProps, browserExecutable, crf: 23, pixelFormat: "yuv420p" });
  await renderStill({ composition, serveUrl, output: out.poster, frame: Math.round(INTRO_SECONDS * FPS * 0.6), imageFormat: "jpeg", jpegQuality: 85, inputProps, browserExecutable });
}
