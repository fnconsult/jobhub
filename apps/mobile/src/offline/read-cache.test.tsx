import { useQuery } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { ReadCacheProvider, readKey, type ReadName } from "./read-cache";
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
});
