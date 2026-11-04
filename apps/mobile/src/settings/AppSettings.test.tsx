import { act, fireEvent, screen } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { AppLock } from "../app-lock/AppLock";
import { renderInApp } from "../testing";
import { fakeDevice } from "../testing-device";
import { AppSettings } from "./AppSettings";

const fetchSpy = jest.fn();
beforeEach(() => {
  fakeDevice.reset();
  fetchSpy.mockReset();
  global.fetch = fetchSpy;
});

async function openSettings() {
  await renderInApp(
    <AppLock>
      <AppSettings />
    </AppLock>,
  );
  await act(async () => {});
}

const lockSwitch = () => screen.getByRole("switch", { name: "Verrouiller l'app" });
const turn = (on: boolean) => act(async () => fireEvent(lockSwitch(), "valueChange", on));

describe("Réglages de l'app: « Verrouiller l'app »", () => {
  it("is off by default", async () => {
    await openSettings();
    expect(lockSwitch()).not.toBeChecked();
    expect(screen.getByText(/Après 5 minutes en arrière-plan/)).toBeOnTheScreen();
  });

  it("turns on once the person passes Face ID, the fingerprint or the device's code, and stays on this device", async () => {
    await openSettings();
    await turn(true);
    expect(fakeDevice.authenticate).toHaveBeenCalledWith(expect.objectContaining({ promptMessage: "Activer le verrouillage de Jobbbox", cancelLabel: "Annuler" }));
    expect(lockSwitch()).toBeChecked();
    expect(fakeDevice.keychain.get("app-lock")).toBe("on");
    expect(fakeDevice.contentProtected).toBe(true);
  });

  it("stays off when the prompt is cancelled", async () => {
    fakeDevice.authenticate.mockResolvedValue({ success: false, error: "user_cancel" });
    await openSettings();
    await turn(true);
    expect(lockSwitch()).not.toBeChecked();
    expect(fakeDevice.keychain.has("app-lock")).toBe(false);
  });

  it("stays off on a device with no Face ID, fingerprint or code, and says what to set up", async () => {
    fakeDevice.enrolledLevel = LocalAuthentication.SecurityLevel.NONE;
    await openSettings();
    await turn(true);
    expect(fakeDevice.authenticate).not.toHaveBeenCalled();
    expect(lockSwitch()).not.toBeChecked();
    expect(screen.getByText("Définissez d'abord Face ID, une empreinte ou un code dans les réglages de l'appareil.")).toBeOnTheScreen();
  });

  it("turns off", async () => {
    fakeDevice.keychain.set("app-lock", "on");
    await openSettings();
    await turn(false);
    expect(lockSwitch()).not.toBeChecked();
    expect(fakeDevice.keychain.has("app-lock")).toBe(false);
    expect(fakeDevice.contentProtected).toBe(false);
  });

  it("sends nothing to the server, on or off: a setting of the device, not of the account", async () => {
    await openSettings();
    await turn(true);
    await turn(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
