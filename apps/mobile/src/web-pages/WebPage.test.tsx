import { act, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import { createAppSession } from "../session/app-session";
import { SessionGate } from "../session/SessionGate";
import { fakeWebApp, memoryStorage, memoryWebViewCookies, TEST_BASE_URL } from "../session/testing";
import { renderInApp } from "../testing";
import { WebPage } from "./WebPage";

const EMAIL = "marie.dupont@example.fr";

/** The app signed in, showing the web app's `path` in a WebView. */
async function openWebPage(path: string) {
  const web = fakeWebApp();
  const webViews = memoryWebViewCookies();
  const session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), webViewCookies: webViews, fetch: web.fetch });
  await session.askLink(EMAIL);
  await session.openLink(web.linkFor(EMAIL));
  await renderInApp(
    <SessionGate session={session} link={null}>
      <WebPage path={path} />
    </SessionGate>,
  );
  const view = await screen.findByTestId("web-view");
  const props = () => screen.getByTestId("web-view").props;
  return {
    web,
    webViews,
    view,
    props,
    /** The page asks to load `url` in its own frame (a link followed, a form sent, a redirect): whether the WebView loads it. */
    follow: (url: string) => props().onShouldStartLoadWithRequest({ url, isTopFrame: true, navigationType: "click" }) as boolean,
    /** The page asks for a new window (`target="_blank"`, `window.open`). */
    openWindow: (url: string) => act(() => void props().onOpenWindow({ nativeEvent: { targetUrl: url } })),
    /** The WebView has landed on `url`. */
    landOn: (url: string) => act(async () => props().onNavigationStateChange({ url, loading: false, canGoBack: true, canGoForward: false, title: "", navigationType: "other" })),
  };
}

let openURL: jest.SpyInstance;
beforeEach(() => {
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
});
afterEach(() => openURL.mockRestore());

describe("a web page inside the app (#689, ADR-0076)", () => {
  it("opens the web app's page signed in: the session's cookie is in the WebViews' store, for its host alone, before it loads", async () => {
    const { props, webViews } = await openWebPage("/compte/donnees");

    expect(props().source).toEqual({ uri: `${TEST_BASE_URL}/compte/donnees` });
    expect(webViews.cookies()).toEqual([expect.objectContaining({ url: TEST_BASE_URL, name: "__Secure-better-auth.session_token", secure: true, httpOnly: true })]);
    expect(props().applicationNameForUserAgent).toMatch(/^JobbboxApp\/\d+$/);
    expect(props().thirdPartyCookiesEnabled).toBe(false);
  });

  it("keeps the web app's own pages inside the app", async () => {
    const { follow } = await openWebPage("/compte");

    expect(follow(`${TEST_BASE_URL}/compte/securite`)).toBe(true);
    expect(follow(`${TEST_BASE_URL}/abonnement/retractation?contrat=abc`)).toBe(true);
    expect(openURL).not.toHaveBeenCalled();
  });

  it.each([
    ["another site", "https://www.cnil.fr/fr/plaintes"],
    ["Production from the Beta", "https://jobbbox.ai/compte"],
    ["a look-alike host", "https://staging.jobbbox.ai.example.com/compte"],
    ["the web app without HTTPS", "http://staging.jobbbox.ai/compte"],
  ])("opens a link out of the web app, to %s, in the system's browser, out of the app", async (_, url) => {
    const { follow } = await openWebPage("/legal/cgu");

    expect(follow(url)).toBe(false);
    expect(openURL).toHaveBeenCalledWith(url);
  });

  it("opens a new window in the system's browser, « Gérer mon abonnement sur jobbbox.ai » included", async () => {
    const { openWindow } = await openWebPage("/abonnement");

    await openWindow(`${TEST_BASE_URL}/abonnement`);

    expect(openURL).toHaveBeenCalledWith(`${TEST_BASE_URL}/abonnement`);
  });

  it("is signed out once the page signs out or deletes the account, the WebViews' cookies emptied", async () => {
    const { web, webViews, landOn } = await openWebPage("/compte/donnees");

    web.revokeAll(EMAIL);
    await landOn(`${TEST_BASE_URL}/compte/supprime`);

    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
    expect(webViews.cookies()).toEqual([]);
  });
});
