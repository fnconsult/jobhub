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
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { routeMatches, type MotionAction, type MotionDemoFile, type MotionScript, type MotionTarget } from "@jobhub/help";
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
  /** What the capture needs beyond the web app, given by the capture stage (e2e/motions.spec.ts). */
  services?: CaptureServices;
}

/** A file given to a file input, as Playwright takes it. */
export interface DemoFilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/**
 * What a capture uses outside the page it films (#570). Each comes from the capture stage, which runs the app: the
 * scripts stay plain text, and the tooling here never reads the app's mailbox nor signs Stripe's events itself.
 */
export interface CaptureServices {
  /** The demo files an `upload` gives (`MOTION_DEMO_FILES`). */
  files?: Partial<Record<MotionDemoFile, DemoFilePayload>>;
  /** `open-email`: the HTML of the last email `address` received with `subject`, as a mail client shows it. */
  email?: (address: string, subject: string) => Promise<string>;
  /**
   * `pay`: clicks `submit` (« Passer au paiement »), pays in Stripe's test mode and leaves `page` where Stripe sends the
   * Candidate back. The payment page itself is Stripe's, outside the app.
   */
  pay?: (page: Page, submit: Locator) => Promise<void>;
  /** A `guest` script's browser: the built extension, and the invented job offer `goto @offre-de-demo` opens. */
  extension?: { dir: string; id: string; jobOffer: { url: string; html: string } };
}

/** The width of the extension's Side Panel beside the page, as Chrome shows it. */
export const SIDE_PANEL_WIDTH = 400;

export async function captureMotion(options: CaptureOptions): Promise<Capture & { warnings: string[] }> {
  const { browser, script, baseURL, dir, durations, typingDelay = 70, pointerPause = 450, services = {} } = options;
  mkdirSync(dir, { recursive: true });
  const raw = path.join(dir, "raw");
  const locale = script.locale === "fr" ? "fr-FR" : "en-GB";
  const settings = { baseURL, viewport: CAPTURE_SIZE, recordVideo: { dir: raw, size: CAPTURE_SIZE }, locale, timezoneId: "Europe/Paris", colorScheme: "light" as const };
  let context: BrowserContext;
  let page: Page;
  if (script.viewer === "guest") {
    // The extension loads only in a persistent context of Playwright's Chromium; its pages speak the browser's language.
    const extension = services.extension;
    if (!extension) throw new CaptureError(0, script.steps[0]!.title, "a guest script needs the built extension (services.extension)");
    context = await chromium.launchPersistentContext("", {
      ...settings,
      channel: "chromium",
      args: [`--disable-extensions-except=${extension.dir}`, `--load-extension=${extension.dir}`, `--lang=${locale}`],
    });
    await context.route(extension.jobOffer.url, (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: extension.jobOffer.html }));
    await context.addInitScript(POINTER_SCRIPT);
    page = context.pages()[0] ?? (await context.newPage());
  } else {
    context = await browser.newContext({ ...settings, storageState: options.storageState });
    await context.addInitScript(POINTER_SCRIPT);
    page = await context.newPage();
  }
  // Every wait of an action gives up in time: a step that cannot play breaks, it never hangs the run.
  page.setDefaultTimeout(ACTION_TIMEOUT);
  const recordingStart = Date.now();
  const now = () => Date.now() - recordingStart;
  const visited: string[] = [];
  const webOrigin = new URL(baseURL).origin;
  page.on("framenavigated", (frame) => {
    // The web app's pages only: a Guest's job offer and the extension's panel are no routes of it.
    if (frame === page.mainFrame() && frame.url().startsWith(webOrigin)) visited.push(new URL(frame.url()).pathname);
  });
  const state: PlayState = { zoom: null, address: null, backdrop: null, framing: false, services, pace: { typingDelay, pointerPause } };

  const steps: Capture["steps"] = [];
  try {
    for (const [index, step] of script.steps.entries()) {
      const start = now();
      for (const action of step.actions) {
        try {
          await play(page, action, state);
        } catch (error) {
          // What the page showed when the step broke, beside the error: the element's new name is usually there.
          await page.screenshot({ path: path.join(dir, "capture-failure.png") }).catch(() => {});
          await page.locator("body").ariaSnapshot().then((tree) => writeFileSync(path.join(dir, "capture-failure.aria.txt"), tree)).catch(() => {});
          throw new CaptureError(index, step.title, `${describe(action)}: ${firstLine(error)}`);
        }
      }
      const rest = start + (durations[index] ?? 0) - now();
      if (rest > 0) await page.waitForTimeout(rest);
      steps.push({ start, end: now(), zoom: state.zoom });
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

/** What the actions of a capture share as it plays: the zoom, the address last typed, the offer behind the Side Panel. */
interface PlayState {
  zoom: Box | null;
  /** The last email address a `fill` typed: whom `open-email` reads the mail of. */
  address: string | null;
  /** The job offer as last filmed (PNG, base64), drawn behind the extension's panel. */
  backdrop: string | null;
  /** Whether the filmed page already frames each load of the panel. */
  framing: boolean;
  services: CaptureServices;
  pace: { typingDelay: number; pointerPause: number };
}

const settle = (page: Page) => page.waitForLoadState("networkidle", { timeout: ACTION_TIMEOUT }).catch(() => {});

async function play(page: Page, action: MotionAction, state: PlayState): Promise<void> {
  const { pace, services } = state;
  switch (action.action) {
    case "goto":
      if ("page" in action) return gotoExtensionPage(page, action.page, state);
      await page.goto(action.path, { timeout: 30_000 });
      return settle(page);
    case "click":
    case "hover": {
      const element = locate(page, action.target);
      await pointAt(page, element, pace.pointerPause);
      if (action.action === "click") await clickInPlace(page, element);
      return;
    }
    case "fill": {
      const element = locate(page, action.target);
      await pointAt(page, element, pace.pointerPause);
      await element.click({ timeout: ACTION_TIMEOUT });
      // A date or a time is typed in the browser's own format: the script gives it as the field's value (2027-03-16T10:00).
      if (/^(date|datetime-local|time|month)$/.test((await element.getAttribute("type")) ?? "")) await element.fill(action.text);
      else {
        await element.fill("");
        await element.pressSequentially(action.text, { delay: pace.typingDelay });
      }
      if (/^[^\s@]+@[^\s@]+$/.test(action.text)) state.address = action.text;
      return;
    }
    case "select": {
      const element = locate(page, action.target);
      await pointAt(page, element, pace.pointerPause);
      await element.selectOption({ label: action.option }, { timeout: ACTION_TIMEOUT });
      return settle(page);
    }
    case "upload": {
      const file = services.files?.[action.file];
      if (!file) throw new Error(`no demo file ${action.file}`);
      const element = locate(page, action.target);
      await element.setInputFiles(file, { timeout: ACTION_TIMEOUT });
      return settle(page);
    }
    case "open-email": {
      if (!services.email) throw new Error("this capture reads no mailbox (services.email)");
      if (!state.address) throw new Error("no email address was typed before");
      // The email as a mail client shows it, in the filmed page: its link then leads back to the app.
      await page.setContent(await services.email(state.address, action.subject), { timeout: ACTION_TIMEOUT });
      return;
    }
    case "pay": {
      if (!services.pay) throw new Error("this capture pays nothing (services.pay)");
      const element = locate(page, action.target);
      await pointAt(page, element, pace.pointerPause);
      await services.pay(page, element);
      return settle(page);
    }
    case "press":
      await page.keyboard.press(action.key);
      return settle(page);
    case "scroll":
      await locate(page, action.target).scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT });
      return;
    case "zoom": {
      if (!action.target) {
        state.zoom = null;
        return;
      }
      const box = await locate(page, action.target).boundingBox({ timeout: ACTION_TIMEOUT });
      if (!box) throw new Error("the element to zoom on is not on screen");
      state.zoom = box;
      return;
    }
  }
}

/**
 * Clicks, and follows a link that opens a new tab (the extension's « Créer mon compte et garder cette offre ») in the
 * filmed page: a recording holds one tab.
 */
async function clickInPlace(page: Page, element: Locator): Promise<void> {
  const opened = page.context().waitForEvent("page", { timeout: 2_000 }).catch(() => null);
  await element.click({ timeout: ACTION_TIMEOUT });
  const tab = await opened;
  if (tab) {
    await tab.waitForURL(/^(?!about:blank)/, { timeout: ACTION_TIMEOUT }).catch(() => {});
    const url = tab.url();
    await tab.close();
    if (url && url !== "about:blank") await page.goto(url, { timeout: 30_000 });
  }
  await settle(page);
}

/**
 * A Guest's pages outside the web app: the invented job offer, or the extension's Side Panel. Chrome draws the panel
 * beside the page, where no recording reaches; the capture shows the panel's own page at the panel's width, the offer
 * as last filmed behind it, as the Guest sees them side by side.
 */
async function gotoExtensionPage(page: Page, target: "@offre-de-demo" | "@panneau-extension", state: PlayState): Promise<void> {
  const extension = state.services.extension!;
  if (target === "@offre-de-demo") {
    await page.goto(extension.jobOffer.url, { timeout: 30_000 });
    return settle(page);
  }
  if (page.url() === extension.jobOffer.url) {
    state.backdrop = (await page.screenshot({ type: "png" })).toString("base64");
    // The badge opened the browser's own panel, which no recording shows: closed, so only the filmed one acts.
    await page.waitForTimeout(1_500);
    await closeSidePanels(page.context());
  }
  const panel = `chrome-extension://${extension.id}/sidepanel.html`;
  const frame = async () => {
    if (!page.url().startsWith(panel)) return;
    await page.addStyleTag({ content: sidePanelFrame(state.backdrop) }).catch(() => {});
  };
  if (!state.framing) page.on("load", () => void frame());
  state.framing = true;
  await page.goto(panel, { timeout: 30_000 });
  await frame();
  await settle(page);
}

/** The panel at Chrome's width on the right, the offer behind it on the left. */
function sidePanelFrame(backdrop: string | null): string {
  const behind = backdrop ? `url(data:image/png;base64,${backdrop}) left top / auto 100% no-repeat` : "#f3f4f6";
  return `html { background: ${behind} !important; min-height: 100%; }
    body { width: ${SIDE_PANEL_WIDTH}px; margin: 0 0 0 auto !important; min-height: 100vh; box-sizing: border-box;
      background: Canvas; border-left: 1px solid #d1d5db; box-shadow: -6px 0 18px rgb(0 0 0 / 12%); }`;
}

async function closeSidePanels(context: BrowserContext): Promise<void> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: ACTION_TIMEOUT }));
  await worker.evaluate(async () => {
    type Chrome = {
      sidePanel: { close(options: { windowId: number } | { tabId: number }): Promise<void> };
      windows: { getAll(options: { populate: boolean }): Promise<{ id: number; tabs?: { id: number }[] }[]> };
    };
    const { sidePanel, windows } = (globalThis as unknown as { chrome: Chrome }).chrome;
    for (const { id, tabs } of await windows.getAll({ populate: true })) {
      await sidePanel.close({ windowId: id }).catch(() => {});
      for (const tab of tabs ?? []) await sidePanel.close({ tabId: tab.id }).catch(() => {});
    }
  });
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
  if (action.action === "goto") return `goto ${"page" in action ? action.page : action.path}`;
  if (action.action === "press") return `press ${action.key}`;
  if (action.action === "open-email") return `open-email "${action.subject}"`;
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
