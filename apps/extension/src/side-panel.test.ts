import type { JobOffer } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { createGuestSession, type SessionStorage } from "./guest-session";
import type { CapturedJobOffer } from "./job-page";
import type { JobbboxApi } from "./jobbbox-api";
import { createSidePanel, type SidePanelApi } from "./side-panel";

/** The browser's session storage (chrome.storage.session), in memory. */
function memoryStorage(): SessionStorage {
  const items: Record<string, unknown> = {};
  return {
    async get(key) {
      return key in items ? { [key]: structuredClone(items[key]) } : {};
    },
    async set(values) {
      Object.assign(items, structuredClone(values));
    },
    async remove(key) {
      delete items[key];
    },
  };
}

/** chrome.sidePanel as Chrome and Edge give it: what was asked of it, in order. */
function browserSidePanel({ refuseOpen = false } = {}) {
  const calls: string[] = [];
  const opened: Parameters<SidePanelApi["open"]>[0][] = [];
  let behavior: { openPanelOnActionClick?: boolean } = {};
  const sidePanel: SidePanelApi = {
    open(options) {
      calls.push("open");
      opened.push(options);
      // Chrome refuses open() outside a user gesture.
      return refuseOpen ? Promise.reject(new Error("`sidePanel.open()` may only be called in response to a user gesture.")) : Promise.resolve();
    },
    async setPanelBehavior(next) {
      behavior = { ...behavior, ...next };
    },
  };
  return { sidePanel, calls, opened, behavior: () => behavior };
}

/** Jobbbox's web app, answering a Capture when the test says so. */
function webApp() {
  let answer: (reply: Awaited<ReturnType<JobbboxApi["capture"]>>) => void = () => {};
  const calls: string[] = [];
  const api = {
    capture: () => {
      calls.push("capture");
      return new Promise<Awaited<ReturnType<JobbboxApi["capture"]>>>((resolve) => {
        answer = resolve;
      });
    },
  } as unknown as JobbboxApi;
  return { api, calls, accept: (jobOffer: JobOffer) => answer({ ok: true, jobOffer }), refuse: () => answer({ ok: false, error: "invalid" }) };
}

const posting: CapturedJobOffer = { source: { url: "https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon" }, title: "DAF H/F", content: "Poste de DAF à Lyon." };
const stored: JobOffer = { ...posting, id: "jo-1" };
const badgeTab = { id: 7, windowId: 3 };

function extension({ refuseOpen = false } = {}) {
  const browser = browserSidePanel({ refuseOpen });
  const web = webApp();
  const session = createGuestSession(memoryStorage());
  const panel = createSidePanel({ sidePanel: browser.sidePanel, api: web.api, session });
  return { browser, web, session, panel };
}

describe("the Side Panel (ADR-0054)", () => {
  it("opens from the toolbar icon, which has no popup", async () => {
    const { browser, panel } = extension();

    await panel.openOnToolbarIcon();

    expect(browser.behavior()).toEqual({ openPanelOnActionClick: true });
  });

  it("opens beside the posting from its badge at once, before Jobbbox has answered, while the click still counts", () => {
    const { browser, web, panel } = extension();

    void panel.capture(posting, badgeTab);

    expect(browser.opened).toEqual([{ tabId: 7 }]);
    expect(browser.calls).toEqual(["open"]);
    expect(web.calls).toEqual(["capture"]);
  });

  it("keeps the Job Offer captured from the badge in the Guest session, where the panel reads it", async () => {
    const { web, session, panel } = extension();

    const captured = panel.capture(posting, badgeTab);
    web.accept(stored);

    expect(await captured).toEqual({ ok: true });
    expect((await session.read()).jobOffer).toEqual(stored);
  });

  it("opens nothing more for a Capture asked from the panel itself", async () => {
    const { browser, web, session, panel } = extension();

    const captured = panel.capture(posting);
    web.accept(stored);

    expect(await captured).toEqual({ ok: true });
    expect(browser.opened).toEqual([]);
    expect((await session.read()).jobOffer).toEqual(stored);
  });

  it("keeps nothing when Jobbbox refuses the Capture, and says why", async () => {
    const { web, session, panel } = extension();

    const captured = panel.capture(posting, badgeTab);
    web.refuse();

    expect(await captured).toEqual({ ok: false, error: "invalid" });
    expect(await session.read()).toEqual({});
  });

  it("still captures the posting when the browser will not open the panel", async () => {
    const { web, session, panel } = extension({ refuseOpen: true });

    const captured = panel.capture(posting, badgeTab);
    web.accept(stored);

    expect(await captured).toEqual({ ok: true });
    expect((await session.read()).jobOffer).toEqual(stored);
  });
});
