import { APP_ORIGIN, APP_SIGN_IN_PATH } from "@jobhub/shared";
import { createAppSession } from "./app-session";
import { fakeWebApp, memoryStorage, memoryWebViewCookies, TEST_BASE_URL } from "./testing";

const EMAIL = "marie.dupont@example.fr";

function setUp() {
  const web = fakeWebApp();
  const storage = memoryStorage();
  const webViews = memoryWebViewCookies();
  const session = createAppSession({ baseURL: TEST_BASE_URL, storage, webViewCookies: webViews, fetch: web.fetch });
  /** Whether anything of a session is left in the Keychain or Keystore. */
  const keptOnDevice = () => [...storage.values.values()].some((value) => value.includes("session"));
  return { web, storage, webViews, session, keptOnDevice };
}

describe("the app's session (ADR-0076, #685)", () => {
  it("asks a magic link from the app, its return address in the app's scheme", async () => {
    const { web, session } = setUp();

    expect(await session.askLink(EMAIL)).toBe(true);

    expect(web.emailed).toEqual([expect.objectContaining({ email: EMAIL, callbackURL: `${APP_ORIGIN}${APP_SIGN_IN_PATH}` })]);
  });

  it("signs in when the emailed link opens the app, the session kept in secure storage", async () => {
    const { web, session, keptOnDevice } = setUp();
    await session.askLink(EMAIL);

    expect(await session.openLink(web.linkFor(EMAIL))).toEqual({ kind: "signedIn", email: EMAIL });

    expect(keptOnDevice()).toBe(true);
    expect(await session.current()).toEqual({ kind: "signedIn", email: EMAIL });
  });

  it("is signed out until then", async () => {
    const { session } = setUp();

    expect(await session.current()).toEqual({ kind: "signedOut" });
  });

  it("says when the link is no longer valid", async () => {
    const { web, session } = setUp();
    await session.askLink(EMAIL);
    const link = web.linkFor(EMAIL);
    await session.openLink(link);

    expect(await session.openLink(link)).toEqual({ kind: "invalidLink" });
  });

  it("says when the link is no longer valid on a device not signed in", async () => {
    const { session, keptOnDevice } = setUp();

    expect(await session.openLink(`${TEST_BASE_URL}${APP_SIGN_IN_PATH}?token=expired`)).toEqual({ kind: "invalidLink" });

    expect(keptOnDevice()).toBe(false);
  });

  it("leaves alone a link that is not a sign-in link", async () => {
    const { session } = setUp();

    expect(await session.openLink(`${TEST_BASE_URL}/candidatures`)).toBeNull();
    expect(await session.openLink(`${TEST_BASE_URL}${APP_SIGN_IN_PATH}`)).toBeNull();
  });

  it("shows a session pending its second step as a step to take", async () => {
    const { web, session } = setUp();
    web.withSecondStep(EMAIL);
    await session.askLink(EMAIL);

    expect(await session.openLink(web.linkFor(EMAIL))).toEqual({ kind: "secondStep" });
    expect(await session.current()).toEqual({ kind: "secondStep" });
  });

  it("gives the session's cookie for the app's calls to the API, none once signed out", async () => {
    const { web, session } = setUp();
    await session.askLink(EMAIL);
    await session.openLink(web.linkFor(EMAIL));

    expect(await session.cookie()).toMatch(/__Secure-better-auth\.session_token=session\d+\.signature/);

    await session.signOut();
    expect(await session.cookie()).not.toContain("session_token=session");
  });

  it("lends its cookie to the WebViews for the web app's own host alone, secure and out of reach of the page's scripts (#689)", async () => {
    const { web, webViews, session } = setUp();
    await session.askLink(EMAIL);
    await session.openLink(web.linkFor(EMAIL));

    await session.shareWithWebViews();

    expect(webViews.cookies()).toEqual([
      { url: TEST_BASE_URL, name: "__Secure-better-auth.session_token", value: expect.stringMatching(/^session\d+\.signature$/), path: "/", secure: true, httpOnly: true },
    ]);
  });

  it("lends nothing to the WebViews while signed out", async () => {
    const { webViews, session } = setUp();

    await session.shareWithWebViews();

    expect(webViews.cookies()).toEqual([]);
  });

  it.each([
    ["signing out", async ({ session }: ReturnType<typeof setUp>) => session.signOut()],
    ["signing out offline", async ({ web, session }: ReturnType<typeof setUp>) => (web.setOffline(true), session.signOut())],
    ["a session revoked from Mon compte on the web", async ({ web, session }: ReturnType<typeof setUp>) => (web.revokeAll(EMAIL), void (await session.current()))],
  ])("empties the WebViews' cookies too on %s (#689)", async (_, end) => {
    const set = setUp();
    await set.session.askLink(EMAIL);
    await set.session.openLink(set.web.linkFor(EMAIL));
    await set.session.shareWithWebViews();

    await end(set);

    expect(set.webViews.cookies()).toEqual([]);
  });

  it("revokes the session when signing out, and empties secure storage", async () => {
    const { web, session, keptOnDevice } = setUp();
    await session.askLink(EMAIL);
    await session.openLink(web.linkFor(EMAIL));

    await session.signOut();

    expect(web.sessionCount()).toBe(0);
    expect(keptOnDevice()).toBe(false);
    expect(await session.current()).toEqual({ kind: "signedOut" });
  });

  it("empties secure storage when signing out offline", async () => {
    const { web, session, keptOnDevice } = setUp();
    await session.askLink(EMAIL);
    await session.openLink(web.linkFor(EMAIL));
    web.setOffline(true);

    await session.signOut();

    expect(keptOnDevice()).toBe(false);
  });

  it("is signed out at its next request once revoked from Mon compte on the web, and empties secure storage", async () => {
    const { web, session, keptOnDevice } = setUp();
    await session.askLink(EMAIL);
    await session.openLink(web.linkFor(EMAIL));

    web.revokeAll(EMAIL);

    expect(await session.current()).toEqual({ kind: "signedOut" });
    expect(keptOnDevice()).toBe(false);
  });

  it("keeps the session while the web app cannot be reached", async () => {
    const { web, session, keptOnDevice } = setUp();
    await session.askLink(EMAIL);
    await session.openLink(web.linkFor(EMAIL));
    web.setOffline(true);

    await expect(session.current()).rejects.toThrow();

    expect(keptOnDevice()).toBe(true);
    web.setOffline(false);
    expect(await session.current()).toEqual({ kind: "signedIn", email: EMAIL });
  });
});
