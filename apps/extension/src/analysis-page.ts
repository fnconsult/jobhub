/**
 * Opening the analysis page. Back from signing up or in (or out) on the web app, in another tab,
 * the page starts again as the person now is, in their Interface Language; on sign-up, the Guest's
 * work is kept at once (#11). The web app's session is watched before the page is first rendered,
 * so a render that never finishes (a Match Score waiting on another page's, say) or fails cannot
 * keep the page from noticing (#66).
 */
import type { CandidateSession } from "./candidate-session";

/** How often the session is checked while the page is in view: a tab switch is not the only way back. */
export const SESSION_CHECK_MS = 3_000;

export interface AnalysisPageOptions {
  /** Whether a Candidate was signed in when the page was opened. */
  signedIn: boolean;
  /** The web app's session now. */
  readSession: () => Promise<CandidateSession>;
  /** Starts the page again: called once, when the session no longer matches `signedIn`. */
  reload: () => void;
  /** The page's first render. */
  render: () => Promise<void>;
  document: Pick<Document, "visibilityState" | "addEventListener">;
  window: Pick<Window, "addEventListener"> & { setInterval: (work: () => void, ms: number) => unknown };
}

/**
 * Watches the session, then renders the page. The session is checked when the page comes back
 * into view or gets focus, and every few seconds while it is in view. Settles as `render` does.
 */
export function openAnalysisPage({ signedIn, readSession, reload, render, document, window }: AnalysisPageOptions): Promise<void> {
  let reloading = false;
  async function check() {
    if (reloading || document.visibilityState !== "visible") return;
    const current = await readSession();
    if (reloading || current.signedIn === signedIn) return;
    reloading = true;
    reload();
  }
  document.addEventListener("visibilitychange", () => void check());
  window.addEventListener("focus", () => void check());
  window.setInterval(() => void check(), SESSION_CHECK_MS);
  return render();
}
