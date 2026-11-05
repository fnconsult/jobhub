// End-to-end for « hors ligne » (#701, ADR-0076). Two entries: the app's real root (Expo Router -> layout -> shell ->
// conversation) for what a person sees without network, and the app's providers (AppProviders, the root every screen
// sits in) for the read cache, sign-out and writes, which no screen of the app uses yet.
import { useMutation, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, userEvent } from "@testing-library/react-native";
import { createI18n, DEFAULT_LOCALE } from "@jobhub/shared/i18n";
import { renderRouter } from "expo-router/testing-library";
import { Pressable, Text } from "react-native";
import { AppProviders } from "../src/app-providers";
import { isRefusedOffline, readKey, useForgetReads, type ReadName } from "../src/offline/read-cache";
import { fakeNetwork, memoryStorage } from "../src/offline/testing";
import type { AppSession } from "../src/session/app-session";
import type { fakeWebApp } from "../src/session/testing";

jest.setTimeout(60_000);

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "fr" }] }));
jest.mock("expo-font", () => ({ ...jest.requireActual("expo-font"), useFonts: () => [true, null] }));

const mockNetwork = { connected: true, listeners: new Set<(state: { isConnected: boolean }) => void>() };
jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: mockNetwork.connected }),
  addNetworkStateListener: (listener: (state: { isConnected: boolean }) => void) => {
    mockNetwork.listeners.add(listener);
    return { remove: () => mockNetwork.listeners.delete(listener) };
  },
}));
const setNetwork = (connected: boolean) => {
  mockNetwork.connected = connected;
  for (const listener of mockNetwork.listeners) listener({ isConnected: connected });
};

// The web app the app signs in to (#685), so the app's root reaches its signed-in screens, as app.e2e.test.tsx does.
const mockWeb = {} as { app: ReturnType<typeof fakeWebApp>; session: AppSession };
jest.mock("../src/session/instance", () => {
  const { fakeWebApp, memoryStorage, memoryWebViewCookies, TEST_BASE_URL } = jest.requireActual("../src/session/testing");
  const { createAppSession } = jest.requireActual("../src/session/app-session");
  mockWeb.app = fakeWebApp();
  mockWeb.session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), webViewCookies: memoryWebViewCookies(), fetch: mockWeb.app.fetch });
  const { createApi } = jest.requireActual("../src/api/api");
  return { appSession: mockWeb.session, appApi: createApi({ baseURL: TEST_BASE_URL, cookie: () => mockWeb.session.cookie(), fetch: mockWeb.app.fetch }) };
});
// As app.e2e.test.tsx: the app's own scheme, which the magic link it asks for returns to (Expo Router's mock has another).
const mockLink = { current: null as string | null, listeners: new Set<() => void>() };
jest.doMock("expo-linking", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  const subscribe = (listener: () => void) => (mockLink.listeners.add(listener), () => mockLink.listeners.delete(listener));
  return { ...jest.requireActual("expo-linking"), useLinkingURL: () => useSyncExternalStore(subscribe, () => mockLink.current) };
});
const EMAIL = "marie.dupont@example.fr";
/** Signed in, as the app is once its magic link opened it. */
async function signedIn() {
  jest.requireMock("../src/session/instance");
  if ((await mockWeb.session.current()).kind === "signedIn") return;
  await mockWeb.session.askLink(EMAIL);
  await mockWeb.session.openLink(mockWeb.app.linkFor(EMAIL));
}

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const button = (name: string) => screen.getByRole("button", { name });

describe("offline, in the app", () => {
  beforeEach(signedIn);
  afterEach(() => act(() => setNetwork(true)));

  it("shows « Hors ligne » and disables the conversation's box and its writing actions, saying why", async () => {
    mockNetwork.connected = false;
    await renderRouter("./src/app", { initialUrl: "/" });
    expect(screen.getByText("Hors ligne")).toBeOnTheScreen();
    expect(screen.getByLabelText("Votre message")).toBeDisabled();
    expect(button("Envoyer")).toBeDisabled();
    expect(button("Joindre un lien ou un document")).toBeDisabled();
    expect(screen.getByText(/vous pourrez écrire au coach dès le retour du réseau/)).toBeOnTheScreen();
  });

  it("sends nothing when « Envoyer » is pressed without network", async () => {
    const fetchSpy = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchSpy;
    mockNetwork.connected = false;
    await renderRouter("./src/app", { initialUrl: "/" });
    await userEvent.setup().press(button("Envoyer"));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText("Hors ligne")).toBeOnTheScreen();
  });

  it("drops the banner and gives the box back, with no action from the person, once the network returns", async () => {
    mockNetwork.connected = false;
    await renderRouter("./src/app", { initialUrl: "/" });
    expect(screen.getByText("Hors ligne")).toBeOnTheScreen();
    await act(() => setNetwork(true));
    expect(screen.queryByText("Hors ligne")).toBeNull();
    expect(screen.getByLabelText("Votre message")).toBeEnabled();
    expect(button("Envoyer")).toBeEnabled();
  });
});

describe("offline, read cache of the app's providers", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const SAVED = 2_000;
  const settle = (ms = 0) => act(() => jest.advanceTimersByTimeAsync(ms));
  const never = () => new Promise<string>(() => {});

  function Read({ name, answer }: { name: ReadName; answer: () => Promise<string> }) {
    const { data } = useQuery({ queryKey: readKey(name), queryFn: answer });
    return <Text>{data ?? `${name}: rien`}</Text>;
  }
  function SignOut() {
    const forgetReads = useForgetReads();
    return (
      <Pressable role="button" onPress={() => void forgetReads()}>
        <Text>Se déconnecter</Text>
      </Pressable>
    );
  }
  const app = (storage: ReturnType<typeof memoryStorage>, network: ReturnType<typeof fakeNetwork>, children: React.ReactNode) => (
    <AppProviders i18n={createI18n(DEFAULT_LOCALE)} initialMetrics={METRICS} device={{ storage, network }}>
      {children}
    </AppProviders>
  );

  it("keeps the menus' cards seen (Applications, Agenda, Job Offers) and shows them on the next launch without network", async () => {
    const storage = memoryStorage();
    const seen = [
      ["applications", "3 candidatures"],
      ["agenda", "Entretien chez Aéroline"],
      ["jobOffer", "Offre : Product Owner"],
    ] as const;
    const first = await render(
      app(storage, fakeNetwork(true), seen.map(([name, text]) => <Read key={name} name={name} answer={async () => text} />)),
    );
    await settle(SAVED);
    await first.unmount();

    await render(app(storage, fakeNetwork(false), seen.map(([name]) => <Read key={name} name={name} answer={never} />)));
    await settle();
    for (const [, text] of seen) expect(screen.getByText(text)).toBeOnTheScreen();
  });

  it("refreshes silently when the network returns: the old card stays until the new answer replaces it", async () => {
    const storage = memoryStorage();
    const first = await render(app(storage, fakeNetwork(true), <Read name="agenda" answer={async () => "Entretien lundi"} />));
    await settle(SAVED);
    await first.unmount();

    const network = fakeNetwork(false);
    let reply!: (text: string) => void;
    const answer = jest.fn(() => new Promise<string>((resolve) => (reply = resolve)));
    await render(app(storage, network, <Read name="agenda" answer={answer} />));
    await settle();
    expect(answer).not.toHaveBeenCalled();
    await act(() => network.set(true));
    await settle();
    expect(answer).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Entretien lundi")).toBeOnTheScreen();
    await act(async () => reply("Entretien mardi"));
    await settle();
    expect(screen.getByText("Entretien mardi")).toBeOnTheScreen();
  });

  it("keeps no Coach Conversation on the device, even while signed in", async () => {
    const storage = memoryStorage();
    await render(
      app(
        storage,
        fakeNetwork(true),
        <>
          <Read name="coachConversation" answer={async () => "Mon salaire actuel est de 52 000 €"} />
          <Read name="agenda" answer={async () => "Entretien chez Aéroline"} />
        </>,
      ),
    );
    await settle(SAVED);
    const onDevice = [...storage.entries.values()].join("\n");
    expect(onDevice).toContain("Aéroline");
    expect(onDevice).not.toContain("52 000");
  });

  it("empties the cache at sign-out, on the device and in the app, and a relaunch finds nothing", async () => {
    const storage = memoryStorage();
    let signedIn = true;
    const answer = (text: string) => () => (signedIn ? Promise.resolve(text) : never());
    const tree = (a: (text: string) => () => Promise<string>) => (
      <>
        <Read name="applications" answer={a("3 candidatures")} />
        <Read name="coachConversation" answer={a("Mon salaire actuel est de 52 000 €")} />
        <SignOut />
      </>
    );
    const session = await render(app(storage, fakeNetwork(true), tree(answer)));
    await settle(SAVED);
    expect(screen.getByText("3 candidatures")).toBeOnTheScreen();
    expect(screen.getByText(/52 000/)).toBeOnTheScreen();
    expect(storage.entries.size).toBe(1);

    signedIn = false;
    await fireEvent.press(screen.getByRole("button", { name: "Se déconnecter" }));
    await settle(SAVED);
    expect(storage.entries.size).toBe(0);
    expect(screen.queryByText("3 candidatures")).toBeNull();
    expect(screen.queryByText(/52 000/)).toBeNull();

    await session.unmount();
    await render(app(storage, fakeNetwork(false), tree(answer)));
    await settle(SAVED);
    expect(screen.queryByText("3 candidatures")).toBeNull();
    expect(screen.queryByText(/52 000/)).toBeNull();
  });

  describe("a write", () => {
    function Keep({ write }: { write: () => Promise<void> }) {
      const keep = useMutation({ mutationFn: write });
      const said = keep.isError ? (isRefusedOffline(keep.error) ? "Refusé hors ligne" : "Erreur") : keep.isPaused ? "En attente" : keep.isSuccess ? "Gardée" : "";
      return (
        <Pressable role="button" onPress={() => keep.mutate()}>
          <Text>Garder l'offre {said}</Text>
        </Pressable>
      );
    }

    it("is refused without network, and is not sent once the network is back", async () => {
      const network = fakeNetwork(false);
      const write = jest.fn(async () => {});
      await render(app(memoryStorage(), network, <Keep write={write} />));
      await settle();
      await fireEvent.press(screen.getByRole("button", { name: /Garder l'offre/ }));
      await settle();
      expect(screen.getByText("Garder l'offre Refusé hors ligne")).toBeOnTheScreen();
      await act(() => network.set(true));
      await settle(SAVED);
      expect(write).not.toHaveBeenCalled();
    });

    it("is sent with network", async () => {
      const write = jest.fn(async () => {});
      await render(app(memoryStorage(), fakeNetwork(true), <Keep write={write} />));
      await settle();
      await fireEvent.press(screen.getByRole("button", { name: /Garder l'offre/ }));
      await settle();
      expect(write).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Garder l'offre Gardée")).toBeOnTheScreen();
    });
  });
});
