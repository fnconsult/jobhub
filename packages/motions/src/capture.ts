/**
 * Films one Motion Script in one language: Playwright plays its capture actions on the demo data, at desktop width,
 * holding each step at least as long as its narration, and records the screen (`capture.webm`) with each step's start,
 * end and zoom (`capture.json`). A step whose element is missing stops the capture with a `CaptureError` naming it: the
 * `motions` workflow then keeps the previous video and warns (ADR-0066).
 *
 *   const capture = await captureMotion({ browser, script, baseURL, dir, durations, storageState });
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, Locator, Page } from "@playwright/test";
import { routeMatches, type MotionAction, type MotionScript, type MotionTarget } from "@jobhub/help";
import type { Box, Capture } from "./timeline";

/** Desktop width (ADR-0066), 16:9. */
export const CAPTURE_SIZE = { width: 1280, height: 720 } as const;
/** How long an action may wait for its element before the capture is called broken. */
export const ACTION_TIMEOUT = 10_000;

/** A capture that could not play a step: its element is missing, or a page did not load. */
export class CaptureError extends Error {
  override name = "CaptureError";
  constructor(
    readonly step: number,
    readonly stepTitle: string,
    readonly detail: string,
  ) {
    super(`étape ${step + 1} « ${stepTitle} » : ${detail}`);
  }
}

export interface CaptureOptions {
  browser: Browser;
  script: MotionScript;
  baseURL: string;
  /** Where capture.webm and capture.json are written. */
  dir: string;
  /** The least time each step stays on screen, in ms: its narration (`stepDurations`). */
  durations: readonly number[];
  /** The demo Candidate's signed-in session, for a `candidate` script. */
  storageState?: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>>;
  /** Milliseconds per typed character, and the pause before a click: slow enough to follow. */
  typingDelay?: number;
  pointerPause?: number;
}

export async function captureMotion(options: CaptureOptions): Promise<Capture & { warnings: string[] }> {
  const { browser, script, baseURL, dir, durations, typingDelay = 70, pointerPause = 450 } = options;
  mkdirSync(dir, { recursive: true });
  const raw = path.join(dir, "raw");
  const context = await browser.newContext({
    baseURL,
    viewport: CAPTURE_SIZE,
    recordVideo: { dir: raw, size: CAPTURE_SIZE },
    locale: script.locale === "fr" ? "fr-FR" : "en-GB",
    timezoneId: "Europe/Paris",
    colorScheme: "light",
    storageState: options.storageState,
  });
  await context.addInitScript(POINTER_SCRIPT);
  const page = await context.newPage();
  const recordingStart = Date.now();
  const now = () => Date.now() - recordingStart;
  const visited: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && /^https?:/.test(frame.url())) visited.push(new URL(frame.url()).pathname);
  });

  const steps: Capture["steps"] = [];
  let zoom: Box | null = null;
  try {
    for (const [index, step] of script.steps.entries()) {
      const start = now();
      for (const action of step.actions) {
        try {
          zoom = await play(page, action, zoom, { typingDelay, pointerPause });
        } catch (error) {
          throw new CaptureError(index, step.title, `${describe(action)}: ${firstLine(error)}`);
        }
      }
      const rest = start + (durations[index] ?? 0) - now();
      if (rest > 0) await page.waitForTimeout(rest);
      steps.push({ start, end: now(), zoom });
    }
  } catch (error) {
    await context.close();
    rmSync(raw, { recursive: true, force: true });
    throw error;
  }
  const video = page.video();
  await context.close();
  renameSync(await video!.path(), path.join(dir, "capture.webm"));
  rmSync(raw, { recursive: true, force: true });

  const capture: Capture = { video: "capture.webm", ...CAPTURE_SIZE, steps, visited: [...new Set(visited)] };
  const warnings = capture.visited
    .filter((pathname) => !script.routes.some((route) => routeMatches(route, pathname)))
    .map((pathname) => `la capture est passée par ${pathname}, que ses routes ne déclarent pas`);
  writeFileSync(path.join(dir, "capture.json"), JSON.stringify({ ...capture, warnings }, null, 2));
  return { ...capture, warnings };
}

async function play(page: Page, action: MotionAction, zoom: Box | null, pace: { typingDelay: number; pointerPause: number }): Promise<Box | null> {
  switch (action.action) {
    case "goto":
      await page.goto(action.path, { timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: ACTION_TIMEOUT }).catch(() => {});
      return zoom;
    case "click":
    case "hover": {
      const element = locate(page, action.target);
      await pointAt(page, element, pace.pointerPause);
      if (action.action === "click") {
        await element.click({ timeout: ACTION_TIMEOUT });
        await page.waitForLoadState("networkidle", { timeout: ACTION_TIMEOUT }).catch(() => {});
      }
      return zoom;
    }
    case "fill": {
      const element = locate(page, action.target);
      await pointAt(page, element, pace.pointerPause);
      await element.click({ timeout: ACTION_TIMEOUT });
      await element.fill("");
      await element.pressSequentially(action.text, { delay: pace.typingDelay });
      return zoom;
    }
    case "press":
      await page.keyboard.press(action.key);
      await page.waitForLoadState("networkidle", { timeout: ACTION_TIMEOUT }).catch(() => {});
      return zoom;
    case "scroll":
      await locate(page, action.target).scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT });
      return zoom;
    case "zoom": {
      if (!action.target) return null;
      const box = await locate(page, action.target).boundingBox({ timeout: ACTION_TIMEOUT });
      if (!box) throw new Error("the element to zoom on is not on screen");
      return box;
    }
  }
}

/** The element a target names; a missing one makes the action fail after ACTION_TIMEOUT. */
export function locate(page: Page, target: MotionTarget): Locator {
  const found =
    target.by === "label"
      ? page.getByLabel(target.text, { exact: true })
      : target.by === "text"
        ? page.getByText(target.text, { exact: true })
        : page.getByRole(target.role, target.name === null ? undefined : { name: target.name, exact: true });
  return found.first();
}

/** Moves the visible pointer to the element, slowly, and pauses: the viewer sees where the click lands. */
async function pointAt(page: Page, element: Locator, pause: number): Promise<void> {
  await element.waitFor({ state: "visible", timeout: ACTION_TIMEOUT });
  await element.scrollIntoViewIfNeeded();
  const box = await element.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await page.waitForTimeout(pause);
}

function describe(action: MotionAction): string {
  if (action.action === "goto") return `goto ${action.path}`;
  if (action.action === "press") return `press ${action.key}`;
  const target = action.target;
  const named = target === null ? "off" : target.by === "role" ? `${target.role}${target.name === null ? "" : ` "${target.name}"`}` : `${target.by} "${target.text}"`;
  return `${action.action} ${named}`;
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0]!;
}

/**
 * A large pointer drawn in the page (a recording shows none), following the mouse, with a ring on each click. Hidden
 * from assistive technologies; it never takes a click.
 */
const POINTER_SCRIPT = `(() => {
  const draw = () => {
    if (document.getElementById("motions-pointer")) return;
    const pointer = document.createElement("div");
    pointer.id = "motions-pointer";
    pointer.setAttribute("aria-hidden", "true");
    pointer.style.cssText = "position:fixed;left:0;top:0;width:32px;height:32px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:transform 40ms linear";
    pointer.innerHTML = '<svg width="32" height="32" viewBox="0 0 32 32"><path d="M4 2 L4 26 L10 20 L15 30 L19 28 L14 18 L23 18 Z" fill="#111" stroke="#fff" stroke-width="2"/></svg>';
    document.documentElement.appendChild(pointer);
    document.addEventListener("mousemove", (event) => { pointer.style.transform = "translate(" + (event.clientX - 4) + "px," + (event.clientY - 2) + "px)"; }, true);
    document.addEventListener("mousedown", (event) => {
      const ring = document.createElement("div");
      ring.setAttribute("aria-hidden", "true");
      ring.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;width:44px;height:44px;border-radius:50%;border:4px solid #2563eb;left:" + (event.clientX - 22) + "px;top:" + (event.clientY - 22) + "px;opacity:0.9;transition:transform 500ms ease-out,opacity 500ms ease-out";
      document.documentElement.appendChild(ring);
      requestAnimationFrame(() => { ring.style.transform = "scale(1.6)"; ring.style.opacity = "0"; });
      setTimeout(() => ring.remove(), 600);
    }, true);
  };
  if (document.documentElement) draw(); else document.addEventListener("DOMContentLoaded", draw);
})();`;
