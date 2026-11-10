// The app icon's badge on the device (#818, ADR-0090): `setIconBadge`, which AppIconBadge calls with each read of the
// offers à traiter. Each test loads the module afresh, on the platform it runs on: the badge it last set is its own.
import { Platform } from "react-native";

const mockSetBadgeCountAsync = jest.fn<Promise<boolean>, [number]>(async () => true);
jest.mock("expo-notifications", () => ({
  ...jest.requireActual("../../__mocks__/expo-notifications"),
  setBadgeCountAsync: (count: number) => mockSetBadgeCountAsync(count),
}));

/** `setIconBadge` as the app runs it on `os`, freshly started. */
function startedOn(os: "ios" | "android"): (count: number) => Promise<void> {
  jest.replaceProperty(Platform, "OS", os);
  let setIconBadge!: (count: number) => Promise<void>;
  jest.isolateModules(() => {
    ({ setIconBadge } = jest.requireActual<typeof import("./device")>("./device"));
  });
  return setIconBadge;
}

afterEach(() => {
  mockSetBadgeCountAsync.mockClear();
  jest.restoreAllMocks();
});

describe("setIconBadge: the app icon's badge, set to the offers à traiter (#818)", () => {
  it("sets the same count again on iOS, where a push may have set the badge since", async () => {
    const setIconBadge = startedOn("ios");
    await setIconBadge(5);
    await setIconBadge(5);
    await setIconBadge(0);
    await setIconBadge(0);
    expect(mockSetBadgeCountAsync.mock.calls).toEqual([[5], [5], [0], [0]]);
  });

  it("takes the badge to 0 on Android only to take down one above 0 it set, as 0 also empties the tray", async () => {
    const setIconBadge = startedOn("android");
    await setIconBadge(0);
    await setIconBadge(3);
    await setIconBadge(3);
    await setIconBadge(0);
    await setIconBadge(0);
    expect(mockSetBadgeCountAsync.mock.calls).toEqual([[3], [3], [0]]);
  });

  it("never throws when the system refuses the badge", async () => {
    mockSetBadgeCountAsync.mockRejectedValueOnce(new Error("no badge here"));
    await expect(startedOn("ios")(2)).resolves.toBeUndefined();
  });
});
