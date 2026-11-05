import { API_CLIENT_HEADER, API_VERSION, API_VERSION_HEADER, APP_OUTDATED, EXTENSION_OUTDATED, MOBILE_CLIENT } from "@jobhub/shared/api-version";
import { screen, userEvent } from "@testing-library/react-native";
import { Linking, Pressable, Text } from "react-native";
import { createAppSession } from "../session/app-session";
import { fakeWebApp, memoryStorage, TEST_BASE_URL } from "../session/testing";
import { renderInApp } from "../testing";
import { ApiProvider, useApi } from "./api";

const APP_STORE = "https://apps.apple.com/app/id6740000000";

/** A screen of the app that reads through the API when pressed. */
function Reader() {
  const api = useApi();
  return (
    <Pressable role="button" onPress={() => void api("/api/applications").catch(() => {})}>
      <Text>Lire mes candidatures</Text>
    </Pressable>
  );
}

/** A fetch that answers every call `status` with `body`, and keeps what it was asked. */
function server(status: number, body: unknown = {}) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

async function read(fetch: typeof globalThis.fetch) {
  await renderInApp(
    <ApiProvider baseUrl="https://staging.jobbbox.ai" fetch={fetch} storePage={APP_STORE}>
      <Reader />
    </ApiProvider>,
  );
  await userEvent.setup().press(screen.getByRole("button", { name: "Lire mes candidatures" }));
}

describe("the app's calls to the API (ADR-0076, #704)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("go to the platform it was built for, stating its API Version and naming itself", async () => {
    const { fetch, calls } = server(200, []);
    await read(fetch);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://staging.jobbbox.ai/api/applications");
    expect(calls[0]!.headers.get(API_VERSION_HEADER)).toBe(String(API_VERSION));
    expect(calls[0]!.headers.get(API_CLIENT_HEADER)).toBe(MOBILE_CLIENT);
    expect(screen.getByText("Lire mes candidatures")).toBeOnTheScreen();
  });

  it("carry the session, as its cookie, so the web app reads them as the signed-in Candidate's", async () => {
    const web = fakeWebApp();
    const session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: web.fetch });
    await session.askLink("marie.dupont@example.fr");
    await session.openLink(web.linkFor("marie.dupont@example.fr"));
    const { fetch, calls } = server(200, []);

    await renderInApp(
      <ApiProvider baseUrl="https://staging.jobbbox.ai" fetch={fetch} storePage={APP_STORE} session={session}>
        <Reader />
      </ApiProvider>,
    );
    await userEvent.setup().press(screen.getByRole("button", { name: "Lire mes candidatures" }));

    expect(web.signedInAs(calls[0]!.headers)).toBe("marie.dupont@example.fr");
  });

  it("answered 426, show « Mettre à jour Jobbbox » in place of the app, with the link to its store", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await read(server(426, { error: APP_OUTDATED, storeUrl: null, apiVersion: API_VERSION + 2 }).fetch);
    expect(screen.getByRole("heading", { name: "Mettre à jour Jobbbox" })).toBeOnTheScreen();
    expect(screen.queryByText("Lire mes candidatures")).toBeNull();
    await userEvent.setup().press(screen.getByRole("link", { name: "Ouvrir l'App Store" }));
    expect(openURL).toHaveBeenCalledWith(APP_STORE);
  });

  it("are open to every screen of the app, which sits in the API's provider", async () => {
    const { fetch, calls } = server(426, { error: APP_OUTDATED, storeUrl: null, apiVersion: API_VERSION + 2 });
    jest.spyOn(globalThis, "fetch").mockImplementation(fetch);
    await renderInApp(<Reader />);
    await userEvent.setup().press(screen.getByRole("button", { name: "Lire mes candidatures" }));
    expect(calls[0]!.url).toMatch(/^https:\/\/[a-z.]*jobbbox\.ai\/api\/applications$/);
    expect(screen.getByRole("heading", { name: "Mettre à jour Jobbbox" })).toBeOnTheScreen();
  });

  it("send the person to the store page the platform names, when it names one", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    const named = "https://apps.apple.com/fr/app/jobbbox/id6740000001";
    await read(server(426, { error: APP_OUTDATED, storeUrl: named, apiVersion: API_VERSION + 2 }).fetch);
    await userEvent.setup().press(screen.getByRole("link", { name: "Ouvrir l'App Store" }));
    expect(openURL).toHaveBeenCalledWith(named);
  });

  it("never send the person to a store page named for another client, such as the extension's", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    const extensionStore = "https://chromewebstore.google.com/detail/jobbbox/abcdefghijklmnopabcdefghijklmnop";
    await read(server(426, { error: EXTENSION_OUTDATED, storeUrl: extensionStore, apiVersion: API_VERSION + 2 }).fetch);
    expect(screen.getByRole("heading", { name: "Mettre à jour Jobbbox" })).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole("link", { name: "Ouvrir l'App Store" }));
    expect(openURL).toHaveBeenCalledWith(APP_STORE);
  });
});
