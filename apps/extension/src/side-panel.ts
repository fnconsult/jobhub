/**
 * The Side Panel (ADR-0054): the extension's pane docked beside the page, in Chrome and Edge
 * (`chrome.sidePanel`). The toolbar icon opens it, and so does the « Analyser cette offre » badge,
 * whose Capture then lands in the Guest session the panel reads. The panel is global (the manifest's
 * `side_panel`): opened once, it stays open from tab to tab.
 */
import type { GuestSession } from "./guest-session";
import type { CapturedJobOffer } from "./job-page";
import type { JobbboxApi } from "./jobbbox-api";
import type { AnalyseReply } from "./messages";

/** The part of chrome.sidePanel this module uses. */
export interface SidePanelApi {
  open(options: { tabId: number } | { windowId: number }): Promise<void>;
  setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void>;
}

/** The browser tab a badge was clicked in. */
export interface BadgeTab {
  id?: number;
  windowId: number;
}

export interface SidePanel {
  /** The toolbar icon opens the Side Panel (the extension has no popup). */
  openOnToolbarIcon(): Promise<void>;
  /**
   * Captures the posting and keeps its Job Offer in the Guest session. From a badge (`from`, its tab),
   * the panel is opened beside it first, at once: the browser opens it only while the person's click
   * still counts, which no answer from Jobbbox may wait for.
   */
  capture(jobOffer: CapturedJobOffer, from?: BadgeTab): Promise<AnalyseReply>;
}

export function createSidePanel({ sidePanel, api, session }: { sidePanel: SidePanelApi; api: Pick<JobbboxApi, "capture">; session: GuestSession }): SidePanel {
  return {
    openOnToolbarIcon: () => sidePanel.setPanelBehavior({ openPanelOnActionClick: true }),
    async capture(jobOffer, from) {
      if (from) {
        // Opened for the badge's tab: as the panel is global, it then stays open from tab to tab.
        const opening = sidePanel.open(from.id === undefined ? { windowId: from.windowId } : { tabId: from.id });
        // Refused (the click no longer counts, say): the Capture still happens; the toolbar icon opens the panel.
        opening.catch((error: unknown) => console.error("Jobbbox: opening the Side Panel", error));
      }
      const captured = await api.capture(jobOffer);
      if (!captured.ok) return captured;
      await session.keepJobOffer(captured.jobOffer);
      return { ok: true };
    },
  };
}
