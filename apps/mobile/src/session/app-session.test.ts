import { APP_ORIGIN, APP_SIGN_IN_PATH } from "@jobhub/shared";
import { createAppSession } from "./app-session";
import { fakeWebView } from "../testing-device";
import { fakeWebApp, memoryStorage, memoryWebViewCookies, TEST_BASE_URL } from "./testing";

const EMAIL = "marie.dupont@example.fr";

function setUp() {
  const web = fakeWebApp();
  const storage = memoryStorage();
  const webViews = memoryWebViewCookies();
  const session = createAppSession({ baseURL: TEST_BASE_URL, storage, fetch: web.fetch, passkeys: web.deviceWithoutPasskey(), webViewCookies: webViews });
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

  it("gives the session cookie for the app's other requests to the web app (its calls to the API, downloads), none once signed out", async () => {
    const { web, session } = setUp();
    await session.askLink(EMAIL);
    await session.openLink(web.linkFor(EMAIL));

    expect(web.signedInAs({ cookie: await session.cookie() })).toBe(EMAIL);

    await session.signOut();
    expect(await session.cookie()).toBe("");
  });

  it.each([
    ["signing out", async ({ session }: ReturnType<typeof setUp>) => session.signOut()],
    ["signing out offline", async ({ web, session }: ReturnType<typeof setUp>) => (web.setOffline(true), session.signOut())],
    ["a session revoked from Mon compte on the web", async ({ web, session }: ReturnType<typeof setUp>) => (web.revokeAll(EMAIL), void (await session.current()))],
  ])("empties the WebViews' cookies too on %s (#689)", async (_, end) => {
    const set = setUp();
    await set.session.askLink(EMAIL);
    await set.session.openLink(set.web.linkFor(EMAIL));
    // What a WebPage gives the WebViews before a page of the web app opens (src/web-pages).
    fakeWebView.cookies = (await set.session.webCookies()).map((cookie) => ({ url: TEST_BASE_URL, ...cookie }));
    expect(set.webViews.cookies()).not.toEqual([]);

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

  describe("signed in by the email's code (#686)", () => {
    it("signs in with the code, the session kept in secure storage", async () => {
      const { web, session, keptOnDevice } = setUp();
      await session.askLink(EMAIL);

      expect(await session.enterCode(EMAIL, web.codeFor(EMAIL))).toEqual({ kind: "signedIn", email: EMAIL });

      expect(keptOnDevice()).toBe(true);
      expect(await session.current()).toEqual({ kind: "signedIn", email: EMAIL });
    });

    it("takes the code as typed, spaces included", async () => {
      const { web, session } = setUp();
      await session.askLink(EMAIL);
      const code = web.codeFor(EMAIL);

      expect(await session.enterCode(EMAIL, ` ${code.slice(0, 3)} ${code.slice(3)}`)).toEqual({ kind: "signedIn", email: EMAIL });
    });

    it("says why a code is refused: wrong, then too many tries", async () => {
      const { web, session } = setUp();
      await session.askLink(EMAIL);

      for (let tries = 0; tries < 5; tries++) expect(await session.enterCode(EMAIL, "000000")).toEqual({ kind: "codeRefused", reason: "signIn.codeWrong" });
      expect(await session.enterCode(EMAIL, web.codeFor(EMAIL))).toEqual({ kind: "codeRefused", reason: "signIn.codeTooManyTries" });
      expect(await session.current()).toEqual({ kind: "signedOut" });
    });

    it("leads to the second step for an account that has it", async () => {
      const { web, session } = setUp();
      web.withSecondStep(EMAIL);
      await session.askLink(EMAIL);

      expect(await session.enterCode(EMAIL, web.codeFor(EMAIL))).toEqual({ kind: "secondStep" });
    });

    it("says when the web app cannot be reached", async () => {
      const { web, session } = setUp();
      await session.askLink(EMAIL);
      web.setOffline(true);

      expect(await session.enterCode(EMAIL, web.codeFor(EMAIL))).toEqual({ kind: "codeRefused", reason: "signIn.error" });
    });
  });
});
