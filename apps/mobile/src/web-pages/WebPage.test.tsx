import { SECOND_STEP_PATH } from "@jobhub/shared";
import { act, screen, userEvent, waitFor } from "@testing-library/react-native";
import { File } from "expo-file-system";
import { Linking, Share } from "react-native";
import { createAppSession } from "../session/app-session";
import { SessionGate } from "../session/SessionGate";
import { EXPORT_FILE_NAME, fakeWebApp, memoryStorage, memoryWebViewCookies, TEST_BASE_URL } from "../session/testing";
import { fakeWebView } from "../testing-device";
import { renderInApp } from "../testing";
import { downloadedFileName, WebPage } from "./WebPage";
import { SessionWebPage } from "./WebPageScreen";

// The device's files: the app's cache at a fixed address, what is written there kept in `written` (by address). The
// system's downloader is there to show the app never uses it: it would follow a redirect to any host, the cookie with it.
jest.mock("expo-file-system", () => {
  const written = new Map<string, string>();
  class File {
    readonly uri: string;
    constructor(folder: { uri: string }, name: string) {
      this.uri = `${folder.uri}${name}`;
    }
    create() {
      written.set(this.uri, "");
    }
    write(bytes: Uint8Array) {
      written.set(this.uri, Buffer.from(bytes).toString("utf8"));
    }
    static downloadFileAsync = jest.fn(async () => ({ uri: "file:///cache/jobbbox-export.json" }));
  }
  return { Paths: { cache: { uri: "file:///cache/" } }, File, written };
});
/** What the app wrote in its cache, by address. */
const written: Map<string, string> = jest.requireMock("expo-file-system").written;

const COACH = "claire.coach@example.fr";

async function setUp() {
  fakeWebView.reset();
  const web = fakeWebApp();
  const session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: web.fetch, passkeys: web.deviceWithoutPasskey() });
  web.mustSetUp(COACH);
  await session.askLink(COACH);
  await session.openLink(web.linkFor(COACH));
  const onLeave = jest.fn();
  const onClose = jest.fn();
  const view = await renderInApp(<WebPage session={session} baseURL={TEST_BASE_URL} path={SECOND_STEP_PATH} title="Vérification en deux étapes" onLeave={onLeave} onClose={onClose} />);
  await waitFor(() => expect(fakeWebView.shown).not.toBeNull());
  return { view, onLeave, onClose };
}

const navigate = (url: string) => act(async () => fakeWebView.shown!.onNavigationStateChange({ url, loading: false }));

// A page of the web app in the app (ADR-0076, #688): the setup of Two-step verification for now, Mon compte's in #689.
describe("WebPage", () => {
  it("opens the web app's page with the session, its cookie given to the WebView for the web app's host alone", async () => {
    await setUp();

    expect(fakeWebView.shown!.source.uri).toBe(`${TEST_BASE_URL}${SECOND_STEP_PATH}`);
    expect(fakeWebView.cookies).toEqual([
      expect.objectContaining({ url: TEST_BASE_URL, name: "__Secure-better-auth.session_token", value: expect.stringMatching(/^session\d+\.signature$/), secure: true, httpOnly: true }),
    ]);
    // Host-only (ADR-0076): given a `domain`, the cookie would also go to the host's subdomains, staging.jobbbox.ai among them.
    expect(fakeWebView.cookies[0]).not.toHaveProperty("domain");
    expect(screen.getByText("Vérification en deux étapes")).toBeOnTheScreen();
  });

  it("opens any other address in the system browser, never in the WebView", async () => {
    await setUp();
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);

    expect(fakeWebView.shown!.onShouldStartLoadWithRequest({ url: `${TEST_BASE_URL}/aide` })).toBe(true);
    expect(fakeWebView.shown!.onShouldStartLoadWithRequest({ url: "https://apps.apple.com/app/google-authenticator" })).toBe(false);
    expect(openURL).toHaveBeenCalledWith("https://apps.apple.com/app/google-authenticator");
    // The web app's origin alone, as every address the app gives the session to (isOnWebApp): no look-alike, subdomain or other scheme.
    for (const elsewhere of ["https://staging.jobbbox.ai.example.net/aide", "https://www.staging.jobbbox.ai/aide", "http://staging.jobbbox.ai/aide"]) {
      expect(fakeWebView.shown!.onShouldStartLoadWithRequest({ url: elsewhere })).toBe(false);
    }
    openURL.mockRestore();
  });

  it("says when the page goes on to another page of the site, as the setup does once done", async () => {
    const { onLeave } = await setUp();

    await navigate(`${TEST_BASE_URL}${SECOND_STEP_PATH}?suite=%2F`);
    expect(onLeave).not.toHaveBeenCalled();

    await navigate(`${TEST_BASE_URL}/`);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("closes with « Fermer », and the WebView keeps no copy of the cookie once closed", async () => {
    const { view, onClose } = await setUp();

    await userEvent.setup().press(screen.getByRole("button", { name: "Fermer" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await view.unmount();
    await waitFor(() => expect(fakeWebView.cookies).toEqual([]));
  });
});

const EMAIL = "marie.dupont@example.fr";

/** The app signed in, showing the web app's `path` in a WebView. */
async function openWebPage(path: string) {
  const web = fakeWebApp();
  fakeWebView.reset();
  const webViews = memoryWebViewCookies();
  const session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: web.fetch, passkeys: web.deviceWithoutPasskey(), webViewCookies: webViews });
  await session.askLink(EMAIL);
  await session.openLink(web.linkFor(EMAIL));
  /** Every address the app sent a request to, with whose session (the web app's reading of its cookie). */
  const sent: { url: string; as: string | null }[] = [];
  // A fetch as the platform's: it follows a redirect itself, with the same headers, unless asked not to (`manual`).
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    sent.push({ url: request.url, as: web.signedInAs(request.headers) });
    const response = await web.fetch(request);
    const location = response.headers.get("location");
    if (init?.redirect === "manual" || response.status < 300 || response.status >= 400 || !location) return response;
    return fetch(new URL(location, request.url).toString(), { ...init, headers: request.headers });
  };
  // The app's calls to the API as in the app (app-providers.tsx): the session's cookie, through the app's fetch.
  await renderInApp(
    <SessionGate session={session} link={null}>
      <SessionWebPage path={path} />
    </SessionGate>,
    { session, fetch },
  );
  await waitFor(() => expect(fakeWebView.shown).not.toBeNull());
  const props = () => fakeWebView.shown!;
  return {
    web,
    webViews,
    sent,
    props,
    /** The page asks to load `url` in its own frame (a link followed, a form sent, a redirect): whether the WebView loads it. */
    follow: (url: string) => props().onShouldStartLoadWithRequest({ url, isTopFrame: true, navigationType: "click" }) as boolean,
    /** The page asks for a new window (`target="_blank"`, `window.open`). */
    openWindow: (url: string) => act(() => void props().onOpenWindow({ nativeEvent: { targetUrl: url } })),
    /** The page downloads `url` (a response the WebView does not show: an attachment, as the Data export is), on iOS. */
    download: (url: string) => act(async () => void props().onFileDownload({ nativeEvent: { downloadUrl: url } })),
    /** The WebView has landed on `url`. */
    landOn: (url: string) => act(async () => props().onNavigationStateChange({ url, loading: false, canGoBack: true, canGoForward: false, title: "", navigationType: "other" })),
  };
}

let openURL: jest.SpyInstance;
beforeEach(() => {
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  (File.downloadFileAsync as jest.Mock).mockClear();
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

  it("hands a file the page downloads, the Data export, to the system's share sheet, fetched with the session by the app itself", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction", activityType: undefined });
    written.clear();
    const { download, sent } = await openWebPage("/compte/donnees");

    await download(`${TEST_BASE_URL}/api/account/export`);

    expect(sent).toContainEqual({ url: `${TEST_BASE_URL}/api/account/export`, as: EMAIL });
    // In the app's cache, under the name the web app gives the file, and nowhere else.
    expect([...written.keys()]).toEqual([`file:///cache/${EXPORT_FILE_NAME}`]);
    expect(JSON.parse(written.get(`file:///cache/${EXPORT_FILE_NAME}`)!)).toEqual({ account: { email: EMAIL } });
    expect(share).toHaveBeenCalledWith({ url: `file:///cache/${EXPORT_FILE_NAME}` });
    // Never the system's downloader, which follows a redirect to any host and takes the cookie set by hand with it.
    expect(File.downloadFileAsync).not.toHaveBeenCalled();
    share.mockRestore();
  });

  it("refuses a redirect of the download off the web app: the session's cookie is never sent there, nothing is kept (#756)", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction", activityType: undefined });
    written.clear();
    const { web, download, sent } = await openWebPage("/compte/donnees");
    web.exportMovedTo("https://exports.example.net/jobbbox-donnees.json");

    await download(`${TEST_BASE_URL}/api/account/export`);

    expect(sent).toContainEqual({ url: `${TEST_BASE_URL}/api/account/export`, as: EMAIL });
    expect(sent.filter(({ url }) => !url.startsWith(`${TEST_BASE_URL}/`))).toEqual([]);
    expect(File.downloadFileAsync).not.toHaveBeenCalled();
    expect(written.size).toBe(0);
    expect(share).not.toHaveBeenCalled();
    share.mockRestore();
  });

  it("never sends the session with a download from elsewhere: it opens in the system's browser", async () => {
    const { download, sent } = await openWebPage("/legal/cgu");
    const before = sent.length;

    await download("https://example.com/brochure.pdf");

    expect(sent.slice(before)).toEqual([]);
    expect(File.downloadFileAsync).not.toHaveBeenCalled();
    expect(openURL).toHaveBeenCalledWith("https://example.com/brochure.pdf");
  });

  it("is signed out once the page signs out or deletes the account, the WebViews' cookies emptied", async () => {
    const { web, webViews, landOn } = await openWebPage("/compte/donnees");

    web.revokeAll(EMAIL);
    await landOn(`${TEST_BASE_URL}/compte/supprime`);

    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
    expect(webViews.cookies()).toEqual([]);
  });
});

describe("downloadedFileName", () => {
  const answer = (disposition?: string) => new Response("{}", { headers: disposition ? { "content-disposition": disposition } : {} });
  const address = new URL(`${TEST_BASE_URL}/api/account/export`);

  it("keeps a download under the name its answer gives, else its address's last segment", () => {
    expect(downloadedFileName(answer(`attachment; filename="${EXPORT_FILE_NAME}"`), address)).toBe(EXPORT_FILE_NAME);
    expect(downloadedFileName(answer("attachment; filename*=UTF-8''donn%C3%A9es.json"), address)).toBe("données.json");
    expect(downloadedFileName(answer(), address)).toBe("export");
  });

  it("never a path out of the app's cache", () => {
    expect(downloadedFileName(answer('attachment; filename="../../Documents/x.json"'), address)).toBe(".._.._Documents_x.json");
    expect(downloadedFileName(answer('attachment; filename=".."'), address)).toBe("download");
  });
});
