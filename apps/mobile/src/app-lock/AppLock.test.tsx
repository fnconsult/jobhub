import { act, screen, userEvent } from "@testing-library/react-native";
import { AppState, Text, type AppStateStatus } from "react-native";
import { renderInApp } from "../testing";
import { fakeDevice } from "../testing-device";
import { AppLock } from "./AppLock";

const authenticate = fakeDevice.authenticate;

let appStateListeners: ((state: AppStateStatus) => void)[] = [];
const moveApp = (state: AppStateStatus) => act(async () => appStateListeners.forEach((listener) => listener(state)));

const MINUTE = 60_000;
const START = new Date("2026-11-04T09:00:00Z").getTime();
let now = START;

beforeEach(() => {
  fakeDevice.reset();
  appStateListeners = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListeners.push(listener as (state: AppStateStatus) => void);
    return { remove: () => (appStateListeners = appStateListeners.filter((other) => other !== listener)) };
  });
  now = START;
  jest.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

/** The page behind the lock, found even while assistive technology is kept from it. */
const content = () => screen.getByText("Mes candidatures", { includeHiddenElements: true });
const unlockButton = () => screen.queryByRole("button", { name: "Déverrouiller" });

async function launch() {
  await renderInApp(
    <AppLock>
      <Text>Mes candidatures</Text>
    </AppLock>,
  );
  await act(async () => {}); // the system's prompt answers
}

/** The app goes to the background for `ms`, then comes back. */
async function awayFor(ms: number) {
  await moveApp("inactive");
  await moveApp("background");
  now += ms;
  await moveApp("active");
}

describe("App lock, turned on", () => {
  beforeEach(() => fakeDevice.keychain.set("app-lock", "on"));

  it("locks on return after 5 minutes in the background, not before", async () => {
    await launch();
    expect(content()).toBeVisible();
    authenticate.mockClear();

    await awayFor(5 * MINUTE - 1000);
    expect(content()).toBeVisible();
    expect(unlockButton()).toBeNull();
    expect(authenticate).not.toHaveBeenCalled();

    authenticate.mockResolvedValue({ success: false, error: "user_cancel" });
    await awayFor(5 * MINUTE);
    expect(content()).not.toBeVisible();
    expect(unlockButton()).toBeOnTheScreen();
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it("unlocks with Face ID or the fingerprint, falling back on the device's code", async () => {
    await launch();
    authenticate.mockResolvedValue({ success: false, error: "user_cancel" });
    await awayFor(10 * MINUTE);
    expect(content()).not.toBeVisible();

    authenticate.mockResolvedValue({ success: true });
    await userEvent.setup().press(unlockButton()!);
    expect(content()).toBeVisible();
    expect(unlockButton()).toBeNull();
    expect(authenticate).toHaveBeenLastCalledWith(expect.not.objectContaining({ disableDeviceFallback: true }));
  });
});
