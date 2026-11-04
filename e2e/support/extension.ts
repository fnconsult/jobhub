import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext } from "@playwright/test";

/** Built by the extension spec, and the motions' captures (#570), against the e2e web server (`wxt build --mode e2e`). */
export const e2eExtensionDir = path.join(realpathSync("apps/extension"), ".output/chrome-mv3-e2e");

/**
 * Builds the extension against the e2e web server, whose EXTENSION_ORIGINS trusts exactly this build: once per run of
 * the suite (E2E_RUN_ID, playwright.config.ts), whichever spec asks first. The extension's specs and the motions'
 * captures (#570) run in parallel workers: a lock keeps one from rebuilding the files the other's browser has loaded.
 */
export function buildE2eExtension(): void {
  const lock = `${e2eExtensionDir}.lock`;
  const marker = path.join(e2eExtensionDir, ".e2e-run");
  const run = process.env.E2E_RUN_ID ?? String(process.pid);
  mkdirSync(path.dirname(lock), { recursive: true });
  const until = Date.now() + 5 * 60_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (Date.now() > until) throw new Error(`${lock} has been held for 5 minutes: remove it if no build is running`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  try {
    if (existsSync(marker) && readFileSync(marker, "utf8") === run) return;
    execFileSync("npx", ["wxt", "build", "--mode", "e2e"], {
      cwd: "apps/extension",
      env: { ...process.env, WXT_WEB_ORIGIN: process.env.E2E_WEB_ORIGIN! },
      stdio: "pipe",
    });
    writeFileSync(marker, run);
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Chromium derives an unpacked extension's id from the SHA-256 of its absolute path. */
export function unpackedExtensionId(dir: string): string {
  const hex = createHash("sha256").update(dir).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16))).join("");
}

/** A request the browser's Side Panel made, as CDP reports it. */
export type SidePanelRequest = { url: string; method: string; postData?: string };

type TargetInfo = { targetId: string; type: string; url: string; attached: boolean };

/**
 * The browser's Side Panel, which Playwright neither attaches nor reports (ADR-0054): no Page, no request event.
 * Attached over CDP as it opens, its requests are reported, so a test counting what the extension asks for
 * counts the panel's too, and `settled` tells when it has done what it does on opening.
 */
export async function watchSidePanel(context: BrowserContext, extensionId: string) {
  const cdp = await context.browser()!.newBrowserCDPSession();
  const listeners = new Set<(request: SidePanelRequest) => void>();
  const targets = new Set<string>();
  const inFlight = new Set<string>();
  let loaded = false;
  let expecting = false;
  let lastActivity = Date.now();

  // Playwright routes no session of its CDP connection but its own: the panel's is attached without `flatten`,
  // its messages passed through this browser session.
  async function attach(targetId: string) {
    targets.add(targetId);
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: false });
    const send = (id: number, method: string, params: object = {}) =>
      cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) });
    await send(1, "Network.enable");
    await send(2, "Page.enable");
    // Loaded before Page.enable, its load event has gone: its document says so.
    await send(3, "Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
  }
  cdp.on("Target.receivedMessageFromTarget", ({ sessionId, message }) => {
    const { id, method, params, result } = JSON.parse(message) as {
      id?: number; method?: string; params?: { requestId: string; request: SidePanelRequest }; result?: { result?: { value?: unknown } };
    };
    lastActivity = Date.now();
    const key = (requestId: string) => `${sessionId}:${requestId}`;
    if (id === 3 && result?.result?.value === "complete") loaded = true;
    if (method === "Page.loadEventFired") loaded = true;
    if (method === "Network.requestWillBeSent") {
      const { requestId, request } = params!;
      inFlight.add(key(requestId));
      for (const listener of listeners) listener(request);
    }
    if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
      inFlight.delete(key(params!.requestId));
    }
  });
  // Its requests end with it: one closed mid-flight is answered to nobody.
  cdp.on("Target.detachedFromTarget", ({ sessionId }) => {
    for (const request of inFlight) if (request.startsWith(`${sessionId}:`)) inFlight.delete(request);
  });
  // The Side Panel's page is a target Playwright leaves unattached; a tab showing the same page is one Playwright attaches.
  const panelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  const onTarget = ({ targetInfo }: { targetInfo: TargetInfo }) => {
    if (!expecting || targets.has(targetInfo.targetId) || targetInfo.attached) return;
    if (targetInfo.type === "page" && targetInfo.url.startsWith(panelUrl)) void attach(targetInfo.targetId);
  };
  cdp.on("Target.targetCreated", onTarget);
  cdp.on("Target.targetInfoChanged", onTarget);
  await cdp.send("Target.setDiscoverTargets", { discover: true });

  return {
    /** Attaches the Side Panel that opens from now on (the badge's, say). */
    expectOpening() {
      expecting = true;
      loaded = false;
    },
    /** Whether the Side Panel expected has loaded and has asked for nothing for `quietMs`, every request answered. */
    settled(quietMs = 1_000) {
      const done = loaded && inFlight.size === 0 && Date.now() - lastActivity >= quietMs;
      if (done) expecting = false;
      return done;
    },
    /** Calls `listener` with every request a Side Panel attached makes, until the returned function is called. */
    onRequest(listener: (request: SidePanelRequest) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
