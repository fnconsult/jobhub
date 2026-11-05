import { SECOND_STEP_PATH } from "@jobhub/shared";
import { act, screen, userEvent, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { createAppSession } from "../session/app-session";
import { fakeWebApp, memoryStorage, TEST_BASE_URL } from "../session/testing";
import { fakeWebView } from "../testing-device";
import { renderInApp } from "../testing";
import { WebPage } from "./WebPage";

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
