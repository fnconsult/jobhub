import { API_CLIENT_HEADER, API_VERSION, API_VERSION_HEADER, APP_OUTDATED, EXTENSION_OUTDATED, MOBILE_CLIENT } from "@jobhub/shared/api-version";
import { APP_ORIGIN } from "@jobhub/shared";
import { screen, userEvent } from "@testing-library/react-native";
import { Linking, Pressable, Text } from "react-native";
import * as z from "zod";
import { CoachConversation } from "../coach/CoachConversation";
import { createAppSession } from "../session/app-session";
import { fakeWebApp, memoryStorage, TEST_BASE_URL } from "../session/testing";
import { renderInApp } from "../testing";
import { ApiProvider, useApi } from "./api";
import { useRead } from "./reads";

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

async function read(fetch: typeof globalThis.fetch, cookie?: () => Promise<string>) {
  await renderInApp(
    <ApiProvider baseUrl="https://staging.jobbbox.ai" fetch={fetch} storePage={APP_STORE} session={cookie ? { cookie } : undefined}>
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
    const session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: web.fetch, passkeys: web.deviceWithoutPasskey() });
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

  it("go to the platform alone: a path not under its address is refused before anything is sent", async () => {
    const { fetch, calls } = server(200, []);
    const refused: string[] = [];
    const paths = ["//exports.example.net/api/x", "@exports.example.net/api/x", "api/applications", "https://exports.example.net/api/x"];
    function Caller() {
      const api = useApi();
      const callAll = () => Promise.all(paths.map((path) => api(path).catch(() => void refused.push(path))));
      return (
        <Pressable role="button" onPress={() => void callAll()}>
          <Text>Appeler</Text>
        </Pressable>
      );
    }
    await renderInApp(
      <ApiProvider baseUrl="https://staging.jobbbox.ai" fetch={fetch} storePage={APP_STORE}>
        <Caller />
      </ApiProvider>,
    );
    await userEvent.setup().press(screen.getByRole("button", { name: "Appeler" }));

    expect(refused).toEqual(paths);
    expect(calls).toEqual([]);
  });

  it("carry the session as its cookie, by hand and no other, since the system's cookie store does not hold it", async () => {
    const { fetch } = server(200, []);
    const session = "__Secure-better-auth.session_token=session1.signature";
    await read(fetch, async () => session);
    const init = (fetch as unknown as jest.Mock).mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("cookie")).toBe(session);
    expect(init.credentials).toBe("omit");
  });

  it("state the app's origin, which the web app trusts for a write as it does its own pages', a body sent as JSON (#689)", async () => {
    const { fetch } = server(200, {});
    function Writer() {
      const api = useApi();
      return (
        <Pressable role="button" onPress={() => void api("/api/coach", { method: "POST", headers: { accept: "application/x-ndjson" }, body: "{}" }).catch(() => {})}>
          <Text>Écrire</Text>
        </Pressable>
      );
    }
    await renderInApp(
      <ApiProvider baseUrl="https://staging.jobbbox.ai" fetch={fetch} storePage={APP_STORE}>
        <Writer />
      </ApiProvider>,
    );
    await userEvent.setup().press(screen.getByRole("button", { name: "Écrire" }));
    const headers = new Headers(((fetch as unknown as jest.Mock).mock.calls[0]![1] as RequestInit).headers);
    expect(headers.get("origin")).toBe(APP_ORIGIN);
    expect(headers.get("accept")).toBe("application/x-ndjson");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("send a form as a form, its file included, for the system to name its boundary (#696)", async () => {
    const { fetch } = server(200, {});
    function Uploader() {
      const api = useApi();
      const form = new FormData();
      form.append("cv", { uri: "file:///cache/CV.pdf", name: "CV.pdf", type: "application/pdf" } as unknown as Blob);
      return (
        <Pressable role="button" onPress={() => void api("/api/cv/draft", { method: "POST", body: form }).catch(() => {})}>
          <Text>Joindre</Text>
        </Pressable>
      );
    }
    await renderInApp(
      <ApiProvider baseUrl="https://staging.jobbbox.ai" fetch={fetch} storePage={APP_STORE}>
        <Uploader />
      </ApiProvider>,
    );
    await userEvent.setup().press(screen.getByRole("button", { name: "Joindre" }));
    const init = (fetch as unknown as jest.Mock).mock.calls[0]![1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).has("content-type")).toBe(false);
    expect(new Headers(init.headers).get("origin")).toBe(APP_ORIGIN);
  });

  it("carry no cookie when signed out", async () => {
    const { fetch, calls } = server(200, []);
    await read(fetch, async () => "");
    expect(calls[0]!.headers.has("cookie")).toBe(false);
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

  /** The app as its root lays it out (src/app/_layout.tsx): the app's fetch (`appFetch`) given to the providers. */
  const outdatedWebApp = () => ({ fetch: server(426, { error: APP_OUTDATED, storeUrl: null, apiVersion: API_VERSION + 2 }).fetch });

  it("answered 426 on a read of a screen, show « Mettre à jour Jobbbox »", async () => {
    function Applications() {
      const read = useRead("applications", "/api/applications", z.unknown());
      return <Text>{read.isError ? "Erreur de chargement" : "Mes candidatures"}</Text>;
    }
    await renderInApp(<Applications />, outdatedWebApp());
    expect(await screen.findByRole("heading", { name: "Mettre à jour Jobbbox" })).toBeOnTheScreen();
    expect(screen.queryByText("Erreur de chargement")).toBeNull();
  });

  it.each([
    ["the global fetch's", () => new TypeError("Network request failed")],
    ["the app's expo/fetch's", () => new Error("fetch failed: The network connection was lost.")],
  ])("a read whose network failed on the way (%s error) is tried again once, by itself", async (_, failure) => {
    let calls = 0;
    const fetch = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw failure();
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof globalThis.fetch;
    function Applications() {
      const read = useRead("applications", "/api/applications", z.unknown());
      return <Text>{read.isSuccess ? "Mes candidatures" : read.isError ? "Erreur de chargement" : "Chargement"}</Text>;
    }
    await renderInApp(<Applications />, { fetch });
    expect(await screen.findByText("Mes candidatures", {}, { timeout: 5000 })).toBeOnTheScreen();
    expect(calls).toBe(2);
  });

  it("answered 426 on a message to the coach, show « Mettre à jour Jobbbox »", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, outdatedWebApp());
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Votre message"), "Bonjour");
    await user.press(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByRole("heading", { name: "Mettre à jour Jobbbox" })).toBeOnTheScreen();
    expect(screen.queryByLabelText("Votre message")).toBeNull();
  });
});
