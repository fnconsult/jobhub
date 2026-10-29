import { describe, expect, it } from "vitest";
import type { CapturedJobOffer } from "./job-page";
import { watchPostingInView, type PageInView, type Tabs } from "./posting-in-view";

type Listener<A extends unknown[]> = (...args: A) => void;
function event<A extends unknown[]>() {
  const listeners = new Set<Listener<A>>();
  return {
    addListener: (listener: Listener<A>) => void listeners.add(listener),
    removeListener: (listener: Listener<A>) => void listeners.delete(listener),
    fire: (...args: A) => listeners.forEach((listener) => listener(...args)),
    count: () => listeners.size,
  };
}

const offer = (title: string, url: string): CapturedJobOffer => ({ source: { url }, title, content: `${title}, à Lyon.` });
const daf = offer("DAF H/F", "https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon");
const controller = offer("Contrôleur de gestion H/F", "https://jobs.lever.co/doctolib/42");

/**
 * A browser window: its tabs, which one is active, and what each page reads as.
 * A tab's read can be held back, as a slow page's is.
 */
function browserWindow(windowId = 1) {
  const pages = new Map<number, PageInView | null>();
  const held = new Map<number, () => void>();
  let active = 1;
  const onActivated = event<[{ tabId: number; windowId: number }]>();
  const onUpdated = event<[number, { status?: string; url?: string }, { active?: boolean; windowId?: number }]>();
  const tabs: Tabs = {
    query: async () => [{ id: active }],
    onActivated,
    onUpdated,
  };
  const readTab = (tabId: number) =>
    new Promise<PageInView | null>((resolve) => {
      const answer = () => resolve(pages.get(tabId) ?? null);
      if (held.has(tabId)) held.set(tabId, answer);
      else answer();
    });
  return {
    tabs,
    readTab,
    windowId,
    show(tabId: number, page: PageInView | null) {
      pages.set(tabId, page);
    },
    activate(tabId: number, inWindow = windowId) {
      if (inWindow === windowId) active = tabId;
      onActivated.fire({ tabId, windowId: inWindow });
    },
    load(tabId: number, page: PageInView | null) {
      pages.set(tabId, page);
      onUpdated.fire(tabId, { status: "complete" }, { active: tabId === active, windowId });
    },
    holdRead: (tabId: number) => held.set(tabId, () => {}),
    releaseRead: (tabId: number) => {
      const answer = held.get(tabId);
      held.delete(tabId);
      answer?.();
    },
    listeners: () => onActivated.count() + onUpdated.count(),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function watch(window = browserWindow()) {
  const seen: (PageInView | null)[] = [];
  const stop = watchPostingInView({ tabs: window.tabs, windowId: window.windowId, readTab: window.readTab, onChange: (page) => seen.push(page) });
  return { window, seen, stop };
}

describe("the posting in view, which the Side Panel follows from tab to tab", () => {
  it("is read from the active tab when the panel opens", async () => {
    const window = browserWindow();
    window.show(1, { detected: true, jobOffer: daf });

    const { seen } = watch(window);
    await settle();

    expect(seen).toEqual([{ detected: true, jobOffer: daf }]);
  });

  it("follows the person to another tab, and back", async () => {
    const window = browserWindow();
    window.show(1, { detected: true, jobOffer: daf });
    window.show(2, { detected: true, jobOffer: controller });
    const { seen } = watch(window);
    await settle();

    window.activate(2);
    await settle();
    window.activate(1);
    await settle();

    expect(seen.map((page) => page?.jobOffer.title)).toEqual(["DAF H/F", "Contrôleur de gestion H/F", "DAF H/F"]);
  });

  it("follows a page loaded in the active tab, and says when it holds no posting", async () => {
    const { window, seen } = watch();
    await settle();

    window.load(1, { detected: true, jobOffer: daf });
    await settle();
    window.load(1, null);
    await settle();

    expect(seen).toEqual([null, { detected: true, jobOffer: daf }, null]);
  });

  it("is not told again of the same posting, as a page that loads more of itself would", async () => {
    const window = browserWindow();
    window.show(1, { detected: true, jobOffer: daf });
    const { seen } = watch(window);
    await settle();

    window.load(1, { detected: true, jobOffer: { ...daf, content: "Plus de texte." } });
    await settle();

    expect(seen).toHaveLength(1);
  });

  it("ignores pages loading in the background and tabs of other windows", async () => {
    const { window, seen } = watch();
    await settle();

    window.load(5, { detected: true, jobOffer: controller });
    window.activate(9, 2);
    await settle();

    expect(seen).toEqual([null]);
  });

  it("keeps the latest tab's posting when a slower read of the tab left before comes back after it", async () => {
    const window = browserWindow();
    window.show(1, { detected: true, jobOffer: daf });
    window.show(2, { detected: true, jobOffer: controller });
    window.holdRead(1);
    const { seen } = watch(window);

    window.activate(2);
    await settle();
    window.releaseRead(1);
    await settle();

    expect(seen.map((page) => page?.jobOffer.title)).toEqual(["Contrôleur de gestion H/F"]);
  });

  it("stops following once the panel lets go", async () => {
    const { window, stop } = watch();
    await settle();

    stop();

    expect(window.listeners()).toBe(0);
  });
});
