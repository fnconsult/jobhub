/**
 * The posting in view: what the page in the active tab of the Side Panel's window reads as. The panel
 * is one page that stays open from tab to tab (ADR-0054), and the browser tells it nothing when the
 * person switches tabs: it follows them itself, here. The page is read in the person's own browser
 * (ADR-0002), and nothing is captured: a Capture stays the person's click.
 */
import type { CapturedJobOffer } from "./job-page";

/** A page read in the active tab: whether it is a posting, and the Job Offer a Capture of it would send. */
export interface PageInView {
  detected: boolean;
  jobOffer: CapturedJobOffer;
}

interface BrowserEvent<L> {
  addListener(listener: L): void;
  removeListener(listener: L): void;
}

/** The part of chrome.tabs this module uses. */
export interface Tabs {
  query(query: { active: true; windowId: number }): Promise<{ id?: number }[]>;
  onActivated: BrowserEvent<(info: { tabId: number; windowId: number }) => void>;
  onUpdated: BrowserEvent<(tabId: number, change: { status?: string; url?: string }, tab: { active?: boolean; windowId?: number }) => void>;
}

export interface PostingInViewOptions {
  tabs: Tabs;
  /** The Side Panel's window: tabs of other windows are not in view. */
  windowId: number;
  /** Reads a tab's page; null when it has nothing to capture or cannot be read (a browser page, say). */
  readTab: (tabId: number) => Promise<PageInView | null>;
  /** Told of the page in view when the panel opens, then each time it changes. */
  onChange: (page: PageInView | null) => void;
}

const same = (a: PageInView | null, b: PageInView | null) =>
  a === b || (!!a && !!b && a.detected === b.detected && a.jobOffer.source.url === b.jobOffer.source.url && a.jobOffer.title === b.jobOffer.title);

/** Follows the posting in view until the returned function is called. */
export function watchPostingInView({ tabs, windowId, readTab, onChange }: PostingInViewOptions): () => void {
  let reads = 0;
  let shown: PageInView | null | undefined;

  /** `tab`: the tab to read, or the active one, once found (a tab activated meanwhile is read after it). */
  async function read(tab: number | Promise<number | undefined>) {
    const readId = ++reads;
    const tabId = await tab;
    const page = tabId === undefined ? null : await readTab(tabId).catch(() => null);
    // The person moved on while this tab was read: the later read tells.
    if (readId !== reads) return;
    if (shown !== undefined && same(shown, page)) return;
    shown = page;
    onChange(page);
  }

  const onActivated = (info: { tabId: number; windowId: number }) => {
    if (info.windowId === windowId) void read(info.tabId);
  };
  const onUpdated = (tabId: number, change: { status?: string; url?: string }, tab: { active?: boolean; windowId?: number }) => {
    if (tab.active && tab.windowId === windowId && (change.status === "complete" || change.url)) void read(tabId);
  };
  tabs.onActivated.addListener(onActivated);
  tabs.onUpdated.addListener(onUpdated);
  void read(tabs.query({ active: true, windowId }).then(([tab]) => tab?.id, () => undefined));

  return () => {
    tabs.onActivated.removeListener(onActivated);
    tabs.onUpdated.removeListener(onUpdated);
  };
}
