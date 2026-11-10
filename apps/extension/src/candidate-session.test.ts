import { API_VERSION } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { readCandidateSession } from "./candidate-session";
import { EXTENSION_VERSION } from "./extension-update";

const WEB_ORIGIN = "https://app.jobbbox.fr";

/** The web app as the extension sees it: answers get-session only when the browser's cookie travels with the request. */
function webApp(sessionUser: Record<string, unknown> | null) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const withCookies = init?.credentials === "include";
    return Response.json(withCookies && sessionUser ? { session: { id: "s1" }, user: sessionUser } : null);
  };
  return { fetch, calls };
}

describe("readCandidateSession", () => {
  it("shares the session of the Candidate signed in on the web app", async () => {
    const app = webApp({ id: "c1", email: "marie.dupont@example.fr", name: "Marie Dupont", interfaceLanguage: "en" });

    const session = await readCandidateSession(WEB_ORIGIN, app.fetch);

    expect(session).toEqual({
      signedIn: true,
      candidate: { email: "marie.dupont@example.fr", name: "Marie Dupont", interfaceLanguage: "en" },
    });
    expect(app.calls[0]?.url).toBe(`${WEB_ORIGIN}/api/auth/get-session`);
    expect(app.calls[0]?.init?.headers).toEqual({ "Jobbbox-Api-Version": String(API_VERSION), "Jobbbox-Extension-Version": EXTENSION_VERSION });
  });

  it("is signed out when nobody is signed in on the web app", async () => {
    expect(await readCandidateSession(WEB_ORIGIN, webApp(null).fetch)).toEqual({ signedIn: false });
  });

  it("is signed out when the web app cannot be reached", async () => {
    const offline = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await readCandidateSession(WEB_ORIGIN, offline)).toEqual({ signedIn: false });
  });

  it("is waiting for its second step when the web app says so (ADR-0075): neither signed in nor a Guest", async () => {
    const pending = async () => Response.json({ error: "second_step_required" }, { status: 401 });

    expect(await readCandidateSession(WEB_ORIGIN, pending)).toEqual({ signedIn: false, secondStepPending: true });
    expect(await readCandidateSession(WEB_ORIGIN, async () => Response.json({ error: "unauthorized" }, { status: 401 }))).toEqual({ signedIn: false });
  });

  it("falls back to French for an Interface Language it does not know", async () => {
    const app = webApp({ email: "marie.dupont@example.fr", name: "", interfaceLanguage: "de" });
    const session = await readCandidateSession(WEB_ORIGIN, app.fetch);
    expect(session.signedIn && session.candidate.interfaceLanguage).toBe("fr");
  });
});
