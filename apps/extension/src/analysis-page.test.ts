import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateSession } from "./candidate-session";
import { openAnalysisPage } from "./analysis-page";

const signedIn: CandidateSession = { signedIn: true, candidate: { email: "marie@example.com", name: "Marie", interfaceLanguage: "fr" } };
const guest: CandidateSession = { signedIn: false };

/** The analysis page's tab: in view or not, given focus, as the browser does. */
function tab() {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  const window = Object.assign(new EventTarget(), { setInterval: (work: () => void, ms: number) => globalThis.setInterval(work, ms) });
  return {
    document,
    window,
    hide: () => {
      document.visibilityState = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    },
    show: () => {
      document.visibilityState = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    },
    focus: () => window.dispatchEvent(new Event("focus")),
  };
}

/** The web app's session: the Guest signs up (or the Candidate out) in another tab whenever the test says so. */
function webApp(initial: CandidateSession) {
  let current = initial;
  const readSession = vi.fn(async () => current);
  return { readSession, become: (session: CandidateSession) => (current = session) };
}

const neverRenders = () => new Promise<void>(() => {});

function open({ session = guest, render = neverRenders }: { session?: CandidateSession; render?: () => Promise<void> } = {}) {
  const page = tab();
  const web = webApp(session);
  const reload = vi.fn();
  const opened = openAnalysisPage({ signedIn: session.signedIn, readSession: web.readSession, reload, render, ...page });
  return { ...page, web, reload, opened };
}

describe("the analysis page, watching the web app's session", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("reloads on a sign-up in another tab, even while its first render never finishes", async () => {
    const { web, reload } = open({ render: neverRenders });

    web.become(signedIn);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads on a sign-up in another tab, even when its first render fails", async () => {
    const { web, reload, opened } = open({ render: () => Promise.reject(new Error("render failed")) });
    await expect(opened).rejects.toThrow("render failed");

    web.become(signedIn);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("checks the session at once when the Guest comes back to the tab", async () => {
    const { web, reload, hide, show } = open();
    hide();
    web.become(signedIn);

    show();
    await vi.advanceTimersByTimeAsync(0);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("checks the session at once when the window gets focus back", async () => {
    const { web, reload, focus } = open();
    web.become(signedIn);

    focus();
    await vi.advanceTimersByTimeAsync(0);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads on a sign-out in another tab", async () => {
    const { web, reload } = open({ session: signedIn });

    web.become(guest);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload while the session is unchanged", async () => {
    const { reload, focus } = open();

    focus();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(reload).not.toHaveBeenCalled();
  });

  it("does not check the session while the tab is out of view, and reloads once however often it is checked", async () => {
    const { web, reload, hide, show, focus } = open();
    hide();
    web.become(signedIn);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(web.readSession).not.toHaveBeenCalled();

    show();
    focus();
    await vi.advanceTimersByTimeAsync(9_000);

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
