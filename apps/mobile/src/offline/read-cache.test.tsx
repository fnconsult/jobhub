import { useMutation, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import { isRefusedOffline, ReadCacheProvider, readKey, useForgetReads, type ReadName } from "./read-cache";
import { fakeNetwork, memoryStorage } from "./testing";

/** Long enough for the cache to reach the device's storage. */
const SAVED = 2_000;

function Read({ name, answer }: { name: ReadName; answer: () => Promise<string> }) {
  const { data } = useQuery({ queryKey: readKey(name), queryFn: answer });
  return <Text>{data ?? "rien"}</Text>;
}

const never = () => new Promise<string>(() => {});

async function settle(ms = 0) {
  await act(() => jest.advanceTimersByTimeAsync(ms));
}

describe("the read cache", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("shows the Agenda last seen when the app opens again without network", async () => {
    const storage = memoryStorage();
    const first = await render(
      <ReadCacheProvider device={{ storage, network: fakeNetwork(true) }}>
        <Read name="agenda" answer={async () => "Entretien chez Aéroline"} />
      </ReadCacheProvider>,
    );
    await settle();
    expect(screen.getByText("Entretien chez Aéroline")).toBeOnTheScreen();
    await settle(SAVED);
    await first.unmount();

    await render(
      <ReadCacheProvider device={{ storage, network: fakeNetwork(false) }}>
        <Read name="agenda" answer={never} />
      </ReadCacheProvider>,
    );
    await settle();
    expect(screen.getByText("Entretien chez Aéroline")).toBeOnTheScreen();
  });

  it("reads again, silently, once the network comes back: what was shown stays until the new answer replaces it", async () => {
    const storage = memoryStorage();
    const first = await render(
      <ReadCacheProvider device={{ storage, network: fakeNetwork(true) }}>
        <Read name="applications" answer={async () => "3 candidatures"} />
      </ReadCacheProvider>,
    );
    await settle(SAVED);
    await first.unmount();

    const network = fakeNetwork(false);
    let reply!: (text: string) => void;
    const answer = jest.fn(() => new Promise<string>((resolve) => (reply = resolve)));
    await render(
      <ReadCacheProvider device={{ storage, network }}>
        <Read name="applications" answer={answer} />
      </ReadCacheProvider>,
    );
    await settle(SAVED);
    expect(screen.getByText("3 candidatures")).toBeOnTheScreen();
    expect(answer).not.toHaveBeenCalled();

    await act(() => network.set(true));
    await settle();
    expect(answer).toHaveBeenCalledTimes(1);
    expect(screen.getByText("3 candidatures")).toBeOnTheScreen();
    await act(async () => reply("4 candidatures"));
    await settle();
    expect(screen.getByText("4 candidatures")).toBeOnTheScreen();
  });

  it("never writes a Coach Conversation on the device, only the reads it keeps", async () => {
    const storage = memoryStorage();
    await render(
      <ReadCacheProvider device={{ storage, network: fakeNetwork(true) }}>
        <Read name="coachConversation" answer={async () => "Mon salaire actuel est de 52 000 €"} />
        <Read name="applications" answer={async () => "Candidature chez Aéroline"} />
      </ReadCacheProvider>,
    );
    await settle(SAVED);
    const onDevice = [...storage.entries.values()].join("\n");
    expect(onDevice).toContain("Candidature chez Aéroline");
    expect(onDevice).not.toContain("52 000");
  });

  describe("at sign-out", () => {
    function SignOut() {
      const forgetReads = useForgetReads();
      return (
        <Pressable role="button" onPress={() => void forgetReads()}>
          <Text>Se déconnecter</Text>
        </Pressable>
      );
    }

    async function signOut() {
      await fireEvent.press(screen.getByRole("button", { name: "Se déconnecter" }));
      await settle(SAVED);
    }

    it("empties the cache, on the device and in the app, a Coach Conversation included", async () => {
      const storage = memoryStorage();
      let signedIn = true;
      const answer = (text: string) => () => (signedIn ? Promise.resolve(text) : never());
      await render(
        <ReadCacheProvider device={{ storage, network: fakeNetwork(true) }}>
          <Read name="agenda" answer={answer("Entretien chez Aéroline")} />
          <Read name="coachConversation" answer={answer("Mon salaire actuel est de 52 000 €")} />
          <SignOut />
        </ReadCacheProvider>,
      );
      await settle(SAVED);
      expect(screen.getByText(/52 000/)).toBeOnTheScreen();
      expect(storage.entries.size).toBe(1);

      signedIn = false;
      await signOut();
      expect(storage.entries.size).toBe(0);
      expect(screen.queryByText("Entretien chez Aéroline")).toBeNull();
      expect(screen.queryByText(/52 000/)).toBeNull();
    });

    it("leaves nothing on the device even when a write of the cache was still waiting", async () => {
      const storage = memoryStorage();
      let signedIn = true;
      await render(
        <ReadCacheProvider device={{ storage, network: fakeNetwork(true) }}>
          <Read name="applications" answer={() => (signedIn ? Promise.resolve("Candidature chez Aéroline") : never())} />
          <SignOut />
        </ReadCacheProvider>,
      );
      // Read a moment ago: its write to the device still waits.
      expect(await screen.findByText("Candidature chez Aéroline")).toBeOnTheScreen();
      expect(storage.entries.size).toBe(0);

      signedIn = false;
      await signOut();
      expect([...storage.entries.values()].join()).not.toContain("Aéroline");
    });
  });

  describe("writes", () => {
    function Keep({ write }: { write: () => Promise<void> }) {
      const keep = useMutation({ mutationFn: write });
      const said = keep.isError ? (isRefusedOffline(keep.error) ? "Refusé hors ligne" : "Erreur") : keep.isPaused ? "En attente" : keep.isSuccess ? "Gardée" : "";
      return (
        <Pressable role="button" onPress={() => keep.mutate()}>
          <Text>Garder l'offre {said}</Text>
        </Pressable>
      );
    }

    it("are refused without network, and not sent once it comes back", async () => {
      const network = fakeNetwork(false);
      const write = jest.fn(async () => {});
      await render(
        <ReadCacheProvider device={{ storage: memoryStorage(), network }}>
          <Keep write={write} />
        </ReadCacheProvider>,
      );
      await settle();
      await fireEvent.press(screen.getByRole("button", { name: /Garder l'offre/ }));
      await settle();
      expect(screen.getByText("Garder l'offre Refusé hors ligne")).toBeOnTheScreen();

      await act(() => network.set(true));
      await settle(SAVED);
      expect(write).not.toHaveBeenCalled();
    });

    it("are sent with network", async () => {
      const write = jest.fn(async () => {});
      await render(
        <ReadCacheProvider device={{ storage: memoryStorage(), network: fakeNetwork(true) }}>
          <Keep write={write} />
        </ReadCacheProvider>,
      );
      await settle();
      await fireEvent.press(screen.getByRole("button", { name: /Garder l'offre/ }));
      await settle();
      expect(screen.getByText("Garder l'offre Gardée")).toBeOnTheScreen();
      expect(write).toHaveBeenCalledTimes(1);
    });
  });
});
